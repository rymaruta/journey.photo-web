/**
 * 「Apple でサインイン」の Apple 側とのやりとり（札 journey.photo-ios#601・2026-11-23 owner「すすめたい！」）。
 *
 * - アプリが Apple の標準シートで受け取った **identity token**（Apple の署名付きの JWT）を、
 *   Apple の公開鍵（JWKS・`https://appleid.apple.com/auth/keys`）で確かめる
 * - Apple の **client secret**（.p8 の鍵で ES256 で署名した短い JWT）を作り、
 *   認可コードを更新トークンに替える（`/auth/token`）・退会のときに取り消す（`/auth/revoke`）
 *
 * 部品を足さない（`node:crypto` だけ）。鍵の形を扱う所はここだけにし、口（`appleSignin.ts`）と
 * Cognito のトリガー（`appleAuthTrigger.ts`）はここを呼ぶ。
 *
 * 🔴 鍵（.p8）は**コードに書かない**。2026-11-23 owner: 新しい鍵は作らず、**APNs の鍵（Key ID `DDYJB5893J`）に
 *    Sign in with Apple を足した**。だから鍵は APNs と同じもの・同じ環境変数（`APNS_KEY_ID`・`APNS_TEAM_ID`・
 *    `APNS_PRIVATE_KEY`。`deploy-api.yml` が Secrets の `APNS_PRIVATE_KEY` から `--param` で渡す）を読む。
 *    もう1つの置き方として、SSM パラメータストアの SecureString（`APPLE_SIGNIN_KEY_PARAM` に名前）を実行時に読める
 *    （`loadAppleConfig`。置き換えの手順は iOS の `docs/APPLE_SIGNIN.md`）。
 *    鍵が無い環境では「使えない」を返し、口は 503・アプリはボタンを出さない
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

/** identity token の長さの上限。実物は 1KB 前後。これを超えるものは読まずに断る（ログイン不要の口で重い処理をさせない） */
export const MAX_TOKEN_LENGTH = 4096;
/** 時計のずれの許し（秒） */
const CLOCK_SKEW_SEC = 60;
/** Apple の公開鍵の控えの寿命。Apple は鍵を入れ替えるので、知らない kid が来たら取り直す */
const KEYS_TTL_MS = 60 * 60 * 1000;
/**
 * 取り直しの間（ミリ秒）。**知らない kid の token を送り続けて、Apple への問い合わせを起こさせない**
 * （ログイン不要の口・2026-11-23 確かめ役の指摘）。取り直してから 60 秒は、知らない kid は控えだけで断る
 */
export const KEYS_REFETCH_MIN_MS = 60 * 1000;
/** Apple に問い合わせるときの待ちの上限 */
const APPLE_TIMEOUT_MS = 5000;

/** 確かめ終えた identity token の中身（使う項目だけ） */
export type AppleClaims = {
    /** Apple の利用者の番号（このアプリのチームの中で変わらない） */
    sub: string;
    aud: string;
    email?: string;
    /** Apple がメールを確かめ済みとしたか */
    emailVerified: boolean;
    /** 「メールを非公開」（privaterelay.appleid.com の転送アドレス）か */
    isPrivateEmail: boolean;
    /** アプリが頼みに入れた nonce の SHA-256（16進）。使い回しを止める印 */
    nonce?: string;
    iat: number;
    exp: number;
};

/** 確かめに落ちた理由。**利用者には出さない**（口は1つの言葉で断る） */
export class AppleTokenError extends Error {
    constructor(public readonly reason: string) {
        super(`apple identity token: ${reason}`);
        this.name = "AppleTokenError";
    }
}

type Jwk = { kty: string; kid: string; alg?: string; use?: string; n: string; e: string };

/** fetch の口（試験で差し替える） */
export type FetchLike = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

let keysCache: { at: number; keys: Jwk[] } | null = null;
/** 最後に取りに行った時刻（失敗した回も数える。Apple が落ちているときに叩き続けない） */
let lastKeysFetchAt = -Infinity;
/** 取りに行っている途中の回（同時に来た回はこれを待つ。待たずに断ると、起動直後の同時のサインインが落ちる） */
let keysInflight: Promise<Jwk[]> | null = null;

/** 試験から控えを消す */
export function resetAppleKeysCache(): void {
    keysCache = null;
    lastKeysFetchAt = -Infinity;
    keysInflight = null;
}

async function fetchAppleKeys(fetchImpl: FetchLike): Promise<Jwk[]> {
    const res = await fetchImpl(APPLE_KEYS_URL, { signal: AbortSignal.timeout(APPLE_TIMEOUT_MS) });
    if (!res.ok) throw new AppleTokenError(`keys http ${res.status}`);
    const body = await res.json() as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter(isRsaJwk) : [];
    if (keys.length === 0) throw new AppleTokenError("keys empty");
    return keys;
}

function isRsaJwk(k: unknown): k is Jwk {
    const j = k as Partial<Jwk> | null;
    return !!j && j.kty === "RSA" && typeof j.kid === "string" && typeof j.n === "string" && typeof j.e === "string";
}

/** kid の鍵を返す。控えに無ければ取り直す（Apple の鍵の入れ替え）。ただし取り直しは 60 秒に1回まで */
async function appleJwk(kid: string, fetchImpl: FetchLike, now: number): Promise<Jwk | undefined> {
    const fresh = keysCache && now - keysCache.at < KEYS_TTL_MS;
    if (fresh) {
        const hit = keysCache!.keys.find((k) => k.kid === kid);
        if (hit) return hit;
    }
    if (keysInflight) return (await keysInflight).find((k) => k.kid === kid);
    if (now - lastKeysFetchAt < KEYS_REFETCH_MIN_MS) {
        // 取り直したばかり。控えが古くても、控えにある鍵なら使う（Apple の鍵の入れ替えは日単位）
        return keysCache?.keys.find((k) => k.kid === kid);
    }
    lastKeysFetchAt = now;
    keysInflight = fetchAppleKeys(fetchImpl);
    try {
        const keys = await keysInflight;
        keysCache = { at: now, keys };
        return keys.find((k) => k.kid === kid);
    } finally {
        keysInflight = null;
    }
}

function b64urlJson(part: string): Record<string, unknown> {
    try {
        const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* 下で断る */ }
    throw new AppleTokenError("malformed");
}

/** Apple は真偽を `true` と `"true"` の両方で送る */
function truthy(v: unknown): boolean {
    return v === true || v === "true";
}

/**
 * identity token を確かめる。署名（RS256・Apple の公開鍵）・発行元・宛先（このアプリの Bundle ID）・期限を見る。
 * どれかが合わなければ `AppleTokenError` を投げる。
 *
 * @param clientIds 受け付ける宛先（`aud`）。本番の Bundle ID `com.journeyphoto.JourneyPhoto`
 */
export async function verifyAppleIdentityToken(
    token: unknown,
    opts: { clientIds: readonly string[]; now?: number; fetchImpl?: FetchLike },
): Promise<AppleClaims> {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        throw new AppleTokenError("shape");
    }
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new AppleTokenError("shape");
    const [h, p, s] = parts;
    const header = b64urlJson(h);
    // **RS256 だけ。** "none" や HS256（公開鍵を共有の秘密として使わせる）を受けない
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AppleTokenError("alg");

    const now = opts.now ?? Date.now();
    const jwk = await appleJwk(header.kid, opts.fetchImpl ?? defaultFetch, now);
    if (!jwk) throw new AppleTokenError("unknown kid");
    const publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
    const ok = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"));
    if (!ok) throw new AppleTokenError("signature");

    const c = b64urlJson(p);
    if (c.iss !== APPLE_ISSUER) throw new AppleTokenError("iss");
    if (typeof c.aud !== "string" || !opts.clientIds.includes(c.aud)) throw new AppleTokenError("aud");
    const nowSec = Math.floor(now / 1000);
    if (typeof c.exp !== "number" || c.exp + CLOCK_SKEW_SEC < nowSec) throw new AppleTokenError("expired");
    if (typeof c.iat !== "number" || c.iat - CLOCK_SKEW_SEC > nowSec) throw new AppleTokenError("iat");
    if (typeof c.sub !== "string" || !c.sub || c.sub.length > 255) throw new AppleTokenError("sub");

    const email = typeof c.email === "string" && c.email.length <= 254 ? c.email : undefined;
    return {
        sub: c.sub,
        aud: c.aud,
        email,
        emailVerified: email !== undefined && truthy(c.email_verified),
        isPrivateEmail: truthy(c.is_private_email),
        nonce: typeof c.nonce === "string" ? c.nonce : undefined,
        iat: c.iat,
        exp: c.exp,
    };
}

// ────────────────────────────── 鍵の設定

/** Apple の鍵（.p8）で話すのに要る値。全部そろったときだけ作る */
export type AppleKeyConfig = {
    /** 宛先（Bundle ID）。identity token の `aud` と同じ値 */
    clientId: string;
    teamId: string;
    keyId: string;
    /** .p8 の中身（PEM）。`deploy-api.yml` が改行を `\n` にして渡すので戻す（`apns.ts` と同じ） */
    privateKey: string;
};

type Env = Record<string, string | undefined>;

/** 鍵の文字を PEM に戻す（`\n` の文字のまま入っていることがある）。鍵として読めなければ空 */
function pemOf(raw: string | undefined): string {
    const pem = (raw ?? "").replace(/\\n/g, "\n").trim();
    if (!pem.includes("PRIVATE KEY")) return "";
    try {
        createPrivateKey(pem);
    } catch {
        return "";
    }
    return pem;
}

/**
 * 環境変数から設定を読む（鍵も環境変数にある形）。**どれか1つでも欠けていれば null**（＝この環境では使えない）。
 * 鍵が無いと、退会のときに Apple の更新トークンを取り消せない（Apple の決まり）ので、
 * 確かめだけできても「使える」とは言わない。
 *
 * 2026-11-23 owner: 鍵は APNs の鍵（`APNS_*`）を使う。宛先だけが Apple でサインインのもの
 */
export function appleConfigFromEnv(env: Env = process.env, privateKeyOverride?: string): AppleKeyConfig | null {
    const clientId = appleClientIdsFromEnv(env)[0] ?? "";
    const teamId = (env.APNS_TEAM_ID ?? "").trim();
    const keyId = (env.APNS_KEY_ID ?? "").trim();
    const privateKey = pemOf(privateKeyOverride ?? env.APNS_PRIVATE_KEY);
    if (!clientId || !teamId || !keyId || !privateKey) return null;
    return { clientId, teamId, keyId, privateKey };
}

/** 受け付ける宛先（トリガーは鍵を持たないので、宛先だけ読む） */
export function appleClientIdsFromEnv(env: Env = process.env): string[] {
    return (env.APPLE_SIGNIN_CLIENT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** SSM の読み手（試験で差し替える） */
export const appleKeyDeps: { getParameter: (name: string) => Promise<string | undefined> } = {
    getParameter: async (name) => {
        ssm ??= new SSMClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
        const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
        return res.Parameter?.Value;
    },
};
let ssm: SSMClient | null = null;
/** SSM から読んだ鍵の控え（`weatherKit.ts` と同じ間合い: 読めたら5分・読めなかったら1分） */
let ssmCache: { at: number; pem: string } | null = null;
const SSM_KEY_TTL_MS = 5 * 60 * 1000;
const SSM_MISS_TTL_MS = 60 * 1000;

export function resetAppleKeyConfigCache(): void {
    ssmCache = null;
}

/**
 * 設定を読む（口が使うのはこちら）。
 * - `APPLE_SIGNIN_KEY_PARAM`（SSM の SecureString の名前）があれば、鍵はそこから読む（環境変数に鍵を置かない形）
 * - 無ければ環境変数の `APNS_PRIVATE_KEY`
 * 読めなければ null（投げない）
 */
export async function loadAppleConfig(env: Env = process.env, now: number = Date.now()): Promise<AppleKeyConfig | null> {
    const param = (env.APPLE_SIGNIN_KEY_PARAM ?? "").trim();
    if (!param) return appleConfigFromEnv(env);
    if (!ssmCache || now - ssmCache.at >= (ssmCache.pem ? SSM_KEY_TTL_MS : SSM_MISS_TTL_MS)) {
        let pem = "";
        try {
            pem = pemOf(await appleKeyDeps.getParameter(param));
        } catch (e) {
            console.warn("apple signin: 鍵（SSM）を読めませんでした:", (e as { name?: string })?.name);
        }
        ssmCache = { at: now, pem };
    }
    return ssmCache.pem ? appleConfigFromEnv(env, ssmCache.pem) : null;
}

/**
 * Apple の client secret（ES256 の JWT）を作る。有効は 5 分（使うその場で作る。Apple の上限は 6 か月）
 */
export function appleClientSecret(cfg: AppleKeyConfig, nowMs: number = Date.now()): string {
    const iat = Math.floor(nowMs / 1000);
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = enc({ alg: "ES256", kid: cfg.keyId });
    const body = enc({ iss: cfg.teamId, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: cfg.clientId });
    const sig = sign("sha256", Buffer.from(`${head}.${body}`), {
        key: createPrivateKey(cfg.privateKey),
        dsaEncoding: "ieee-p1363",
    });
    return `${head}.${body}.${sig.toString("base64url")}`;
}

function form(fields: Record<string, string>): string {
    return new URLSearchParams(fields).toString();
}

/**
 * 認可コード（アプリが受け取った `authorizationCode`・5分で切れる・1回だけ）を更新トークンに替える。
 * 取れなければ undefined（ログインは止めない。次のログインでまた取りに行く）
 */
export async function exchangeAppleCode(
    cfg: AppleKeyConfig, code: string, fetchImpl: FetchLike = defaultFetch,
): Promise<string | undefined> {
    const res = await fetchImpl(APPLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: cfg.clientId, client_secret: appleClientSecret(cfg), code, grant_type: "authorization_code" }),
        signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
    if (!res.ok) {
        console.warn(`apple token exchange: http ${res.status}`);
        return undefined;
    }
    const body = await res.json() as { refresh_token?: unknown };
    return typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined;
}

/**
 * 更新トークンを取り消す（退会のとき・Apple の決まり）。取り消せたら true。
 * Apple は知らない・取り消し済みのトークンにも 200 を返す
 */
export async function revokeAppleToken(
    cfg: AppleKeyConfig, refreshToken: string, fetchImpl: FetchLike = defaultFetch,
): Promise<boolean> {
    const res = await fetchImpl(APPLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({
            client_id: cfg.clientId, client_secret: appleClientSecret(cfg),
            token: refreshToken, token_type_hint: "refresh_token",
        }),
        signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`apple revoke: http ${res.status}`);
    return res.ok;
}
