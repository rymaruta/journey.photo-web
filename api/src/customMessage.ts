/**
 * 確認コードのメール（Cognito の CustomMessage トリガー・札 journey.photo-ios の「確認コードのメール」）。
 *
 * それまでの文面はプールの VerificationMessageTemplate（コンソールで手で入れた1通）で、
 * **新規登録とパスワードの再設定が同じ文面**だった（再設定で受け取った owner に「旅の記録を始めるための確認コード」
 * 「ご登録を完了させるために」と届いた・2026-11-25）。このトリガーで用途ごとに文面を分ける。
 *
 * - 文面を作るのは `CustomMessage_SignUp`・`CustomMessage_ResendCode`（新規登録）、`CustomMessage_ForgotPassword`（再設定）、
 *   `CustomMessage_UpdateUserAttribute`・`CustomMessage_VerifyUserAttribute`（メールアドレスの確認）だけ。
 *   それ以外（`AdminCreateUser`・`Authentication` など）は何も書かずに返す＝プールの今の文面のまま
 * - **投げない。** このトリガーが落ちると Cognito は登録・再設定そのものを失敗にする。作れなかったら何も書かずに返し、
 *   プールの今の文面に戻す
 * - 見た目は案「黒の切符」（案の頁 https://claude.ai/artifact/KVvGjEoZM4gH7SManTKjJb）。デザインの板「黒塗りの真鍮」の色:
 *   地は黒、札は surface-1 #0E0E0F、真鍮 #C9A66B は黒地の上だけ（眉ラベル・切符の罫・リンク）、副文 #B8B8B8、注記 #9A9A9A
 * - メールの決まり: 表の組み・インラインの CSS・幅 600（狭い画面は 100%）。Gmail はウェブフォントを読まないので、
 *   明朝は端末の明朝（ヒラギノ明朝・游明朝）に落ちる。画像が出ない受信箱でも、名前とコードは文字で残る
 * - **コードは空白なしの1つの文字列。** 字の間は letter-spacing で空ける（コピーしても空白が入らない）。
 *   本文の文字は「Journey Photo」の次が「確認コード 123456」（受信箱の一覧・iOS の知らせ・キーボードの候補に効く並び）。
 *   `{####}` は1回だけ書く（Cognito が2つ目以降も置き換えるかは確かめていない。隠した下見の行に入れると、
 *   見える方が `{####}` のまま届くおそれがあるので置かない）
 * - 有効期限は Cognito の決まり: 登録とメールアドレスの確認のコードは24時間、再設定のコードは1時間（AWS の説明書きの値。
 *   本番のメールでは確かめていない）
 * - 利用者が入れた文字（名前・メールアドレス）は入れない。入るのは決まった文と、Cognito が置き換える `{####}` だけ
 */

/** Cognito が渡す形（使う所だけ） */
export type CustomMessageEvent = {
    triggerSource: string;
    request?: { codeParameter?: string; usernameParameter?: string | null; userAttributes?: Record<string, string> };
    response?: { emailSubject?: string | null; emailMessage?: string | null; smsMessage?: string | null };
};

export type MailKind = "signup" | "reset" | "verifyEmail";

/** トリガーの種類 → メールの種類（無いものは触らない） */
export function mailKindFor(triggerSource: string): MailKind | null {
    switch (triggerSource) {
        case "CustomMessage_SignUp":
        case "CustomMessage_ResendCode":
            return "signup";
        case "CustomMessage_ForgotPassword":
            return "reset";
        case "CustomMessage_UpdateUserAttribute":
        case "CustomMessage_VerifyUserAttribute":
            return "verifyEmail";
        default:
            return null;
    }
}

/** サイト（画像はここから読む。メールの中の画像は公開の URL でしか出せない） */
export const SITE = "https://journey-photo.com";
/** ロゴ（アプリのアイコンと同じ黒地に白の絞り。`public/icon-192.png`） */
export const LOGO_URL = `${SITE}/icon-192.png`;
/**
 * 上の写真（オペラ・ガルニエ。owner 本人の投稿 https://journey-photo.com/photo/e4e47af3-08e9-4791-8fd3-d8688a52d22c の写真を
 * owner の承諾でこの用途に使う・2026-11-25。人の写らない上の部分を切り出し、下の端を黒に溶かした。`public/email/hero-opera-garnier.jpg`）
 */
export const PHOTO_URL = `${SITE}/email/hero-opera-garnier.jpg`;
export const PHOTO_ALT = "オペラ・ガルニエ（パリ）";
export const BRAND = "Journey Photo";

type Copy = { subject: string; label: string; expiry: string; heading: string; body: string; ignore: string };

/** 文面（平易な日本語・「・」で区切らない・「捨てる」系を言わない） */
export const COPY: Record<MailKind, Copy> = {
    signup: {
        subject: `${BRAND} 新規登録の確認コード`,
        label: "新規登録",
        expiry: "24時間",
        heading: `ようこそ、${BRAND} へ`,
        body: "登録の画面に、上の6桁のコードを入れてください。登録が終わると、みんなの旅の写真を見たり、自分の写真を載せたりできます。",
        ignore: "心当たりが無ければ、このメールは無視してください。登録は完了しません。",
    },
    reset: {
        subject: `${BRAND} パスワード再設定の確認コード`,
        label: "パスワードの再設定",
        expiry: "1時間",
        heading: "パスワードの再設定",
        body: "再設定の画面に、上の6桁のコードを入れてください。続けて、新しいパスワードを決められます。",
        ignore: "心当たりが無ければ、このメールは無視してください。パスワードは変わりません。",
    },
    verifyEmail: {
        subject: `${BRAND} メールアドレスの確認コード`,
        label: "メールアドレスの確認",
        expiry: "24時間",
        heading: "メールアドレスの確認",
        body: "アプリの画面に、上の6桁のコードを入れてください。確認が済むと、このメールアドレスでログインできます。",
        ignore: "心当たりが無ければ、このメールは無視してください。メールアドレスは変わりません。",
    },
};

export const NO_SHARE = "このコードは、ほかの人に教えないでください。";
export const TAGLINE = "旅の写真を、気軽に眺める。";

// 色（デザインの板「黒塗りの真鍮」の値）
const C = {
    bg: "#000000", card: "#0E0E0F", line: "#1F1F21", text: "#FFFFFF", text2: "#B8B8B8", text3: "#9A9A9A",
    brass: "#C9A66B", brassLine: "#5A4B33", cardEdge: "#2E2820",
} as const;
const SANS = "-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',Arial,sans-serif";
const MINCHO = "'Shippori Mincho B1','Hiragino Mincho ProN','Hiragino Mincho Pro','Yu Mincho','YuMincho',serif";
const SERIF = "'New York','Iowan Old Style',Georgia,'Times New Roman',serif";
const DIGITS = "-apple-system,'SF Pro Display','Helvetica Neue',Arial,sans-serif";

/**
 * メールの HTML。`code` は Cognito が置き換える `{####}`（試験では数字を渡して見た目を確かめる）。
 * 長さは Cognito の上限（20,000 字）より十分小さく保つ（試験で見張る）
 */
export function verificationEmailHtml(kind: MailKind, code: string): string {
    const t = COPY[kind];
    const tbl = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
    return [
        "<!doctype html>",
        '<html lang="ja"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
        `<title>${t.subject}</title>`,
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@700&amp;display=swap">',
        "<style>",
        ":root{color-scheme:light dark;supported-color-schemes:light dark}",
        `body{margin:0;padding:0;background:${C.bg}}`,
        "a{text-decoration:none}",
        "@media (max-width:620px){.px{padding-left:24px!important;padding-right:24px!important}.code{font-size:38px!important;letter-spacing:8px!important}.h1{font-size:22px!important}}",
        "</style></head>",
        `<body bgcolor="${C.bg}" style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">`,
        `<table ${tbl} width="100%" bgcolor="${C.bg}" style="background:${C.bg}"><tr><td align="center">`,
        `<table ${tbl} width="600" style="width:100%;max-width:600px">`,
        // ロゴと名前（画像が出なくても名前は文字で残る）
        `<tr><td class="px" style="padding:28px 40px 20px">`,
        `<table ${tbl}><tr>`,
        `<td width="32" style="width:32px"><img src="${LOGO_URL}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;border-radius:8px"></td>`,
        `<td style="padding-left:10px;font-family:${SERIF};font-size:20px;line-height:32px;font-weight:700;letter-spacing:-0.3px;color:${C.text}">${BRAND}</td>`,
        "</tr></table></td></tr>",
        // 写真（画像が出ないときは暗い面に説明の文字）
        `<tr><td bgcolor="${C.card}" style="background:${C.card};font-family:${SANS};font-size:12px;color:${C.text3}">`,
        `<img src="${PHOTO_URL}" width="600" alt="${PHOTO_ALT}" style="display:block;width:100%;max-width:600px;height:auto;border:0">`,
        "</td></tr>",
        // 切符（コード）
        `<tr><td class="px" style="padding:4px 40px 0">`,
        `<table ${tbl} width="100%" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.cardEdge};border-radius:14px">`,
        `<tr><td style="padding:20px 24px 0"><table ${tbl} width="100%"><tr>`,
        `<td style="font-family:${SANS};font-size:11px;line-height:16px;font-weight:600;letter-spacing:2px;color:${C.brass}">確認コード</td>`,
        "</tr></table></td></tr>",
        `<tr><td class="code" style="padding:12px 24px 22px;font-family:${DIGITS};font-size:44px;line-height:52px;font-weight:600;letter-spacing:10px;color:${C.text};font-variant-numeric:tabular-nums">${code}</td></tr>`,
        `<tr><td style="padding:0 24px"><div style="border-top:1px dashed ${C.brassLine};height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>`,
        `<tr><td style="padding:14px 24px 18px"><table ${tbl} width="100%"><tr>`,
        `<td style="font-family:${SANS};font-size:13px;line-height:18px;color:${C.text2}">有効期限 <span style="color:${C.text}">${t.expiry}</span></td>`,
        `<td align="right" style="font-family:${SANS};font-size:12px;line-height:18px;color:${C.text3}">${t.label}</td>`,
        "</tr></table></td></tr>",
        "</table></td></tr>",
        // 見出しと本文
        `<tr><td class="px" style="padding:36px 40px 0">`,
        `<h1 class="h1" style="margin:0;font-family:${MINCHO};font-size:24px;line-height:1.45;font-weight:700;color:${C.text}">${t.heading}</h1>`,
        `<p style="margin:12px 0 0;font-family:${SANS};font-size:15px;line-height:1.8;color:${C.text2}">${t.body}</p>`,
        `<p style="margin:20px 0 0;font-family:${SANS};font-size:13px;line-height:1.7;color:${C.text3}">${NO_SHARE}<br>${t.ignore}</p>`,
        "</td></tr>",
        // 足元
        `<tr><td class="px" style="padding:40px 40px 0"><div style="border-top:1px solid ${C.line};height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>`,
        `<tr><td class="px" style="padding:18px 40px 40px;font-family:${SANS};font-size:12px;line-height:1.8;color:${C.text3}">`,
        `<span style="font-family:${MINCHO};color:${C.text2}">${TAGLINE}</span><br>`,
        `<a href="${SITE}/" style="color:${C.brass};text-decoration:none">journey-photo.com</a>`,
        "</td></tr>",
        "</table></td></tr></table>",
        "</body></html>",
    ].join("");
}

export function verificationEmail(kind: MailKind, code: string): { subject: string; html: string } {
    return { subject: COPY[kind].subject, html: verificationEmailHtml(kind, code) };
}

/** Cognito の CustomMessage トリガー。**投げない**（作れなければプールの今の文面のまま） */
export const customMessage = async (event: CustomMessageEvent): Promise<CustomMessageEvent> => {
    try {
        const kind = mailKindFor(event?.triggerSource ?? "");
        const code = event?.request?.codeParameter;
        if (!kind || typeof code !== "string" || !code) return event;
        const mail = verificationEmail(kind, code);
        event.response = { ...(event.response ?? {}), emailSubject: mail.subject, emailMessage: mail.html };
        // ログにメールやコードは出さない（種類だけ）
        console.log(JSON.stringify({ metric: "verification_mail", kind }));
    } catch (e) {
        console.error("customMessage:", (e as { name?: string } | null)?.name ?? "error");
    }
    return event;
};
