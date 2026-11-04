import { ROUTES } from "../routes";

/**
 * そのセッションで**最初に着地した頁の種類**（GA4 のカスタム ディメンション `landing_type`）。
 *
 * 登録・保存・アプリの入口が、どの種類の頁から始まったかを見るための印（2026-11-04）。
 * 頁の種類の判定は `lib/routes.ts` の既存のルート（`ROUTES`）を使い回す
 * （`/location`・`/tag`・`/category` と `/photo/<id>` は `ROUTES` に定数が無いので、
 * 同じ接頭辞をここで一度だけ書く）。
 *
 * **保存するのは種類の語だけ**（URL・uid・スポットの slug は書かない）。
 * 置き場は `sessionStorage`（タブを閉じれば消える・Cookie ではない）。
 * 使えない環境（私的閲覧・遮断）では読み書きとも `other` に落ちる。
 */
export const LANDING_TYPES = ["learn", "composition", "spot", "photo", "location", "tag", "category", "home", "other"] as const;
export type LandingType = (typeof LANDING_TYPES)[number];

export const LANDING_STORAGE_KEY = "jp_landing_type";

const PHOTO_PREFIX = "/photo";
const LOCATION_PREFIX = "/location";
const TAG_PREFIX = "/tag";
const CATEGORY_PREFIX = "/category";

/** `prefix` そのもの、または `prefix/…` か（`/learning` を `/learn` と取り違えない） */
function under(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * 頁の種類を決める（純粋関数）。`search` は `/?photo=<id>`（静的ページがまだ無い新着写真・
 * `ROUTES.PHOTO` の落ち先）を photo と数えるためだけに見る。
 */
export function landingTypeOf(pathname: string | null | undefined, search?: string | null): LandingType {
    if (typeof pathname !== "string" || !pathname.startsWith("/")) return "other";
    // 末尾の `/` と `.html` は同じ頁（書き出しの設定が変わっても判定を変えない）
    const path = (pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/");
    if (path === ROUTES.HOME) {
        return typeof search === "string" && new URLSearchParams(search).has("photo") ? "photo" : "home";
    }
    if (under(path, ROUTES.LEARN)) return "learn";
    if (under(path, ROUTES.COMPOSITION)) return "composition";
    if (under(path, ROUTES.SPOTS)) return "spot";
    if (under(path, PHOTO_PREFIX)) return "photo";
    if (under(path, LOCATION_PREFIX)) return "location";
    if (under(path, TAG_PREFIX)) return "tag";
    if (under(path, CATEGORY_PREFIX)) return "category";
    return "other";
}

function isLandingType(v: unknown): v is LandingType {
    return typeof v === "string" && (LANDING_TYPES as readonly string[]).includes(v);
}

/** 今開いている頁の種類 */
function currentPageType(): LandingType {
    if (typeof window === "undefined") return "other";
    return landingTypeOf(window.location.pathname, window.location.search);
}

/**
 * 最初の着地を**一度だけ**書く。すでに書いてあれば何もしない（頁を移っても変わらない）。
 * 書けなければ黙って諦める（`getLandingType` が `other` を返す）
 */
export function recordLanding(): void {
    if (typeof window === "undefined") return;
    try {
        if (window.sessionStorage.getItem(LANDING_STORAGE_KEY) !== null) return;   // 壊れた値も上書きしない（`getLandingType` と同じ扱い）
        window.sessionStorage.setItem(LANDING_STORAGE_KEY, currentPageType());
    } catch {
        // ストレージが使えない環境。数えるために操作を止めない
    }
}

/**
 * このセッションの着地の種類。**書いた値を読むだけ**——まだ無ければ「いま開いている頁」を
 * 最初の着地として書いてから返す（記録の effect より先にイベントが出る順でも空にしない）。
 * 読めない・書けない・壊れた値は `other`
 */
export function getLandingType(): LandingType {
    if (typeof window === "undefined") return "other";
    try {
        const stored = window.sessionStorage.getItem(LANDING_STORAGE_KEY);
        if (isLandingType(stored)) return stored;
        if (stored !== null) return "other";   // 壊れた値は上書きせず other
        const now = currentPageType();
        window.sessionStorage.setItem(LANDING_STORAGE_KEY, now);
        return now;
    } catch {
        return "other";
    }
}
