/**
 * 「Apple でサインイン」の口（札 journey.photo-ios#601・2026-11-14 の案・2026-11-23 owner「すすめたい！」）。
 *
 * ## 流れ（押す回数は2回: ボタン → Face ID）
 *
 * 1. アプリが乱数の nonce（元の値）を作り、その **SHA-256** を Apple の頼みに入れる。Apple の標準シートで
 *    identity token（中の `nonce` は SHA-256）・認可コード・（初回だけ）名前を受け取る
 * 2. `POST /auth/apple`（ログイン不要）: token を Apple の公開鍵で確かめ、**元の値の SHA-256 が token の nonce と同じか**
 *    を照らし、使った nonce を1回きりにする（`useNonce`）。**今の Cognito の利用者**を決め（結ぶ・作る）、
 *    認可コードを Apple の更新トークンに替えて控える。答えは Cognito のユーザー名と**使い捨ての券**（5分）
 * 3. アプリが Cognito の CUSTOM_AUTH でそのユーザー名にログインし、券を答えに出す。
 *    Cognito のトリガー（`appleAuthTrigger.ts`）が券を照らして消す（1回きり）。
 *    → 出てくるのは今と同じ Cognito のトークン。API の認可・トークンの更新・退会の流れはそのまま使える
 *
 * 🔴 盗まれた identity token だけでは入れない（元の nonce が要る）。元の nonce ごと盗まれても、使った nonce は
 *    2回通らない。券は乱数で、行には SHA-256 だけを置く。
 *
 * 行・結び方・券は提供元によらない土台（`federatedAccount.ts`。次の Google・#715 も同じ所を使う）。
 * ここが持つのは Apple の token の確かめ・認可コードの交換・退会のときの取り消しだけ。
 *
 * 退会のときの取り消しは、サーバーの退会（`account.ts` の `deleteAccount`）が `appleRevoker` で行う
 * （Web や古いアプリから退会しても漏れない）。
 */
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { jsonError, JSON_HEADERS } from "./http";
import {
    appleWebClientIdsFromEnv, exchangeAppleCode, loadAppleConfig, revokeAppleToken, verifyAppleIdentityToken,
    AppleTokenError, type AppleClaims, type AppleKeyConfig, type FetchLike,
} from "./appleIdToken";
import {
    cleanDisplayName, federatedDeps, issueTicket, linkOrCreate, saveRefreshToken, useNonce as claimNonce, LinkBusyError, UnlinkedProviderError, unlinkedMessage,
    type Revoker,
} from "./federatedAccount";

export const UNAVAILABLE_MESSAGE = "今は Apple でサインインできません";
export const INVALID_TOKEN_MESSAGE = "サインインできませんでした。もう一度お試しください";
export const BUSY_MESSAGE = "サインイン中です。少し待ってからお試しください";

/** 外へ話す口（試験で差し替える）。Cognito と時計は `federatedDeps` */
export const appleDeps: {
    fetchImpl?: FetchLike;
    config: () => Promise<AppleKeyConfig | null>;
    /** Web の宛先（Services ID）。空なら Web からのトークンは受けない（札 journey.photo-ios#730） */
    webClientIds: () => string[];
} = {
    fetchImpl: undefined,
    config: () => loadAppleConfig(),
    webClientIds: () => appleWebClientIdsFromEnv(),
};

/**
 * 受け付ける宛先（`aud`）: アプリの Bundle ID と、Web の Services ID。
 * 🔴 認可コードの交換と取り消しは、**そのトークンの宛先と同じ client_id** で頼む（Apple はコードと更新トークンを
 *    宛先ごとに出す。Web で受け取ったコードを Bundle ID で替えようとすると断られる）
 */
function acceptedClientIds(cfg: AppleKeyConfig): string[] {
    return [cfg.clientId, ...appleDeps.webClientIds().filter((id) => id !== cfg.clientId)];
}

const ok = (body: unknown) => ({
    statusCode: 200,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
    body: JSON.stringify(body),
});

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? "";

/**
 * `GET /auth/apple/status`（ログイン不要）。アプリはこれが `available: true` のときだけボタンを出す。
 * 🔴 この関数の環境変数には鍵を置かない。
 * - 鍵を SSM に置いた形（本線・`APPLE_SIGNIN_KEY_PARAM`）: SSM から読めるかを見て、真偽だけ返す（鍵は答えに出さない）
 * - 鍵を環境変数に置いた形: `deploy-api.yml` が「そろっているか」の真偽だけ（`APPLE_SIGNIN_READY`）を渡す
 */
export const getAppleSigninStatus: APIGatewayProxyHandlerV2 = async () => {
    if (federatedDeps.poolId() === "") return ok({ available: false });
    const available = (process.env.APPLE_SIGNIN_KEY_PARAM ?? "").trim()
        ? (await appleDeps.config()) !== null
        : process.env.APPLE_SIGNIN_READY === "true";
    // Web はこの値（公開の Services ID）があるときだけボタンを出す（札 journey.photo-ios#730）。iOS は読まない
    const webClientId = available ? appleDeps.webClientIds()[0] : undefined;
    return ok(webClientId ? { available, webClientId } : { available });
};

type StartBody = { identityToken?: unknown; nonce?: unknown; authorizationCode?: unknown; displayName?: unknown };

/** `POST /auth/apple`（ログイン不要）。答えは Cognito のユーザー名と、CUSTOM_AUTH に出す使い捨ての券 */
export const startAppleSignin: APIGatewayProxyHandlerV2 = async (event) => {
    const cfg = await appleDeps.config();
    if (!cfg || !federatedDeps.poolId()) return jsonError(503, UNAVAILABLE_MESSAGE, "apple_signin_unavailable");

    let body: StartBody;
    try {
        body = JSON.parse(event.body ?? "{}") as StartBody;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    if (!body || typeof body !== "object") return jsonError(400, "不正なリクエスト");

    let claims: AppleClaims;
    try {
        claims = await verifyAppleIdentityToken(body.identityToken, { clientIds: acceptedClientIds(cfg), fetchImpl: appleDeps.fetchImpl });
    } catch (e) {
        if (!(e instanceof AppleTokenError)) console.error("startAppleSignin: verify", errName(e));
        else console.warn(`startAppleSignin: ${e.reason}`);
        return jsonError(401, INVALID_TOKEN_MESSAGE, "apple_token_invalid");
    }

    try {
        // 🔴 元の nonce を照らし、1回きりにする（盗まれた token の使い回しを止める）
        if (!(await claimNonce("apple", body.nonce, claims.nonce))) {
            console.warn("startAppleSignin: nonce");
            return jsonError(401, INVALID_TOKEN_MESSAGE, "apple_token_invalid");
        }
        const linked = await linkOrCreate({
            provider: "apple", sub: claims.sub, email: claims.email,
            emailVerified: claims.emailVerified, isPrivateEmail: claims.isPrivateEmail,
        }, cleanDisplayName(body.displayName));
        const code = typeof body.authorizationCode === "string" && body.authorizationCode.length <= 1024
            ? body.authorizationCode : "";
        if (code) {
            // 取れなくてもログインは止めない（次のログインでまた取る）
            try {
                // 宛先（Bundle ID か Services ID）と同じ client_id で替え、どちらで得たかを行に残す（退会の取り消しに要る）
                const refresh = await exchangeAppleCode({ ...cfg, clientId: claims.aud }, code, appleDeps.fetchImpl);
                if (refresh) await saveRefreshToken("apple", claims.sub, refresh, claims.aud);
            } catch (e) {
                console.warn("startAppleSignin: token exchange", errName(e));
            }
        }
        const challengeAnswer = await issueTicket("apple", claims.sub);
        // 数え方は登録の1行と同じ形（uid・メールは出さない・`api/src/cognitoTrigger.ts` の signupMetricLine）
        const platform = claims.aud === cfg.clientId ? "ios" : "web";
        if (linked.via === "new") console.log(JSON.stringify({ metric: "signup", platform, from: "apple" }));
        return ok({ username: linked.username, challengeAnswer, created: linked.via === "new" });
    } catch (e) {
        if (e instanceof LinkBusyError) return jsonError(409, BUSY_MESSAGE, "apple_signin_busy");
        // 本人が「サインインの方法」で解除した提供元（2026-11-23 確かめ役の指摘: 黙って空の別アカウントを作らない）
        if (e instanceof UnlinkedProviderError) return jsonError(409, unlinkedMessage("apple"), "apple_signin_unlinked");
        console.error("startAppleSignin:", errName(e));
        return jsonError(500, "サインインできませんでした。少し待ってからお試しください");
    }
};

/**
 * 退会のときに Apple の更新トークンを取り消す（Apple の決まり）。`account.ts` の `deleteAccount` が呼ぶ。
 * - `revoked`: 取り消せた（Apple は知らない・取り消し済みのトークンにも 200 を返す）
 * - `failed`: Apple が落ちている（5xx）・届かない・時間切れ。退会を止めて、やり直してもらう（直れば通る）
 * - `rejected`: Apple が断った（4xx。鍵や頼みの形の問題で、やり直しても変わらない）。2026-11-23 確かめ役の指摘で、
 *   退会を止めない（止めると退会がずっとできなくなる）。見張りに出し、行は残す
 * - `unavailable`: この環境に鍵が無い（退会は止めない。行と墓石の番号を残す）
 */
export const appleRevoker: Revoker = async (refreshToken, clientId) => {
    const cfg = await appleDeps.config();
    if (!cfg) return "unavailable";
    // 取り消しは、更新トークンを得たときの宛先で頼む（宛先を持たない前からの行は iOS の Bundle ID）。
    // 知らない宛先では頼まない（鍵で署名する相手を、呼ぶ側の言うままにしない）
    const id = clientId ?? cfg.clientId;
    if (!acceptedClientIds(cfg).includes(id)) {
        console.warn("appleRevoker: 知らない宛先");
        return "rejected";
    }
    try {
        const res = await revokeAppleToken({ ...cfg, clientId: id }, refreshToken, appleDeps.fetchImpl);
        if (res.ok) return "revoked";
        return res.status >= 400 && res.status < 500 ? "rejected" : "failed";
    } catch (e) {
        console.warn("appleRevoker:", errName(e));
        return "failed";
    }
};

/**
 * 取り消しだけをする関数（HTTP の口ではない）。user API の退会が `federatedRevokeClient.ts` から呼ぶ。
 * 受けるのは「この更新トークンを取り消して」だけ（誰のものかは見ない・取り消すことしかできない）
 */
export const revokeTokenHandler = async (
    event: { provider?: unknown; refreshToken?: unknown; clientId?: unknown },
): Promise<{ result: string }> => {
    if (event?.provider !== "apple" || typeof event.refreshToken !== "string" || !event.refreshToken || event.refreshToken.length > 2048) {
        return { result: "rejected" };
    }
    if (event.clientId !== undefined && (typeof event.clientId !== "string" || !event.clientId || event.clientId.length > 255)) {
        return { result: "rejected" };
    }
    return { result: await appleRevoker(event.refreshToken, event.clientId as string | undefined) };
};
