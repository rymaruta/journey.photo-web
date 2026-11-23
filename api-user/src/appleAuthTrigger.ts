/**
 * 「Apple でサインイン」の Cognito のトリガー（CUSTOM_AUTH・札 journey.photo-ios#601）。
 *
 * 1つの関数で3つ（Define・Create・Verify）を受ける。`triggerSource` で分ける。
 * 1つにまとめたのは、既にあるプールにトリガーを付ける serverless の仕組み（`existing: true`）が
 * 関数ごとに `UpdateUserPool` を呼ぶため。3つの関数に分けると、同じプールを3回書き換える
 * （`scripts/attach-post-confirmation.js` の注記にある「渡さなかった項目が既定に戻る」怖さが3倍になる）。
 *
 * - Define: 1回目は CUSTOM_CHALLENGE を出す。CUSTOM_CHALLENGE が1回だけ通っていればトークンを出す。
 *   それ以外（SRP の段が混じる・2回目の答え・利用者がいない）は全部断る
 * - Create: 問いの中身は無い（答えはアプリが Apple から受け取った identity token）
 * - Verify: token を Apple の公開鍵で確かめ、`apple#<sub>` の行がこの Cognito の利用者を指していて、
 *   その nonce をまだ使っていなければ通す（同じ token の使い回しを止める）
 *
 * 🔴 **投げない。** トリガーが投げると、その文が Cognito の答えに乗って端末へ出る。何があっても「通さない」で返す。
 * 🔴 ほかの流れ（メールとパスワードの SRP）はこのトリガーを通らない（CUSTOM_AUTH のときだけ Cognito が呼ぶ）。
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import { requireEnv } from "./env";
import { appleClientIdsFromEnv, appleKey, verifyAppleIdentityToken, type FetchLike } from "./appleIdToken";

const USERS_TABLE = requireEnv("USERS_TABLE");

export const CHALLENGE = "CUSTOM_CHALLENGE";

type SessionEntry = { challengeName?: string; challengeResult?: boolean; challengeMetadata?: string };

export type AuthChallengeEvent = {
    triggerSource: string;
    userName?: string;
    request: {
        userAttributes?: Record<string, string>;
        session?: SessionEntry[];
        userNotFound?: boolean;
        challengeName?: string;
        challengeAnswer?: string;
    };
    response: Record<string, unknown>;
};

/** 試験で差し替える口 */
export const triggerDeps: { fetchImpl?: FetchLike; clientIds: () => string[]; now: () => number } = {
    fetchImpl: undefined,
    clientIds: () => appleClientIdsFromEnv(),
    now: () => Date.now(),
};

/** Define: 次の段を決める */
export function defineChallenge(event: AuthChallengeEvent): AuthChallengeEvent {
    const session = event.request.session ?? [];
    const fail = () => {
        event.response.issueTokens = false;
        event.response.failAuthentication = true;
        return event;
    };
    if (event.request.userNotFound) return fail();
    if (session.length === 0) {
        event.response.challengeName = CHALLENGE;
        event.response.issueTokens = false;
        event.response.failAuthentication = false;
        return event;
    }
    // 1回だけ・CUSTOM_CHALLENGE だけ・通ったときだけトークンを出す（やり直しはさせない）
    if (session.length === 1 && session[0].challengeName === CHALLENGE && session[0].challengeResult === true) {
        event.response.issueTokens = true;
        event.response.failAuthentication = false;
        return event;
    }
    return fail();
}

/** Create: 問いを作る（中身は無い。アプリは identity token を答える） */
export function createChallenge(event: AuthChallengeEvent): AuthChallengeEvent {
    if (event.request.challengeName === CHALLENGE) {
        event.response.publicChallengeParameters = { provider: "apple" };
        event.response.privateChallengeParameters = { provider: "apple" };
        event.response.challengeMetadata = "APPLE_ID_TOKEN";
    }
    return event;
}

/** Verify: 答え（identity token）を確かめる */
export async function verifyChallenge(event: AuthChallengeEvent): Promise<AuthChallengeEvent> {
    event.response.answerCorrect = await isCorrect(event).catch((e) => {
        console.warn("appleAuthTrigger verify:", (e as { reason?: string; name?: string })?.reason ?? (e as { name?: string })?.name);
        return false;
    });
    return event;
}

async function isCorrect(event: AuthChallengeEvent): Promise<boolean> {
    const clientIds = triggerDeps.clientIds();
    const username = event.userName;
    const cognitoSub = event.request.userAttributes?.sub;
    if (clientIds.length === 0 || !username || !cognitoSub) return false;
    const claims = await verifyAppleIdentityToken(event.request.challengeAnswer, {
        clientIds, now: triggerDeps.now(), fetchImpl: triggerDeps.fetchImpl,
    });
    if (!claims.nonce) return false;
    const key = appleKey(claims.sub);
    const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: key }, ConsistentRead: true }));
    const row = res.Item as { cognitoUsername?: string; cognitoSub?: string } | undefined;
    // 🔴 その Apple の人が結ばれているのは、いまログインしようとしている Cognito の利用者か
    if (!row || row.cognitoUsername !== username || row.cognitoSub !== cognitoSub) return false;
    // 同じ nonce（＝同じ token）は1回しか通さない
    try {
        await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: key },
            UpdateExpression: "SET lastNonce = :n, signedInAt = :at",
            ConditionExpression: "cognitoUsername = :u AND (attribute_not_exists(lastNonce) OR lastNonce <> :n)",
            ExpressionAttributeValues: { ":n": claims.nonce, ":u": username, ":at": new Date(triggerDeps.now()).toISOString() },
        }));
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
        throw e;
    }
    return true;
}

/** Cognito が呼ぶ1つの入口 */
export const handler = async (event: AuthChallengeEvent): Promise<AuthChallengeEvent> => {
    try {
        switch (event.triggerSource) {
            case "DefineAuthChallenge_Authentication":
                return defineChallenge(event);
            case "CreateAuthChallenge_Authentication":
                return createChallenge(event);
            case "VerifyAuthChallengeResponse_Authentication":
                return await verifyChallenge(event);
            default:
                return event;
        }
    } catch (e) {
        console.error("appleAuthTrigger:", (e as { name?: string })?.name);
        if (event.triggerSource.startsWith("Define")) {
            event.response.issueTokens = false;
            event.response.failAuthentication = true;
        } else if (event.triggerSource.startsWith("Verify")) {
            event.response.answerCorrect = false;
        }
        return event;
    }
};
