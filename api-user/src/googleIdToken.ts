/**
 * 「Google でログイン」の Google 側とのやりとり（札 journey.photo-ios#715・2026-11-23 owner「Google でサインインも必要」）。
 *
 * アプリが Google の公式の部品（GoogleSignIn-iOS）で受け取った **ID トークン**（Google の署名付きの JWT）を、
 * Google の公開鍵（JWKS）で確かめる。確かめ方は Apple と同じ共通の部品（`oidcToken.ts`）:
 * 署名（RS256）・発行元（`https://accounts.google.com` と `accounts.google.com` の両方・Google の決まり）・
 * 宛先（iOS のクライアント ID）・期限。取り直しは 60 秒に1回まで。
 *
 * 秘密の値は無い（クライアント ID は公開の値・アプリにも書いてある）。更新トークンも受け取らない
 * （アプリはサーバー用の認可コードを頼まない）ので、退会で取り消すものは無い。
 */
import { KeyStore, truthy, verifyRs256IdToken, type FetchLike } from "./oidcToken";

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
export const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export type GoogleClaims = {
    sub: string;
    aud: string;
    email?: string;
    emailVerified: boolean;
    /**
     * メールの持ち主を Google が確かめていると言えるか（自動で結んでよいか）。
     * Google の案内どおり、`@gmail.com` か、Google Workspace の組織（`hd` がある）のメールだけ。
     * それ以外（Google アカウントに後から付けたほかの会社のメール）は、`email_verified` でも結ばない
     */
    emailAuthoritative: boolean;
    /** アプリが頼みに入れた nonce の SHA-256（16進） */
    nonce?: string;
    /** Google のプロフィールの名前（`profile` の範囲を頼んだとき） */
    name?: string;
};

export class GoogleTokenError extends Error {
    constructor(public readonly reason: string) {
        super(`google id token: ${reason}`);
        this.name = "GoogleTokenError";
    }
}

const googleKeys = new KeyStore(GOOGLE_KEYS_URL, (reason) => new GoogleTokenError(reason));

export function resetGoogleKeysCache(): void {
    googleKeys.reset();
}

/** 受け付ける宛先（iOS のクライアント ID。カンマで複数） */
export function googleClientIdsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
    return (env.GOOGLE_SIGNIN_CLIENT_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** OAuth のクライアント ID の形（`<数字>-<英数字>.apps.googleusercontent.com`）。それ以外の値は宛先にしない */
const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/**
 * Web の「Google でログイン」の宛先（「ウェブ アプリケーション」の OAuth クライアント ID・札 journey.photo-ios#730）。
 * Web（Google Identity Services）の ID トークンの `aud` はこの値になる。公開の値。
 * **空の間は Web からのトークンを受けない**（今までどおり iOS だけ）
 */
export function googleWebClientIdsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
    const ios = new Set(googleClientIdsFromEnv(env));
    return (env.GOOGLE_SIGNIN_WEB_CLIENT_ID ?? "").split(",").map((s) => s.trim())
        .filter((s) => GOOGLE_CLIENT_ID_RE.test(s) && !ios.has(s));
}

export async function verifyGoogleIdToken(
    token: unknown,
    opts: { clientIds: readonly string[]; now?: number; fetchImpl?: FetchLike },
): Promise<GoogleClaims> {
    const c = await verifyRs256IdToken(token, {
        keys: googleKeys, issuers: GOOGLE_ISSUERS, clientIds: opts.clientIds,
        fail: (reason) => new GoogleTokenError(reason), now: opts.now, fetchImpl: opts.fetchImpl,
    });
    const email = typeof c.email === "string" && c.email.length <= 254 ? c.email : undefined;
    const emailVerified = email !== undefined && truthy(c.email_verified);
    const hd = typeof c.hd === "string" && c.hd.length > 0;
    const gmail = email !== undefined && /@(gmail|googlemail)\.com$/i.test(email);
    return {
        sub: c.sub,
        aud: c.aud,
        email,
        emailVerified,
        emailAuthoritative: emailVerified && (gmail || hd),
        nonce: typeof c.nonce === "string" ? c.nonce : undefined,
        name: typeof c.name === "string" ? c.name : undefined,
    };
}
