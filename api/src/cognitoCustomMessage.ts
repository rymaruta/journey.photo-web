/**
 * **確認コードのメールの文面**（Cognito の CustomMessage トリガー・2026-11-24・段階3）。
 *
 * それまでの文面は AWS の既定（件名も本文も英語の「Your confirmation code is …」）で、登録・パスワードの再設定・
 * メールアドレスの変更のどれも同じ文だった（何のコードか分からない）。送り元は段階2で
 * `"journey.photo" <no-reply@journey-photo.com>`（SES）にした（`scripts/setup-ses-sender.js`）。
 *
 * 文面は資料「journey.photo のメール」の案（owner が見たもの）どおり。種類ごとに件名と本文を分け、
 * 英語の画面で使っている人のために英語の1行を添える（利用者の言語を Cognito の属性で持っていないため両方を書く）。
 *
 * - 触るのは下の4種類だけ。招待（AdminCreateUser）や多要素の認証などは返り値を変えない＝AWS の既定のまま
 * - 🔴 本文には必ずコードの差し込み口（`request.codeParameter`・`{####}`）を入れる。入れないと Cognito が断り、
 *   **確認コードのメールが1通も届かなくなる**（試験が4種類すべてで見張る）
 * - 期限は確かめられている登録（24時間・`purge-unconfirmed-users` の注記）だけ書く。ほかは「送り直せます」とだけ言う
 * - 本文は 2万字まで（AWS の上限）。利用者の入れた文字は入れない（決まった文とコードだけ）
 */

type CustomMessageEvent = {
    triggerSource: string;
    request?: { codeParameter?: string; usernameParameter?: string };
    response?: { emailSubject?: string; emailMessage?: string; smsMessage?: string };
};

type Kind = "signup" | "resend" | "forgot" | "attribute";

const KIND: Record<string, Kind> = {
    CustomMessage_SignUp: "signup",
    CustomMessage_ResendCode: "resend",
    CustomMessage_ForgotPassword: "forgot",
    CustomMessage_UpdateUserAttribute: "attribute",
    CustomMessage_VerifyUserAttribute: "attribute",
};

type Copy = { subject: string; lead: string; note: string; en: string };

const COPY: Record<Kind, Copy> = {
    signup: {
        subject: "journey.photo の登録の確認コード",
        lead: "journey.photo へのご登録ありがとうございます。登録の画面に、次の確認コードを入力してください。",
        note: "このコードの期限は24時間です。心当たりが無い場合は、このメールを捨ててください。コードを入れない限り、登録は完了しません。",
        en: "Your journey.photo sign-up code is shown above.",
    },
    resend: {
        subject: "journey.photo の登録の確認コード（再送）",
        lead: "確認コードを送り直しました。前に送ったコードは使えなくなっています。新しいコードを入力してください。",
        note: "このコードの期限は24時間です。心当たりが無い場合は、このメールを捨ててください。",
        en: "Here is your new journey.photo sign-up code.",
    },
    forgot: {
        subject: "journey.photo のパスワード再設定の確認コード",
        lead: "パスワードの再設定のご依頼を受け付けました。再設定の画面に、次の確認コードと新しいパスワードを入力してください。",
        note: "期限が切れた場合は、画面から送り直せます。ご依頼に心当たりが無い場合は、このメールを捨ててください。パスワードは変わりません。",
        en: "Your journey.photo password reset code is shown above.",
    },
    attribute: {
        subject: "journey.photo の新しいメールアドレスの確認",
        lead: "このアドレスを journey.photo のログインのメールアドレスにする手続きです。設定の画面に、次の確認コードを入力してください。",
        note: "コードを入力するまでは、いままでのアドレスでログインできます。心当たりが無い場合は、このメールを捨ててください。アドレスは変わりません。",
        en: "Your journey.photo email confirmation code is shown above.",
    },
};

/** 公式の絞りのアイコン（サイトのヘッダー・フッターと同じ `public/logo-aperture.png`・64px を 36px で出す） */
export const LOGO_URL = "https://journey-photo.com/logo-aperture.png";
/** 文字ロゴの字体（サイトの `--font-wordmark` と同じ並び。iPhone は New York・ほかは Georgia） */
export const WORDMARK_FONT = "ui-serif,'New York',Georgia,serif";

/**
 * メールの HTML（メールの読み手で崩れにくい表組み＋行の中の style だけ）。外の CSS・字体は読まない。
 * 画像は公式のアイコン1つだけ（画像を止めている読み手でも、隣の「Journey Photo」の字で誰からか分かる）
 */
function html(c: Copy, code: string): string {
    return [
        '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        `<title>${c.subject}</title></head>`,
        '<body style="margin:0;padding:0;background:#0b0b0c;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;"><tr><td align="center" style="padding:24px 16px;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;font-family:-apple-system,\'Hiragino Sans\',\'Noto Sans JP\',sans-serif;color:#f2f0eb;">',
        // 頭は公式のロゴ（サイトのフッターと同じ組み方: 絞りのアイコン＋文字ロゴの字体の「Journey Photo」・2026-11-24 owner「公式アイコンと、フォントで統一」）
        `<tr><td style="padding:0 0 20px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>`,
        `<td style="padding:0 10px 0 0;vertical-align:middle;"><img src="${LOGO_URL}" width="36" height="36" alt="" style="display:block;border:0;width:36px;height:36px;"></td>`,
        `<td style="vertical-align:middle;font-family:${WORDMARK_FONT};font-size:24px;font-weight:600;letter-spacing:-0.02em;color:#f2f0eb;">Journey Photo</td>`,
        "</tr></table></td></tr>",
        `<tr><td style="font-size:15px;line-height:1.8;padding:0 0 16px;">${c.lead}</td></tr>`,
        `<tr><td align="center" style="font-family:Menlo,Consolas,monospace;font-size:30px;font-weight:600;letter-spacing:0.3em;color:#f2f0eb;background:#151517;border:1px solid #c9a66b;border-radius:8px;padding:12px 0;">${code}</td></tr>`,
        `<tr><td style="font-size:12px;line-height:1.7;color:#a39f96;padding:16px 0 0;">${c.note}</td></tr>`,
        `<tr><td style="font-size:12px;line-height:1.7;color:#a39f96;padding:12px 0 0;">${c.en}</td></tr>`,
        "</table></td></tr></table></body></html>",
    ].join("");
}

/**
 * 種類とコードの差し込み口から、件名と本文を作る（純関数・試験できる）。
 * 知らない種類は null（呼ぶ側は何も変えない＝AWS の既定の文面）
 */
export function customMessageFor(triggerSource: string, codeParameter: string): { subject: string; html: string } | null {
    const kind = KIND[triggerSource];
    if (!kind || !codeParameter) return null;
    const c = COPY[kind];
    return { subject: c.subject, html: html(c, codeParameter) };
}

export const handler = async (event: CustomMessageEvent): Promise<CustomMessageEvent> => {
    const m = customMessageFor(event.triggerSource, event.request?.codeParameter ?? "");
    if (m) {
        event.response = { ...(event.response ?? {}), emailSubject: m.subject, emailMessage: m.html };
    }
    return event;
};
