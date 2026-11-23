/**
 * 「メールで自動で結んだ」ことを、そのアカウントの持ち主に知らせる関数（HTTP の口ではない・札 journey.photo-ios#601・#715）。
 * サインインの口（Apple・Google）が `federatedNoticeClient.ts` から待たずに呼ぶ。
 *
 * 2026-11-23 owner の決定: **メール（SES）とプッシュの両方で知らせる。** 文は短く、本文は「心当たりが無ければ、こちらから連携を解除できます。」（2026-11-23 owner「外す」ではなく「解除」）と
 * 「サインインの方法」へのリンク1つ（前の「パスワードを変えてください」はやめた。パスワードを変えても Apple から入れてしまうため）。
 *
 * - メール: SES（SESv2 の SendEmail）。送るのは `SIGNIN_EMAIL_ENABLED` が true の環境だけ（既定は送らない・SES の準備は
 *   iOS の `docs/APPLE_SIGNIN.md`）。宛先は Cognito のそのアカウントの確かめ済みのメール（sub で探す）。送れなくても何も止めない
 * - プッシュ: 今ある知らせの仕組み（APNs・`apns.ts`）。押すとアプリの「サインインの方法」が開く（`data.type`）
 *
 * 🔴 APNs の鍵を持つのはこの関数だけ（サインインの口には置かない・2026-11-23 確かめ役の3回目）。鍵の置き場は
 *    Apple でサインインと同じ（SSM の形では実行時に読む・`appleIdToken.ts` の `loadSigningKeyPem`）
 */
import { ListUsersCommand, type AttributeType } from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { apnsConfigured, sendPush, useApnsPrivateKey as setApnsPrivateKey } from "./apns";
import { deviceTokens } from "./devices";
import { loadSigningKeyPem } from "./appleIdToken";
import { federatedDeps, filterValue, isProvider, type Provider } from "./federatedAccount";

const PROVIDER_LABEL: Record<Provider, string> = { apple: "Apple", google: "Google" };

/** 知らせのリンクの行き先。アプリが入っていればアプリの「サインインの方法」が開き（universal link）、無ければ Web の説明の頁 */
export const SIGNIN_METHODS_URL = "https://journey-photo.com/signin-methods";
/** 送り元の既定（変数 `SIGNIN_EMAIL_FROM` で変えられる。SES でドメインを確かめてから使う） */
export const DEFAULT_FROM = "no-reply@journey-photo.com";
/** 差出人の名前 */
export const FROM_NAME = "journey.photo";
/** プッシュの中身の種類（アプリが「サインインの方法」を開く印・iOS の `AppDelegate.swift`） */
export const PUSH_TYPE = "signin_methods";

type EmailMessage = { to: string; subject: string; text: string; html: string };

let ses: SESv2Client | null = null;

export const noticeDeps: {
    tokens: (uid: string) => Promise<string[]>;
    push: typeof sendPush;
    pushKey: () => Promise<string>;
    /** そのアカウントの確かめ済みのメール（Cognito） */
    email: (uid: string) => Promise<string | undefined>;
    sendEmail: (from: string, msg: EmailMessage) => Promise<void>;
    emailEnabled: () => boolean;
    from: () => string;
} = {
    tokens: (uid) => deviceTokens(uid),
    push: sendPush,
    pushKey: () => loadSigningKeyPem(),
    email: async (uid) => {
        const res = await federatedDeps.idp.send(new ListUsersCommand({
            UserPoolId: federatedDeps.poolId(), Filter: `sub = "${filterValue(uid)}"`, Limit: 1,
        })) as { Users?: { Attributes?: AttributeType[] }[] };
        const attrs = res.Users?.[0]?.Attributes;
        // 確かめ済みのメールにだけ送る
        if (attrs?.find((a) => a.Name === "email_verified")?.Value !== "true") return undefined;
        return attrs.find((a) => a.Name === "email")?.Value || undefined;
    },
    sendEmail: async (from, msg) => {
        ses ??= new SESv2Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
        await ses.send(new SendEmailCommand({
            FromEmailAddress: from,
            Destination: { ToAddresses: [msg.to] },
            Content: {
                Simple: {
                    Subject: { Data: msg.subject, Charset: "UTF-8" },
                    Body: { Text: { Data: msg.text, Charset: "UTF-8" }, Html: { Data: msg.html, Charset: "UTF-8" } },
                },
            },
        }));
    },
    emailEnabled: () => process.env.SIGNIN_EMAIL_ENABLED === "true",
    from: () => (process.env.SIGNIN_EMAIL_FROM ?? "").trim() || DEFAULT_FROM,
};

/**
 * 題（提供元の名前だけを入れる。メールや相手の情報は入れない）。
 * 2026-11-23 判断（owner「結ばれました、は日常で使わない」「長すぎる」）: 話し言葉で短く。
 * Apple の決まりの呼び名は「サインイン」、Google は「ログイン」（ボタンの文と同じ）
 */
export function linkNoticeTitle(provider: Provider): string {
    return `${PROVIDER_LABEL[provider]} で${provider === "apple" ? "サインイン" : "ログイン"}できます`;
}

export const LINK_NOTICE_BODY = "心当たりが無ければ、こちらから連携を解除できます。";

/** プッシュの文。押すと「サインインの方法」が開く */
export function linkNoticeMessage(provider: Provider): { title: string; body: string; data: Record<string, string> } {
    return { title: linkNoticeTitle(provider), body: LINK_NOTICE_BODY, data: { type: PUSH_TYPE } };
}

/** 差出人（`"journey.photo" <no-reply@…>`） */
export const fromHeader = (address: string) => `"${FROM_NAME}" <${address}>`;

/** メールの文（HTML とテキストの両方）。中身は決まった文とリンクだけ（利用者の入れた文字は入れない） */
export function linkNoticeEmail(provider: Provider, to: string): EmailMessage {
    const subject = linkNoticeTitle(provider);
    const text = `${LINK_NOTICE_BODY}\n${SIGNIN_METHODS_URL}\n\n${FROM_NAME}\n`;
    const html = [
        "<!doctype html>",
        `<html lang="ja"><head><meta charset="utf-8"><title>${subject}</title></head>`,
        "<body style=\"margin:0;padding:24px;background:#ffffff;color:#111111;font-family:-apple-system,'Hiragino Sans',sans-serif;font-size:15px;line-height:1.7\">",
        `<p style="margin:0 0 16px">${LINK_NOTICE_BODY}</p>`,
        `<p style="margin:0 0 24px"><a href="${SIGNIN_METHODS_URL}" style="color:#111111">サインインの方法を開く</a></p>`,
        `<p style="margin:0;color:#666666;font-size:13px">${FROM_NAME}</p>`,
        "</body></html>",
    ].join("");
    return { to, subject, text, html };
}

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? "";

/** メールを送る（投げない）。送ったら true */
async function sendLinkEmail(uid: string, provider: Provider): Promise<boolean> {
    if (!noticeDeps.emailEnabled()) return false;
    try {
        const to = await noticeDeps.email(uid);
        if (!to) return false;
        await noticeDeps.sendEmail(fromHeader(noticeDeps.from()), linkNoticeEmail(provider, to));
        // ログにメールや番号は出さない
        console.log(JSON.stringify({ metric: "federated_link_email", provider }));
        return true;
    } catch (e) {
        console.warn("federated link email:", errName(e));
        return false;
    }
}

/** プッシュを送る（投げない） */
async function sendLinkPush(uid: string, provider: Provider): Promise<number> {
    try {
        const tokens = await noticeDeps.tokens(uid);
        if (tokens.length === 0) return 0;
        // 鍵を SSM に置いた形（環境変数に鍵が無い）では、実行時に読んだ鍵で送る（同じ APNs の鍵）
        if (!apnsConfigured()) setApnsPrivateKey((await noticeDeps.pushKey()).trim());
        const res = await noticeDeps.push(tokens, linkNoticeMessage(provider));
        return res.sent;
    } catch (e) {
        console.warn("federated link push:", errName(e));
        return 0;
    }
}

export const linkNoticeHandler = async (event: { cognitoSub?: unknown; provider?: unknown }): Promise<{ sent: number; emailed: boolean }> => {
    if (typeof event?.cognitoSub !== "string" || !event.cognitoSub || event.cognitoSub.length > 128 || !isProvider(event.provider)) {
        return { sent: 0, emailed: false };
    }
    const [emailed, sent] = await Promise.all([
        sendLinkEmail(event.cognitoSub, event.provider),
        sendLinkPush(event.cognitoSub, event.provider),
    ]);
    return { sent, emailed };
};
