/**
 * **確認コードのメールの文面**（Cognito の CustomMessage トリガー・2026-11-24・段階3）。
 *
 * それまでの文面は AWS の既定（件名も本文も英語の「Your confirmation code is …」）で、登録・パスワードの再設定・
 * メールアドレスの変更のどれも同じ文だった（何のコードか分からない）。送り元は段階2で
 * `"Journey Photo" <no-reply@journey-photo.com>`（SES）にした（`scripts/setup-ses-sender.js`）。
 *
 * 文面は資料「journey.photo のメール」の案（owner が見たもの）を、owner の「文面やデザインもとことんこだわって」
 * （2026-11-24）で磨いたもの。名前はサイトの文字ロゴと同じ「Journey Photo」に揃える（件名・差出人・本文）。
 * 種類ごとに件名・見出し・本文を分け、英語の画面で使っている人のために英語の要約を添える
 * （利用者の言語を Cognito の属性で持っていないため両方を書く）。4種類すべてに「コードを人に教えない」を出す。
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

type Copy = {
    /** 件名。先頭の【Journey Photo】で、受信箱の一覧でも誰からか分かる */
    subject: string;
    /** 受信箱の一覧で件名の次に出る1行（本文には出さない） */
    preheader: string;
    /** 本文の見出し */
    heading: string;
    /** 何をしてほしいか */
    lead: string;
    /** コードの下の1行（期限が確かめられている登録だけ期限を書く） */
    expiry: string;
    /** 心当たりが無いとき */
    unexpected: string;
    /** 英語の画面の人のための要約 */
    en: string;
};

const SIGNUP_EXPIRY = "有効期限は24時間です。";
const SIGNUP_EN = "Enter this code to finish signing up for Journey Photo. It expires in 24 hours. If you didn't sign up, you can ignore this email.";

const COPY: Record<Kind, Copy> = {
    signup: {
        subject: "【Journey Photo】登録の確認コード",
        preheader: "登録を完了するための確認コードをお送りします。",
        heading: "登録の確認コード",
        lead: "Journey Photo へのご登録ありがとうございます。登録の画面に、次の確認コードを入力してください。",
        expiry: SIGNUP_EXPIRY,
        unexpected: "お心当たりが無い場合は、このメールを破棄してください。コードが入力されない限り、登録は完了しません。",
        en: SIGNUP_EN,
    },
    resend: {
        subject: "【Journey Photo】登録の確認コード（再送）",
        preheader: "新しい確認コードをお送りします。以前のコードは使えません。",
        heading: "確認コードを再送しました",
        lead: "新しい確認コードをお送りします。以前お送りしたコードは使えなくなりましたので、こちらを入力してください。",
        expiry: SIGNUP_EXPIRY,
        unexpected: "お心当たりが無い場合は、このメールを破棄してください。コードが入力されない限り、登録は完了しません。",
        en: SIGNUP_EN,
    },
    forgot: {
        subject: "【Journey Photo】パスワード再設定の確認コード",
        preheader: "パスワードを再設定するための確認コードをお送りします。",
        heading: "パスワードの再設定",
        lead: "パスワード再設定のご依頼を受け付けました。再設定の画面に、次の確認コードと新しいパスワードを入力してください。",
        expiry: "期限が切れた場合は、再設定の画面からコードを送り直せます。",
        unexpected: "お心当たりが無い場合は、このメールを破棄してください。パスワードは変更されません。",
        en: "Enter this code to reset your Journey Photo password. If you didn't request a reset, you can ignore this email — your password won't change.",
    },
    attribute: {
        subject: "【Journey Photo】メールアドレス変更の確認コード",
        preheader: "新しいメールアドレスを確認するためのコードをお送りします。",
        heading: "メールアドレスの確認",
        lead: "このアドレスを Journey Photo のログイン用メールアドレスに設定する手続きです。設定の画面に、次の確認コードを入力してください。",
        expiry: "コードを入力するまでは、これまでのメールアドレスでログインできます。",
        unexpected: "お心当たりが無い場合は、このメールを破棄してください。メールアドレスは変更されません。",
        en: "Enter this code to confirm your new Journey Photo email address. If you didn't request this change, you can ignore this email.",
    },
};

/** 公式の絞りのアイコン（サイトのヘッダー・フッターと同じ `public/logo-aperture.png`・サイトと同じく 36px で出す） */
export const LOGO_URL = "https://journey-photo.com/logo-aperture.png";
/** フッターのサイトへのリンク */
export const SITE_URL = "https://journey-photo.com/";
/** 文字ロゴの字体（サイトの `--font-wordmark` と同じ並び。iPhone は New York・ほかは Georgia） */
export const WORDMARK_FONT = "ui-serif,'New York',Georgia,serif";
/** サイトの言葉（`AuthPhotoBand` と同じ） */
export const TAGLINE = "写真から、次の旅が始まる。";
/** 誰にも教えないでほしい、の1文（4種類すべてに出す） */
export const DO_NOT_SHARE = "このコードは、ほかの人に教えないでください。Journey Photo の運営から確認コードをお尋ねすることはありません。";

// 色（サイトの暗い面と同じ系統。真っ黒・真っ白を避けて目に強すぎないように）
const BG = "#0b0b0c";
const SURFACE = "#141416";
const LINE = "#26262a";
const TEXT = "#f2f0eb";
const MUTED = "#a39f96";
const FAINT = "#7d7a73";
const BRASS = "#c9a66b";
const SANS = "-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic',Meiryo,sans-serif";

/**
 * メールの HTML（メールの読み手で崩れにくい表組み＋行の中の style だけ）。外の CSS・字体は読まない。
 * 画像は公式のアイコン1つだけ（画像を止めている読み手でも、隣の「Journey Photo」の字で誰からか分かる）。
 *
 * - 暗い面のデザインなので `color-scheme: dark` を宣言する（iPhone のメールなどが色を勝手に反転させない）
 * - 受信箱の一覧の1行（preheader）は本文の先頭に隠して置く。置かないと本文の最初の字（ロゴの alt など）が出る
 * - コードは等幅・字間を空けて大きく。長押し1回で全部選べるように `user-select: all`
 */
function html(c: Copy, code: string): string {
    const p = (style: string, body: string) => `<tr><td style="${style}">${body}</td></tr>`;
    return [
        '<!doctype html><html lang="ja"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="x-apple-disable-message-reformatting">',
        '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">',
        `<title>${c.subject}</title></head>`,
        `<body style="margin:0;padding:0;background:${BG};color-scheme:dark;-webkit-text-size-adjust:100%;">`,
        // 受信箱の一覧の1行（本文には見せない）。後ろの空白は、続く本文の字が一覧に混ざらないための詰め物
        `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${BG};mso-hide:all;">${c.preheader}${"&#8203;&nbsp;".repeat(40)}</div>`,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};"><tr><td align="center" style="padding:40px 16px 32px;">`,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;font-family:${SANS};color:${TEXT};">`,
        // 頭は公式のロゴ（サイトのフッターと同じ組み方: 絞りのアイコン＋文字ロゴの字体の「Journey Photo」・2026-11-24 owner「公式アイコンと、フォントで統一」）
        `<tr><td style="padding:0 4px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
        `<td style="padding:0 10px 0 0;vertical-align:middle;"><img src="${LOGO_URL}" width="36" height="36" alt="" style="display:block;border:0;outline:none;width:36px;height:36px;"></td>`,
        `<td style="vertical-align:middle;font-family:${WORDMARK_FONT};font-size:24px;font-weight:600;letter-spacing:-0.02em;line-height:1;color:${TEXT};">Journey Photo</td>`,
        "</tr></table></td></tr>",
        // 本体のカード
        `<tr><td style="background:${SURFACE};border:1px solid ${LINE};border-radius:14px;padding:32px 28px;">`,
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">',
        p(`font-size:20px;font-weight:700;line-height:1.5;letter-spacing:0.02em;color:${TEXT};padding:0 0 12px;`, c.heading),
        p(`font-size:15px;line-height:1.85;color:${TEXT};padding:0 0 24px;`, c.lead),
        `<tr><td align="center" style="background:${BG};border:1px solid ${BRASS};border-radius:10px;padding:18px 8px;">`,
        `<span style="font-family:'SF Mono',Menlo,Consolas,'Roboto Mono',monospace;font-size:34px;font-weight:600;letter-spacing:0.35em;padding-left:0.35em;line-height:1.2;color:${TEXT};-webkit-user-select:all;user-select:all;">${code}</span>`,
        "</td></tr>",
        p(`font-size:13px;line-height:1.7;color:${MUTED};padding:12px 0 0;text-align:center;`, c.expiry),
        p(`padding:24px 0 0;`, `<div style="border-left:2px solid ${BRASS};padding:2px 0 2px 12px;font-size:13px;line-height:1.75;color:${MUTED};">${DO_NOT_SHARE}</div>`),
        p(`font-size:13px;line-height:1.75;color:${MUTED};padding:16px 0 0;`, c.unexpected),
        p(`padding:24px 0 0;`, `<div style="border-top:1px solid ${LINE};padding:16px 0 0;font-size:12px;line-height:1.7;color:${FAINT};" lang="en">${c.en}</div>`),
        "</table></td></tr>",
        // 足もと（サイトの言葉・返信の行き先・サイトへのリンク）
        p(`padding:24px 4px 0;font-size:12px;line-height:1.8;color:${FAINT};`,
            `<span style="font-family:${WORDMARK_FONT};font-size:13px;color:${MUTED};">${TAGLINE}</span><br>`
            + "このメールは送信専用のアドレスからお送りしています。ご返信いただくと、Journey Photo のお問い合わせ窓口に届きます。<br>"
            + `<a href="${SITE_URL}" style="color:${MUTED};text-decoration:underline;">journey-photo.com</a>`),
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
