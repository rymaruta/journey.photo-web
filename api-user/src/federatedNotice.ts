/**
 * 「メールで自動で結んだ」ことを、そのアカウントの持ち主の端末へ知らせる関数（HTTP の口ではない・札 journey.photo-ios#601・#715）。
 * サインインの口（Apple・Google）が `federatedNoticeClient.ts` から待たずに呼ぶ。
 *
 * 🔴 サーバーにはメールを送る仕組みが無い（Cognito の既定のメールだけ。SES は使っていない）ので、
 *    今ある知らせの仕組み（APNs のプッシュ・`apns.ts`）で送る。
 * 🔴 APNs の鍵を持つのはこの関数だけ（サインインの口には置かない・2026-11-23 確かめ役の3回目）。鍵の置き場は
 *    Apple でサインインと同じ（SSM の形では実行時に読む・`appleIdToken.ts` の `loadSigningKeyPem`）
 */
import { apnsConfigured, sendPush, useApnsPrivateKey } from "./apns";
import { deviceTokens } from "./devices";
import { loadSigningKeyPem } from "./appleIdToken";
import { isProvider, type Provider } from "./federatedAccount";

const PROVIDER_LABEL: Record<Provider, string> = { apple: "Apple", google: "Google" };

export const noticeDeps: {
    tokens: (uid: string) => Promise<string[]>;
    push: typeof sendPush;
    pushKey: () => Promise<string>;
} = {
    tokens: (uid) => deviceTokens(uid),
    push: sendPush,
    pushKey: () => loadSigningKeyPem(),
};

/** 知らせの文（提供元の名前だけを入れる。メールや相手の情報は入れない） */
export function linkNoticeMessage(provider: Provider): { title: string; body: string } {
    const name = PROVIDER_LABEL[provider];
    return {
        // 2026-11-23 判断（owner「結ばれました、は日常で使わない」「長すぎる」）: 題は話し言葉で短く、本文は1文だけ。
        // Apple の決まりの呼び名は「サインイン」、Google は「ログイン」（ボタンの文と同じ）
        title: `${name} で${provider === "apple" ? "サインイン" : "ログイン"}できます`,
        body: "心当たりが無ければ、パスワードを変えてください。",
    };
}

export const linkNoticeHandler = async (event: { cognitoSub?: unknown; provider?: unknown }): Promise<{ sent: number }> => {
    if (typeof event?.cognitoSub !== "string" || !event.cognitoSub || event.cognitoSub.length > 128 || !isProvider(event.provider)) {
        return { sent: 0 };
    }
    const tokens = await noticeDeps.tokens(event.cognitoSub);
    if (tokens.length === 0) return { sent: 0 };
    // 鍵を SSM に置いた形（環境変数に鍵が無い）では、実行時に読んだ鍵で送る（同じ APNs の鍵）
    if (!apnsConfigured()) useApnsPrivateKey((await noticeDeps.pushKey()).trim());
    const res = await noticeDeps.push(tokens, linkNoticeMessage(event.provider));
    return { sent: res.sent };
};
