/**
 * Web の「Apple でサインイン」「Google でログイン」（札 journey.photo-ios#730・2026-11-25 owner「WEB もお願い」）。
 *
 * 流れは iOS と同じ（サーバーの注記は `api-user/src/appleSignin.ts`・`googleSignin.ts`）:
 *
 * 1. 頁を開いたら `GET /auth/<提供元>/status` を見る。**`webClientId` が返ったときだけボタンを出す**
 *    （サーバーに Web の宛先が入るまでは返らない＝ボタンは出ない）
 * 2. 乱数の nonce（元の値）を作り、その SHA-256 を提供元に渡す（Apple は `AppleID.auth.init({ nonce })`、
 *    Google は `google.accounts.id.initialize({ nonce })`）。ID トークンの `nonce` にはその SHA-256 が入る
 * 3. `POST /auth/<提供元>` に ID トークンと元の nonce を送る。サーバーが確かめ、Cognito のユーザー名と使い捨ての券を返す
 * 4. Cognito の CUSTOM_AUTH で券を答えて入る（`lib/auth/cognito.ts` の `signInWithTicket`）
 *
 * 🔴 nonce は1回きり（サーバーが使った nonce を覚える）。1回押すごとに作り直す。
 * 🔴 ボタンを押したその場でポップアップを開く（押した手の動きの中で開かないと、Safari が止める）。
 *    だから nonce と提供元の準備は**押す前**に済ませておく。
 */
import { userPublicFetch, readApiError } from "../utils/api";

export type FederatedProvider = "apple" | "google";

/** 提供元の部品（外のスクリプト）。版は提供元が固定の URL で配る */
export const APPLE_SCRIPT_URL = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/ja_JP/appleid.auth.js";
export const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";

/** Apple の戻り先（Apple Developer の Services ID に登録した Return URL と同じ。ポップアップなので頁は移らない） */
export function appleRedirectUri(origin: string): string {
    return `${origin.replace(/\/$/, "")}/login`;
}

/** 公開の宛先の形。サーバーの答えに変な値が来ても、提供元の部品に渡さない */
const APPLE_WEB_ID_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const GOOGLE_WEB_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export function validWebClientId(provider: FederatedProvider, v: unknown): string | null {
    if (typeof v !== "string") return null;
    return (provider === "apple" ? APPLE_WEB_ID_RE : GOOGLE_WEB_ID_RE).test(v) ? v : null;
}

/** 前に見た status の控え（次に開いたとき、最初からその形で出す・iOS と同じ）。この人の端末だけの便利 */
const STATUS_CACHE_KEY = "jp.federatedWebIds.v1";
export type WebIds = { apple: string | null; google: string | null };

export function readCachedWebIds(): WebIds {
    try {
        const raw = localStorage.getItem(STATUS_CACHE_KEY);
        const v = raw ? JSON.parse(raw) as Partial<WebIds> : {};
        return { apple: validWebClientId("apple", v.apple), google: validWebClientId("google", v.google) };
    } catch {
        return { apple: null, google: null };
    }
}

function writeCachedWebIds(ids: WebIds): void {
    try { localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(ids)); } catch { /* 控えられなくても動く */ }
}

/** 1つの提供元の status を読む。答えがあれば Web の ID か null、届かなければ undefined */
async function fetchWebId(provider: FederatedProvider): Promise<string | null | undefined> {
    try {
        const res = await userPublicFetch(`/auth/${provider}/status`, { timeoutMs: 8000 });
        if (!res.ok) return res.status >= 500 ? undefined : null;
        const body = await res.json() as { available?: unknown; webClientId?: unknown };
        return body.available === true ? validWebClientId(provider, body.webClientId) : null;
    } catch {
        return undefined;
    }
}

/**
 * 両方の status を読む。**届かなかった回は控えを消さない**（電波の悪い所で開いても、前に出たボタンは出す。
 * 押したときにサーバーが断れば文が出る）。届いた回は控えを書き換える
 */
export async function loadWebIds(): Promise<WebIds> {
    const [apple, google] = await Promise.all([fetchWebId("apple"), fetchWebId("google")]);
    const cached = readCachedWebIds();
    const ids = { apple: apple === undefined ? cached.apple : apple, google: google === undefined ? cached.google : google };
    writeCachedWebIds(ids);
    return ids;
}

// ────────────────────────────── nonce

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** 元の値（32 バイトの乱数を base64url）と、その SHA-256（16進・提供元に渡す） */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const raw = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const hashed = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
    return { raw, hashed };
}

// ────────────────────────────── 外のスクリプト

const loading = new Map<string, Promise<void>>();

/** 外のスクリプトを1回だけ読む。読めなければ投げる（ボタンを出さない） */
export function loadScript(src: string): Promise<void> {
    const hit = loading.get(src);
    if (hit) return hit;
    const p = new Promise<void>((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => { loading.delete(src); el.remove(); reject(new Error(`script ${src}`)); };
        document.head.appendChild(el);
    });
    loading.set(src, p);
    return p;
}

// ────────────────────────────── 提供元の部品の型（使う所だけ）

type AppleSignInResponse = {
    authorization?: { id_token?: string; code?: string; state?: string };
    user?: { email?: string; name?: { firstName?: string; lastName?: string } };
};
type AppleAuth = {
    init(cfg: { clientId: string; scope: string; redirectURI: string; state: string; nonce: string; usePopup: boolean }): void;
    signIn(): Promise<AppleSignInResponse>;
};
export type GoogleId = {
    initialize(cfg: Record<string, unknown>): void;
    renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
    cancel?(): void;
};

export function appleAuth(): AppleAuth | null {
    return (window as unknown as { AppleID?: { auth?: AppleAuth } }).AppleID?.auth ?? null;
}
export function googleId(): GoogleId | null {
    return (window as unknown as { google?: { accounts?: { id?: GoogleId } } }).google?.accounts?.id ?? null;
}

/** 押す前の準備（nonce と state）。押すたびに作り直す */
export type ApplePrepared = { nonce: { raw: string; hashed: string }; state: string };

export async function prepareApple(clientId: string, origin: string): Promise<ApplePrepared | null> {
    const auth = appleAuth();
    if (!auth) return null;
    const nonce = await makeNonce();
    const state = (await makeNonce()).raw;
    auth.init({ clientId, scope: "name email", redirectURI: appleRedirectUri(origin), state, nonce: nonce.hashed, usePopup: true });
    return { nonce, state };
}

/** Apple の答えから表示名を作る（初めての回だけ名前が来る）。日本語の名前は姓・名の順でつなぐ */
export function appleDisplayName(user: AppleSignInResponse["user"]): string | undefined {
    const first = user?.name?.firstName?.trim() ?? "";
    const last = user?.name?.lastName?.trim() ?? "";
    if (!first && !last) return undefined;
    const ascii = /^[\x00-\x7F]*$/.test(first + last);
    return ascii ? [first, last].filter(Boolean).join(" ") : `${last}${first}`;
}

/** 画面にそのまま出してよい一文（サーバーの日本語の理由など）。これ以外の失敗は決まった一文に替える */
export class FederatedShownError extends Error {
    constructor(message: string) { super(message); this.name = "FederatedShownError"; }
}

/** 利用者がやめた（ポップアップを閉じた・取り消した）。文は出さない */
export class FederatedCancelled extends Error {
    constructor() { super("cancelled"); this.name = "FederatedCancelled"; }
}

/**
 * Apple のポップアップを開き、答えを返す。**押した手の動きの中で呼ぶ**（前に `prepareApple` を済ませておく）
 */
export async function runApple(prep: ApplePrepared): Promise<{ identityToken: string; authorizationCode?: string; displayName?: string }> {
    const auth = appleAuth();
    if (!auth) throw new Error("apple not loaded");
    let res: AppleSignInResponse;
    try {
        res = await auth.signIn();
    } catch (e) {
        const code = (e as { error?: string } | null)?.error ?? "";
        if (code === "popup_closed_by_user" || code === "user_cancelled_authorize" || code === "user_trigger_new_signin_flow") throw new FederatedCancelled();
        throw new Error(`apple ${code || "error"}`);
    }
    const a = res.authorization;
    // 🔴 state が違う答えは使わない（別の頁が開いた流れの答えを取り込まない）
    if (!a?.id_token || a.state !== prep.state) throw new Error("apple response");
    return { identityToken: a.id_token, authorizationCode: a.code, displayName: appleDisplayName(res.user) };
}

// ────────────────────────────── サーバー

export const FEDERATED_FAIL_MESSAGE = "ログインできませんでした。もう一度お試しください";

/**
 * サーバーに ID トークンと元の nonce を渡し、ユーザー名と券を受け取る。
 * 断られたらサーバーの日本語の一文を投げる（「ほかの端末でログイン中です」など）
 */
export async function exchangeWithServer(
    provider: FederatedProvider,
    body: { identityToken?: string; idToken?: string; nonce: string; authorizationCode?: string; displayName?: string },
): Promise<{ username: string; challengeAnswer: string; created: boolean }> {
    let res: Response;
    try {
        res = await userPublicFetch(`/auth/${provider}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        throw new FederatedShownError("ネットワークにつながりません。接続を確認してもう一度お試しください");
    }
    if (!res.ok) throw new FederatedShownError(await readApiError(res, FEDERATED_FAIL_MESSAGE));
    const data = await res.json() as { username?: unknown; challengeAnswer?: unknown; created?: unknown };
    if (typeof data.username !== "string" || typeof data.challengeAnswer !== "string") throw new Error(FEDERATED_FAIL_MESSAGE);
    return { username: data.username, challengeAnswer: data.challengeAnswer, created: data.created === true };
}
