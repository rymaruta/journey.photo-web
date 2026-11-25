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
import { createPrivateKey, sign } from "node:crypto";
import { defaultFetch, KeyStore, PROVIDER_TIMEOUT_MS, truthy, verifyRs256IdToken, type FetchLike } from "./oidcToken";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

export { MAX_TOKEN_LENGTH, KEYS_REFETCH_MIN_MS, type FetchLike } from "./oidcToken";
const APPLE_TIMEOUT_MS = PROVIDER_TIMEOUT_MS;

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

const appleKeys = new KeyStore(APPLE_KEYS_URL, (reason) => new AppleTokenError(reason));

/** 試験から控えを消す */
export function resetAppleKeysCache(): void {
    appleKeys.reset();
}

/**
 * identity token を確かめる。署名（RS256・Apple の公開鍵）・発行元・宛先（このアプリの Bundle ID）・期限を見る
 * （共通の部品 `oidcToken.ts`）。どれかが合わなければ `AppleTokenError` を投げる。
 *
 * @param clientIds 受け付ける宛先（`aud`）。本番の Bundle ID `com.journeyphoto.JourneyPhoto`
 */
export async function verifyAppleIdentityToken(
    token: unknown,
    opts: { clientIds: readonly string[]; now?: number; fetchImpl?: FetchLike },
): Promise<AppleClaims> {
    const c = await verifyRs256IdToken(token, {
        keys: appleKeys, issuers: [APPLE_ISSUER], clientIds: opts.clientIds,
        fail: (reason) => new AppleTokenError(reason), now: opts.now, fetchImpl: opts.fetchImpl,
    });
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

/** Services ID の形（逆さのドメイン。英数字・点・ハイフン）。それ以外の値は宛先にしない */
const SERVICES_ID_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Web の「Apple でサインイン」の宛先（Services ID・`com.journeyphoto.web`・札 journey.photo-ios#730）。
 * Web（Sign in with Apple JS）の identity token の `aud` はアプリの Bundle ID ではなく、この Services ID になる。
 * 値は公開のもの（Web の頁にも載る）。**空の間は Web からのトークンを受けず、Web のボタンも出ない**（今までどおり iOS だけ）。
 * 鍵は iOS と同じ（APNs の鍵に Sign in with Apple を足したもの）。Apple の鍵はチームの App ID に結ばれ、
 * その App ID を主とする Services ID の client secret もこの鍵で作れる
 */
export function appleWebClientIdsFromEnv(env: Env = process.env): string[] {
    const app = new Set(appleClientIdsFromEnv(env));
    return (env.APPLE_SIGNIN_WEB_CLIENT_ID ?? "").split(",").map((s) => s.trim())
        .filter((s) => SERVICES_ID_RE.test(s) && !app.has(s));
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
    const pem = await loadSigningKeyPem(env, now);
    return pem ? appleConfigFromEnv(env, pem) : null;
}

/**
 * 鍵（PEM）だけを読む。SSM の名前（`APPLE_SIGNIN_KEY_PARAM`）があればそこから（控えは5分・読めなかった回は1分）、
 * 無ければ環境変数の `APNS_PRIVATE_KEY`。読めなければ空。
 * 知らせのプッシュ（同じ APNs の鍵・`federatedAccount.ts` の `pushLinkedNotice`）も使う
 */
export async function loadSigningKeyPem(env: Env = process.env, now: number = Date.now()): Promise<string> {
    const param = (env.APPLE_SIGNIN_KEY_PARAM ?? "").trim();
    if (!param) return pemOf(env.APNS_PRIVATE_KEY);
    if (!ssmCache || now - ssmCache.at >= (ssmCache.pem ? SSM_KEY_TTL_MS : SSM_MISS_TTL_MS)) {
        let pem = "";
        try {
            pem = pemOf(await appleKeyDeps.getParameter(param));
        } catch (e) {
            console.warn("apple signin: 鍵（SSM）を読めませんでした:", (e as { name?: string })?.name);
        }
        ssmCache = { at: now, pem };
    }
    return ssmCache.pem;
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
 * 更新トークンを取り消す（退会のとき・Apple の決まり）。答えの HTTP の状態をそのまま返す（扱いは呼ぶ側が決める）。
 * Apple は知らない・取り消し済みのトークンにも 200 を返す。届かない・時間切れは投げる
 */
export async function revokeAppleToken(
    cfg: AppleKeyConfig, refreshToken: string, fetchImpl: FetchLike = defaultFetch,
): Promise<{ ok: boolean; status: number }> {
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
    return { ok: res.ok, status: res.status };
}
