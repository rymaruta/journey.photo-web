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
 * 🔴 鍵（.p8）・Key ID・Team ID は**コードに書かない**。`deploy-api.yml` が GitHub の Secrets から
 *    `--param` で渡し、関数の環境変数で受ける（APNs の鍵と同じ渡し方・`apns.ts`）。
 *    鍵が無い環境では `appleConfigFromEnv` が「使えない」を返し、口は 503・アプリはボタンを出さない
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

/** users 表の Apple の行の鍵（`apple#<Apple の sub>`）。`#` を含む行は人の行ではない（`userSearch.ts`） */
export const appleKey = (appleSub: string) => `apple#${appleSub}`;

/** identity token の長さの上限。実物は 1KB 前後。これを超えるものは読まずに断る（ログイン不要の口で重い処理をさせない） */
export const MAX_TOKEN_LENGTH = 4096;
/** 時計のずれの許し（秒） */
const CLOCK_SKEW_SEC = 60;
/** Apple の公開鍵の控えの寿命。Apple は鍵を入れ替えるので、知らない kid が来たら控えを捨てて1回だけ取り直す */
const KEYS_TTL_MS = 60 * 60 * 1000;
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

/** 試験から控えを消す */
export function resetAppleKeysCache(): void {
    keysCache = null;
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

/** kid の鍵を返す。控えに無ければ1回だけ取り直す（Apple の鍵の入れ替え） */
async function appleJwk(kid: string, fetchImpl: FetchLike, now: number): Promise<Jwk | undefined> {
    if (keysCache && now - keysCache.at < KEYS_TTL_MS) {
        const hit = keysCache.keys.find((k) => k.kid === kid);
        if (hit) return hit;
    }
    const keys = await fetchAppleKeys(fetchImpl);
    keysCache = { at: now, keys };
    return keys.find((k) => k.kid === kid);
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
 * @param clientIds 受け付ける宛先（`aud`）。本番は `com.journeyphoto.JourneyPhoto`、staging は `.staging`
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

/**
 * 環境変数から設定を読む。**どれか1つでも欠けていれば null**（＝この環境では使えない）。
 * 鍵が無いと、退会のときに Apple の更新トークンを取り消せない（Apple の決まり）ので、
 * 確かめだけできても「使える」とは言わない
 */
export function appleConfigFromEnv(env: Record<string, string | undefined> = process.env): AppleKeyConfig | null {
    const clientId = (env.APPLE_SIGNIN_CLIENT_ID ?? "").trim();
    const teamId = (env.APPLE_SIGNIN_TEAM_ID ?? "").trim();
    const keyId = (env.APPLE_SIGNIN_KEY_ID ?? "").trim();
    const privateKey = (env.APPLE_SIGNIN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
    if (!clientId || !teamId || !keyId || !privateKey.includes("PRIVATE KEY")) return null;
    return { clientId, teamId, keyId, privateKey };
}

/** 受け付ける宛先（トリガーは鍵を持たないので、宛先だけ読む） */
export function appleClientIdsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
    return (env.APPLE_SIGNIN_CLIENT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
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
