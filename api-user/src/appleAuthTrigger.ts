/**
 * 外のアカウントでのサインイン（Apple・札 journey.photo-ios#601。次に Google・#715）の Cognito のトリガー（CUSTOM_AUTH）。
 *
 * 1つの関数で3つ（Define・Create・Verify）を受ける。`triggerSource` で分ける。
 * 1つにまとめたのは、既にあるプールにトリガーを付ける serverless の仕組み（`existing: true`）が
 * 関数ごとに `UpdateUserPool` を呼ぶため。3つの関数に分けると、同じプールを3回書き換える
 * （`scripts/attach-post-confirmation.js` の注記にある「渡さなかった項目が既定に戻る」怖さが3倍になる）。
 *
 * - Define: 1回目は CUSTOM_CHALLENGE を出す。CUSTOM_CHALLENGE が1回だけ通っていればトークンを出す。
 *   それ以外（SRP の段が混じる・2回目の答え・利用者がいない）は全部断る
 * - Create: 問いの中身は無い（答えは `POST /auth/apple` が出した使い捨ての券）
 * - Verify: 券を照らして消す（`federatedAccount.ts` の `consumeTicket`）。券の行がこの Cognito の利用者を指し、
 *   期限内で、合っていて（時間の差が出ない比べ方）、まだ使っていないときだけ通す。
 *   2026-11-23 確かめ役の指摘で、identity token をここで確かめ直す形（直前の nonce と違えば通る）から改めた。
 *   盗まれた token が期限内なら再び通っていた
 *
 * 🔴 **投げない。** トリガーが投げると、その文が Cognito の答えに乗って端末へ出る。何があっても「通さない」で返す。
 * 🔴 ほかの流れ（メールとパスワードの SRP）はこのトリガーを通らない（CUSTOM_AUTH のときだけ Cognito が呼ぶ）。
 */
import { consumeTicket } from "./federatedAccount";

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

/** Create: 問いを作る（中身は無い。アプリは `POST /auth/apple` が出した券を答える） */
export function createChallenge(event: AuthChallengeEvent): AuthChallengeEvent {
    if (event.request.challengeName === CHALLENGE) {
        event.response.publicChallengeParameters = { kind: "ticket" };
        event.response.privateChallengeParameters = { kind: "ticket" };
        event.response.challengeMetadata = "FEDERATED_TICKET";
    }
    return event;
}

/** Verify: 答え（券）を照らして消す */
export async function verifyChallenge(event: AuthChallengeEvent): Promise<AuthChallengeEvent> {
    event.response.answerCorrect = await isCorrect(event).catch((e) => {
        console.warn("appleAuthTrigger verify:", (e as { reason?: string; name?: string })?.reason ?? (e as { name?: string })?.name);
        return false;
    });
    return event;
}

async function isCorrect(event: AuthChallengeEvent): Promise<boolean> {
    const username = event.userName;
    const cognitoSub = event.request.userAttributes?.sub;
    if (!username || !cognitoSub) return false;
    return consumeTicket(event.request.challengeAnswer, username, cognitoSub);
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
