/**
 * 「Google でログイン」の口（札 journey.photo-ios#715）。作りは「Apple でサインイン」（`appleSignin.ts`）と同じで、
 * 行・結び方・券・Cognito のトリガーは提供元によらない土台（`federatedAccount.ts`・`appleAuthTrigger.ts`）を使う。
 *
 * ## 流れ（押す回数は2〜3回: ボタン → Google のアカウントを選ぶ（→ 続ける））
 *
 * 1. アプリが乱数の nonce を作り、その **SHA-256** を Google の頼みに入れる（GoogleSignIn-iOS の `nonce`）。
 *    ID トークンの `nonce` にはその値が入る
 * 2. `POST /auth/google`（ログイン不要）: ID トークンを Google の公開鍵で確かめ、`sha256(元の値) == token の nonce` を照らし、
 *    使った nonce を1回きりにする（Apple と同じ `useNonce`）。今の Cognito の利用者を決め（結ぶ・作る）、使い捨ての券を返す
 * 3. アプリが Cognito の CUSTOM_AUTH でそのユーザー名にログインし、券を答えに出す（トリガーは Apple と同じ）
 *
 * 結び方: Google が確かめ済みとし、Google が持ち主を確かめられるメール（Gmail か Google Workspace の組織のメール・
 * `googleIdToken.ts` の `emailAuthoritative`）が、確かめ済みのアカウントのメールと同じなら結ぶ。それ以外は新しく作る。
 * 退会: Google の更新トークンは受け取らないので、取り消すものは無い（行と墓石の番号は `unlinkAfterDelete` が消す）。
 */
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { jsonError, JSON_HEADERS } from "./http";
import type { FetchLike } from "./oidcToken";
import { googleClientIdsFromEnv, verifyGoogleIdToken, GoogleTokenError, type GoogleClaims } from "./googleIdToken";
import { cleanDisplayName, federatedDeps, issueTicket, linkOrCreate, useNonce, LinkBusyError } from "./federatedAccount";

export const UNAVAILABLE_MESSAGE = "Google でのログインは今は使えません";
export const INVALID_TOKEN_MESSAGE = "Google でのログインを確かめられませんでした。もう一度お試しください";
export const BUSY_MESSAGE = "ログインの途中です。少し待ってからもう一度お試しください";

export const googleDeps: { fetchImpl?: FetchLike; clientIds: () => string[] } = {
    fetchImpl: undefined,
    clientIds: () => googleClientIdsFromEnv(),
};

const ok = (body: unknown) => ({
    statusCode: 200,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
    body: JSON.stringify(body),
});

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? "";

/** `GET /auth/google/status`（ログイン不要）。アプリはこれが `available: true` のときだけボタンを出す。秘密の値は無い */
export const getGoogleSigninStatus: APIGatewayProxyHandlerV2 = async () =>
    ok({ available: googleDeps.clientIds().length > 0 && federatedDeps.poolId() !== "" });

type StartBody = { idToken?: unknown; nonce?: unknown; displayName?: unknown };

/** `POST /auth/google`（ログイン不要）。答えは Cognito のユーザー名と、CUSTOM_AUTH に出す使い捨ての券 */
export const startGoogleSignin: APIGatewayProxyHandlerV2 = async (event) => {
    const clientIds = googleDeps.clientIds();
    if (clientIds.length === 0 || !federatedDeps.poolId()) return jsonError(503, UNAVAILABLE_MESSAGE, "google_signin_unavailable");

    let body: StartBody;
    try {
        body = JSON.parse(event.body ?? "{}") as StartBody;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    if (!body || typeof body !== "object") return jsonError(400, "不正なリクエスト");

    let claims: GoogleClaims;
    try {
        claims = await verifyGoogleIdToken(body.idToken, { clientIds, fetchImpl: googleDeps.fetchImpl });
    } catch (e) {
        if (!(e instanceof GoogleTokenError)) console.error("startGoogleSignin: verify", errName(e));
        else console.warn(`startGoogleSignin: ${e.reason}`);
        return jsonError(401, INVALID_TOKEN_MESSAGE, "google_token_invalid");
    }

    try {
        // 🔴 元の nonce を照らし、1回きりにする（盗まれた ID トークンの使い回しを止める）
        if (!(await useNonce("google", body.nonce, claims.nonce))) {
            console.warn("startGoogleSignin: nonce");
            return jsonError(401, INVALID_TOKEN_MESSAGE, "google_token_invalid");
        }
        const linked = await linkOrCreate({
            provider: "google", sub: claims.sub, email: claims.email, emailVerified: claims.emailVerified,
            // 持ち主を Google が確かめられないメールでは、同じメールのアカウントを探さない（Apple の転送アドレスと同じ扱い）
            isPrivateEmail: !claims.emailAuthoritative,
        }, cleanDisplayName(body.displayName) ?? cleanDisplayName(claims.name));
        const challengeAnswer = await issueTicket("google", claims.sub);
        if (linked.via === "new") console.log(JSON.stringify({ metric: "signup", platform: "ios", from: "google" }));
        return ok({ username: linked.username, challengeAnswer, created: linked.via === "new" });
    } catch (e) {
        if (e instanceof LinkBusyError) return jsonError(409, BUSY_MESSAGE, "google_signin_busy");
        console.error("startGoogleSignin:", errName(e));
        return jsonError(500, "ログインを完了できませんでした。しばらくしてからもう一度お試しください");
    }
};
