/**
 * **登録（ログイン）のあとに「行きたい」を1回だけ済ませる印**（札 journey.photo-ios#432、2026-11-24）。
 *
 * 検索から観光スポットの頁に来た人が、未ログインで「行きたい」を押す → 押したスポットを上に載せた
 * 登録の頁 → 確認コードのあとそのままログイン → 元の頁に戻ったら、もう「行きたい」に入っている。
 * 仕組みはフォローの `followAfterLogin.ts`（2026-11-20）と同じで、**印は2つそろって初めて効く**:
 *   1. 戻り先の URL の `?wishAfterLogin=<合言葉>`（登録・ログインの頁の `next` に載せて運ぶ）
 *   2. このタブの `sessionStorage` に、「行きたい」を押した瞬間に書く `{ 鍵, 合言葉, 時刻, 名前, 絵 }`
 * 外の頁が `?wishAfterLogin=…` を付けたリンクを踏ませても、2 が無い（合言葉が合わない）ので何も起きない。
 * 登録の頁に載せるスポットの名前と絵も 2 から読む（URL の文字をそのまま画面に出さない）。
 * 30 分で古いものとして捨てる。
 */

export const WISH_AFTER_LOGIN_PARAM = "wishAfterLogin";
const STORAGE_KEY = "jp.wishAfterLogin";
export const WISH_AFTER_LOGIN_TTL_MS = 30 * 60 * 1000;

/** 登録の頁に載せるスポット（押した頁が知っている分だけ） */
export type WishSpot = { name: string; image?: string; place?: string };
type Mark = { k: string; n: string; at: number; s: WishSpot };

function store(): Storage | null {
    try {
        return typeof sessionStorage !== "undefined" ? sessionStorage : null;
    } catch {
        return null;
    }
}

function readMark(): Mark | null {
    try {
        const raw = store()?.getItem(STORAGE_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<Mark>;
        if (typeof v?.k !== "string" || typeof v?.n !== "string" || typeof v?.at !== "number") return null;
        const s = v.s && typeof v.s.name === "string" ? v.s : { name: "" };
        // 絵はサイトの中の道か https だけ（`javascript:` などを img に渡さない）
        const img = typeof s.image === "string" && (/^\/(?!\/)/.test(s.image) || /^https:\/\//.test(s.image)) ? s.image : undefined;
        return { k: v.k, n: v.n, at: v.at, s: { name: s.name, ...(img ? { image: img } : {}), ...(typeof s.place === "string" ? { place: s.place } : {}) } };
    } catch {
        return null;
    }
}

/** 合言葉（`followAfterLogin` と同じ作り） */
export function newWishNonce(): string {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
            const a = new Uint8Array(16);
            crypto.getRandomValues(a);
            return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
        }
    } catch { /* 下へ */ }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** 戻り先（今の頁）に合言葉を載せた形 */
export function withWishMark(path: string, nonce: string): string {
    const u = new URL(path, "https://same-origin.invalid");
    u.searchParams.set(WISH_AFTER_LOGIN_PARAM, nonce);
    return u.pathname + u.search + u.hash;
}

/** 「行きたい」を押した瞬間に書く */
export function rememberWishAfterLogin(key: string, nonce: string, spot: WishSpot, now = Date.now()): void {
    try {
        store()?.setItem(STORAGE_KEY, JSON.stringify({ k: key, n: nonce, at: now, s: spot } satisfies Mark));
    } catch { /* 書けなければ自動で保存しないだけ */ }
}

function stripParam(): void {
    if (typeof window === "undefined") return;
    try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has(WISH_AFTER_LOGIN_PARAM)) return;
        url.searchParams.delete(WISH_AFTER_LOGIN_PARAM);
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* 無視 */ }
}

/** 印を消す（URL の合言葉も外す）。使い終えたとき */
export function clearWishAfterLogin(): void {
    try { store()?.removeItem(STORAGE_KEY); } catch { /* 無視 */ }
    stripParam();
}

const fresh = (m: Mark, now: number) => now - m.at >= 0 && now - m.at <= WISH_AFTER_LOGIN_TTL_MS;

/**
 * 登録の頁が載せるスポット。`next`（登録の頁の戻り先）に載った合言葉と、このタブの印が合うときだけ返す
 */
export function wishSpotForNext(nextPath: string | null, now = Date.now()): WishSpot | null {
    if (!nextPath) return null;
    let param: string | null = null;
    try { param = new URL(nextPath, "https://same-origin.invalid").searchParams.get(WISH_AFTER_LOGIN_PARAM); } catch { return null; }
    const mark = readMark();
    if (!param || !mark || mark.n !== param || !fresh(mark, now) || !mark.s.name) return null;
    return mark.s;
}

/**
 * この頁でこの鍵を自動で「行きたい」にしてよいか。**読むだけ**（消すのは `clearWishAfterLogin`）。
 * URL の合言葉と、このタブに書いた合言葉・鍵が一致し、30 分以内なら true
 */
export function hasWishAfterLogin(key: string, now = Date.now()): boolean {
    if (typeof window === "undefined" || !key) return false;
    let param: string | null = null;
    try { param = new URL(window.location.href).searchParams.get(WISH_AFTER_LOGIN_PARAM); } catch { return false; }
    const mark = readMark();
    if (!param) {
        // 途中でやめて戻ってきた回。同じ鍵の印は消す
        if (mark && mark.k === key) clearWishAfterLogin();
        return false;
    }
    const ok = !!mark && mark.n === param && mark.k === key && fresh(mark, now);
    if (!ok) {
        if (!mark || mark.k !== key) stripParam();
        else clearWishAfterLogin();
    }
    return ok;
}
