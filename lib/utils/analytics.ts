/**
 * 登録までのどこで人が離れているかを数えるための、GA4 のイベント（札 journey.photo-ios#432 の 5・2026-10-31）。
 *
 * 最初は `wish_tap`（「行きたい」を押した）と `sign_up`（登録の確認コードが通った）の2つ。
 * 2026-11-04 に登録の漏斗・アプリの入口・投稿・推奨イベントを足した（一覧と値の範囲は
 * `EVENT_SPEC`、意味と漏斗の定義は `docs/signup-funnel.md`）。
 *
 * **送らないもの: uid・メール・氏名・検索語そのもの。** 撮影スポットの slug・記事の slug・写真の id は
 * `select_content` の `item_id` だけで送る（2026-11-06・値は `ITEM_ID_PATTERN` の形だけ）。引数の型を表の値だけに絞り、
 * 自由な文字列を渡せないようにしてある（後から足す人が slug を混ぜないように）。
 *
 * ## GA4 の読み込み前に押されたイベント
 *
 * GA4 は `lazyOnload`（`app/components/Analytics.tsx`）なので、ページの `load` より前に
 * 押されると `window.gtag` がまだ無い。そのときは `window.__jpq` に積み、
 * **初期化の行（`gtag('config', …)` の直後）で吐き出す**。
 *
 * 2026-10-31 判断: `dataLayer` に直接積まないのは、`config` より前に積まれた `event` を
 * gtag.js がどう扱うか（送り先が決まる前のイベント）をこの環境で確かめられないため。
 * 自前の列なら「config のあとに送る」順番がコードで決まる。
 * 列は 20 件で頭打ち（GA4 の無い環境＝開発・staging で積み続けないように）。
 */

import { getLandingType } from "./landingType";

/**
 * イベントごとに**送ってよい欄と値の範囲**（2026-11-04 判断）。
 *
 * 型（`EventMap`）も実行時の検査（`track`）も、この表から作る。値の範囲を一か所に置くので、
 * 型を `as` で破って自由な文字列を渡しても、**表に無い欄は落ち、範囲外の値ならそのイベントごと送らない**。
 *  - 配列 … その中の値だけ
 *  - `COUNT` … 0〜`COUNT_MAX` の整数（枚数・文字数・件数）
 *
 * **送らないもの: uid・メール・氏名・ユーザー名・検索語そのもの・エラーの文言・入力した値。
 * 撮影スポットの slug・記事の slug・写真の id は `select_content` の `item_id` だけ（2026-11-06）。** 足すときも、自由な文字列の欄は作らない。
 * `landing_type` は表には書かず、`track` が全イベントに足す（`lib/utils/landingType.ts`）。
 */
const COUNT = "count" as const;
export const COUNT_MAX = 10000;

/**
 * 公開されている頁の識別子（記事の slug・撮影スポットの slug・写真の id）。2026-11-06 owner「どちらでも」→
 * 記事・スポットの `item_id` は送る（どの記事が読まれたかを見るため）。
 * **英数字・`-`・`_` だけ・80 字以内**に絞り、自由な文章は通さない。範囲外ならそのイベントごと送らない
 */
const ITEM_ID = "item_id" as const;
export const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export const SIGNUP_FROM = ["wish", "other"] as const;
export const SIGNUP_ERROR_REASONS = [
    "password_mismatch", "password_short", "password_rule", "invalid_input",
    "already_registered", "code_mismatch", "code_expired", "alias_exists",
    "rate_limit", "network", "other",
] as const;
export const UPLOAD_ERROR_REASONS = ["unsupported_file", "network", "server", "other"] as const;
export const SHARE_METHODS = ["native", "copy", "x", "line"] as const;
export const SHARE_CONTENT_TYPES = ["photo", "spot", "quiz", "trip"] as const;
export const SELECT_CONTENT_TYPES = ["spot", "photo", "article"] as const;
// `spot_detail` … 撮影スポット詳細の説明文の下の札（2026-11-09・入口の案C）
export const APP_STORE_PLACEMENTS = ["footer", "banner", "article", "home", "spot_detail"] as const;
/**
 * `nav_click`（どの入口が使われたか・2026-11-09 owner「任せる」・デザイナーの提案書の節5）。
 * `area` … 入口の置き場所。`dest` … 行き先の種類（URL・slug・検索語は送らない）。
 * header=ヘッダーの文字リンク / menu=☰の中 / tab=下のタブ / footer=フッターの撮影スポットの組 /
 * spot_next=撮影スポット詳細の説明文の下 / home_entry=ホームの入口の帯と「県から探す」の節
 */
export const NAV_AREAS = ["header", "menu", "tab", "footer", "spot_next", "home_entry"] as const;
export const NAV_DESTS = [
    "home", "search", "map", "me", "login", "signup", "post", "spots", "area", "topic", "nearby", "learn", "people", "saved",
    // `map_pref` … ホームの日本地図で県を選んで県の頁へ（2026-11-09・文字の一覧の `area` と分けて、地図が使われたかを見る）
    "map_pref",
    // 地図での操作（2026-11-09）: `map_pref_select`=県を押した（選び直しも）/ `map_sheet_open`=一覧が閉じた状態から開いた / `map_spot`=一覧のスポットを押した。
    // 「すべて見る」は `map_pref`（県の頁へ）のまま。県の名前・スポットの slug は送らない
    "map_pref_select", "map_sheet_open", "map_spot",
] as const;

export const EVENT_SPEC = {
    // 既存（名前と欄は変えない）
    wish_tap: { signed_in: [0, 1], kind: ["spot", "location"] },
    sign_up: { method: ["email"], from: SIGNUP_FROM },
    // 登録の漏斗
    view_signup: { from: SIGNUP_FROM },
    signup_start: { from: SIGNUP_FROM },
    signup_error: { step: ["form", "confirm"], reason: SIGNUP_ERROR_REASONS },
    login: { method: ["email"] },
    // アプリへの入口
    app_store_click: { placement: APP_STORE_PLACEMENTS },
    // 投稿
    upload_start: { photo_count: COUNT },
    upload_complete: { photo_count: COUNT },
    upload_error: { reason: UPLOAD_ERROR_REASONS },
    // 入口の計測（どの入口が次の1ページに使われたか）
    nav_click: { area: NAV_AREAS, dest: NAV_DESTS },
    // 推奨イベント（欄は GA4 の推奨名に合わせ、値は絞る。`item_id` は送る・`search_term`（検索語）は送らない）
    select_content: { content_type: SELECT_CONTENT_TYPES, item_id: ITEM_ID },
    search: { search_term_length: COUNT, result_count: COUNT },
    share: { method: SHARE_METHODS, content_type: SHARE_CONTENT_TYPES },
    like_photo: {},
    follow_user: {},
} as const;

type Spec = typeof EVENT_SPEC;
type ParamOf<T> = T extends typeof COUNT ? number : T extends typeof ITEM_ID ? string : T extends readonly (infer U)[] ? U : never;
type EventMap = { [K in keyof Spec]: { [P in keyof Spec[K]]: ParamOf<Spec[K][P]> } };
export type EventName = keyof EventMap;

export type SignupFrom = (typeof SIGNUP_FROM)[number];
export type SignupErrorReason = (typeof SIGNUP_ERROR_REASONS)[number];
export type UploadErrorReason = (typeof UPLOAD_ERROR_REASONS)[number];
export type ShareMethod = (typeof SHARE_METHODS)[number];
export type ShareContentType = (typeof SHARE_CONTENT_TYPES)[number];
export type SelectContentType = (typeof SELECT_CONTENT_TYPES)[number];
export type NavArea = (typeof NAV_AREAS)[number];
export type NavDest = (typeof NAV_DESTS)[number];
export type AppStorePlacement = (typeof APP_STORE_PLACEMENTS)[number];
export type WishTapParams = EventMap["wish_tap"];
export type SignUpParams = EventMap["sign_up"];

/** 読み込み前の列の名前（`Analytics.tsx` の初期化の行も同じ名前を読む） */
export const PENDING_QUEUE = "__jpq";
export const PENDING_MAX = 20;

type Win = Window & {
    gtag?: (...args: unknown[]) => void;
    [PENDING_QUEUE]?: Array<[string, Record<string, unknown>]> | null;
};

/**
 * 表（`EVENT_SPEC`）どおりの欄だけを取り出す。範囲外の値が1つでもあれば null（そのイベントは送らない）。
 * 数は整数に丸め、`COUNT_MAX` で頭打ち
 */
export function sanitizeParams(name: string, params: unknown): Record<string, string | number> | null {
    const spec = (EVENT_SPEC as Record<string, Record<string, unknown> | undefined>)[name];
    if (!spec || typeof params !== "object" || params === null) return null;
    const src = params as Record<string, unknown>;
    const out: Record<string, string | number> = {};
    for (const key of Object.keys(spec)) {
        const rule = spec[key];
        const v = src[key];
        if (rule === COUNT) {
            if (typeof v !== "number" || !Number.isFinite(v)) return null;
            out[key] = Math.min(COUNT_MAX, Math.max(0, Math.trunc(v)));
        } else if (rule === ITEM_ID) {
            if (typeof v !== "string" || !ITEM_ID_PATTERN.test(v)) return null;
            out[key] = v;
        } else if (Array.isArray(rule) && (rule as readonly unknown[]).includes(v)) {
            out[key] = v as string | number;
        } else {
            return null;
        }
    }
    return out;
}

export function track<K extends EventName>(name: K, params: EventMap[K]): void {
    if (typeof window === "undefined") return;
    try {
        const clean = sanitizeParams(name, params);
        if (!clean) return;
        // 最初に着地した頁の種類を全イベントに足す（登録・保存・アプリの入口が、どの頁から始まったかを見る）
        const full = { ...clean, landing_type: getLandingType() };
        const w = window as Win;
        if (typeof w.gtag === "function") {
            w.gtag("event", name, full);
            return;
        }
        const q = (w[PENDING_QUEUE] ??= []);
        if (q.length < PENDING_MAX) q.push([name, full]);
    } catch {
        // 数えるのに失敗しても、押した操作は止めない
    }
}

/**
 * GA4 の初期化の行。`config` のあとに、読み込み前に積んだイベントを送る。
 * `Analytics.tsx` が `<Script>` の中身にそのまま入れる
 */
export function gaInitSnippet(gaId: string): string {
    return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');` +
        `(window.${PENDING_QUEUE}||[]).forEach(function(e){gtag('event',e[0],e[1]);});window.${PENDING_QUEUE}=null;`;
}

/**
 * Cognito の例外の名前を、決まった数種の理由に分ける。**文言や入力値は渡さない・送らない**。
 * 同じ `AliasExistsException` でも、登録の入力（form）では「もう登録済み」、
 * 確認コード（confirm）では「そのメールは別のアカウントが使っている」
 */
export function signupErrorReason(step: "form" | "confirm", code: string | undefined): SignupErrorReason {
    switch (code) {
        case "InvalidPasswordException": return "password_rule";
        case "InvalidParameterException": return "invalid_input";
        case "UsernameExistsException": return "already_registered";
        case "AliasExistsException": return step === "form" ? "already_registered" : "alias_exists";
        case "CodeMismatchException": return "code_mismatch";
        case "ExpiredCodeException": return "code_expired";
        case "LimitExceededException":
        case "TooManyRequestsException":
        case "TooManyFailedAttemptsException": return "rate_limit";
        case "NetworkError": return "network";
        default: return "other";
    }
}

/**
 * 投稿の失敗を、決まった数種の理由に分ける。**文言は見るだけで、送らない**。
 *  network … 通信できない（fetch の失敗）  server … サーバー／保存先が断った（日本語の理由・`S3 403` など）  other … 上のどれでもない
 * （写真の形式が読めない失敗は呼び出し側が `unsupported_file` を直に渡す）
 */
export function uploadErrorReason(err: unknown): UploadErrorReason {
    const msg = err instanceof Error ? err.message : "";
    if (err instanceof TypeError || /failed to fetch|load failed|network/i.test(msg)) return "network";
    if (/^S3 \d{3}/.test(msg) || /[ぁ-んァ-ヶ一-龠]/.test(msg)) return "server";
    return "other";
}

/**
 * 登録の画面に「行きたい」から来たかどうか。
 *
 * `next`（戻り先）だけでは決めない: 撮影スポットの頁の戻り先は、行きたい以外
 * （コメント欄のログイン `CommentSection` など）からも付く。**「行きたい」のリンクだけが `via=wish` を付け**、
 * ログイン画面が新規登録へのリンクに運ぶ。それ以外は `other`
 */
export const WISH_VIA = "wish";
export function signupFromVia(via: string | null | undefined): SignupFrom {
    return via === WISH_VIA ? "wish" : "other";
}
