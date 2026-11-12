/**
 * 登録までのどこで人が離れているかを数えるための、GA4 のイベント（札 journey.photo-ios#432 の 5・2026-10-31）。
 *
 * 数えるのは2つだけ:
 *  - `wish_tap {signed_in: 0|1, kind: "spot"|"location"}` … 「行きたい」を押した
 *  - `sign_up  {method: "email", from: "wish"|"other"}`    … 登録の確認コードが通った
 *
 * **送らないもの: uid・メール・撮影スポットの slug。** 引数の型を上の値だけに絞り、
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

export type WishTapParams = { signed_in: 0 | 1; kind: "spot" | "location" };
export type SignUpParams = { method: "email"; from: SignupFrom };
/** `swipe` は撮影スポットを払う画面から（2026-11-11・`via=swipe`） */
export type SignupFrom = "wish" | "swipe" | "other";

type EventMap = { wish_tap: WishTapParams; sign_up: SignUpParams };

/** 読み込み前の列の名前（`Analytics.tsx` の初期化の行も同じ名前を読む） */
export const PENDING_QUEUE = "__jpq";
export const PENDING_MAX = 20;

type Win = Window & {
    gtag?: (...args: unknown[]) => void;
    [PENDING_QUEUE]?: Array<[string, Record<string, unknown>]> | null;
};

export function track<K extends keyof EventMap>(name: K, params: EventMap[K]): void {
    if (typeof window === "undefined") return;
    const w = window as Win;
    try {
        if (typeof w.gtag === "function") {
            w.gtag("event", name, params);
            return;
        }
        const q = (w[PENDING_QUEUE] ??= []);
        if (q.length < PENDING_MAX) q.push([name, { ...params }]);
    } catch {
        // 数えるのに失敗しても、押した操作は止めない
    }
}

/**
 * GA4 の初期化の行。`config` のあとに、読み込み前に積んだイベントを送る。
 * `Analytics.tsx` が `<Script>` の中身にそのまま入れる
 */
/**
 * **合図を URL に持つ私的な頁**（共同アルバムの招待 `/j?t=`・プロフィールの QR `/qr?t=`）。GA4 に送る頁の URL
 * （`page_location`）から `t` を外す（2026-11-12 確かめ役の指摘・札 journey.photo-ios#545）。合図は推測できないことだけが
 * 守りなので、解析の置き場（Google）に残さない。頁の側でも開いたらすぐ URL から外す（`usePrivateLinkToken`）が、
 * 外す前に読まれた回のためにここでも外す
 */
export const PRIVATE_TOKEN_PATHS = ["/j", "/qr"] as const;

export function gaInitSnippet(gaId: string): string {
    const paths = JSON.stringify(PRIVATE_TOKEN_PATHS).replace(/"/g, "'");
    return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());` +
        `(function(){var p=location.pathname.replace(/\\/+$/,'');if(${paths}.indexOf(p)>=0){var u=new URL(location.href);` +
        `u.searchParams.delete('t');gtag('config','${gaId}',{page_location:u.toString()});}else{gtag('config','${gaId}');}})();` +
        `(window.${PENDING_QUEUE}||[]).forEach(function(e){gtag('event',e[0],e[1]);});window.${PENDING_QUEUE}=null;`;
}

/**
 * 登録の画面に「行きたい」から来たかどうか。
 *
 * `next`（戻り先）だけでは決めない: 撮影スポットの頁の戻り先は、行きたい以外
 * （コメント欄のログイン `CommentSection` など）からも付く。**「行きたい」のリンクだけが `via=wish` を付け**、
 * ログイン画面が新規登録へのリンクに運ぶ。それ以外は `other`
 */
export const WISH_VIA = "wish";
/** 撮影スポットを払う画面（`/swipe`）の挟む札・足元から来た（2026-11-11） */
export const SWIPE_VIA = "swipe";
export function signupFromVia(via: string | null | undefined): SignupFrom {
    if (via === WISH_VIA) return "wish";
    if (via === SWIPE_VIA) return "swipe";
    return "other";
}
