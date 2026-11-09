/**
 * ログイン・登録の入口に付ける `via`（「何を押してここへ来たか」）と、その理由の文言。
 * 2026-11-09 owner 承認「未ログインの反応を登録の入口にする」。
 *
 * 🔴 **許可リスト方式。** `via` は URL から来る（誰でも好きな文字列を付けられる）ので、
 * 画面に出すのは**ここに載せた値に対応する文だけ**。載っていない値は無かったことにして汎用の1行を出す
 * （`loginReason`）。文は全部このファイルに固定で置き、URL の文字列を一度も画面に流さない。
 *
 * `routes.ts`（`loginWithNext`）・ログイン画面・登録画面・トースト（`useGuestPrompt`）が共有する。
 * 依存を持たない（循環させない）。
 */

/** `wish` は「行きたい」（登録の数え方 `signupFromVia` が見る値。変えない） */
export const LOGIN_VIAS = ["wish", "like", "save", "follow", "comment", "upload"] as const;
export type LoginVia = (typeof LOGIN_VIAS)[number];

/** URL の値が許可リストに在るときだけ返す（無ければ null） */
export function parseLoginVia(v: string | null | undefined): LoginVia | null {
    return v != null && (LOGIN_VIAS as readonly string[]).includes(v) ? (v as LoginVia) : null;
}

/**
 * ログイン画面に出す「理由と得られるもの」（1〜2行）。`via` が無い・許可外は汎用の1行。
 * **40字前後に詰める**（390px・14pt で2行、320px でも3行まで。ログインの欄と「アカウントを作る」を画面の下へ押し出さない）。
 * ログイン・登録の画面は日本語だけなので、画面用は日本語。英語はトースト側（`GUEST_PROMPT_COPY`）が持つ。
 */
const LOGIN_REASON_JA: Record<LoginVia, string> = {
    wish: "行きたい場所の保存にはログインが必要です。ログインすると、あとで見返せます。",
    like: "いいねにはログインが必要です。ログインすると、好きな写真をあとで見返せます。",
    save: "写真の保存にはログインが必要です。ログインすると、あとで見返せます。",
    follow: "フォローにはログインが必要です。ログインすると、フォロー中の人の写真が見られます。",
    comment: "コメントにはログインが必要です。ログインすると、撮った人に感想を届けられます。",
    upload: "投稿にはログインが必要です。ログインすると、あなたの写真を公開できます。",
};
export const LOGIN_REASON_GENERIC_JA = "ログインすると、いいね・コメント・投稿ができます。";

export function loginReason(via: string | null | undefined): string {
    const v = parseLoginVia(via);
    return v ? LOGIN_REASON_JA[v] : LOGIN_REASON_GENERIC_JA;
}

/** 登録画面の1行（便益）。`via` ごとには変えない */
export const SIGNUP_BENEFIT_JA = "登録すると、いいね・フォロー・コメント・保存・投稿ができるようになります。";
