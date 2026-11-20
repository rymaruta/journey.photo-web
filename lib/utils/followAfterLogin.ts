/**
 * **ログインのあとにフォローを1回だけ済ませる印**（札 journey.photo-ios#664、2026-11-20 判断）。
 *
 * owner「qr読み込んだあとにプロフィール遷移してフォローするボタン押すとログインしてくださいみたいな
 * ポップアップ出てくると思うけど、それのサイズが小さい気がして気付きにくいかも」。
 * 未ログインの人がフォローを押したら案内の板（`FollowLoginSheet`）を出し、「ログインしてフォロー」
 * 「新しく登録」を押した人だけ、ログインを終えて元の頁へ戻ったときに自動でフォローする。
 *
 * **印は2つそろって初めて効く**（外から来た URL だけでフォローが走らないように）:
 *   1. 戻り先の URL の `?followAfterLogin=<合言葉>`（ログインの頁の `next` に載せて運ぶ）
 *   2. このタブの `sessionStorage` に、板のボタンを押した瞬間に書く `{ 相手, 合言葉, 時刻 }`
 * `sessionStorage` は同じサイトの頁からしか書けない。外の頁が `?followAfterLogin=…` を付けた
 * リンクを踏ませても、2 が無い（または合言葉が合わない）ので何も起きない。
 * 合言葉は板を開くたびに作る乱数で、相手の ID とも突き合わせる。30 分で古いものとして捨てる。
 *
 * 使い終えたら（フォローした・もうフォロー中・自分だった）、2 を消して 1 を URL から外す。
 * 途中でやめた人（ログインの頁から戻るで帰ってきた）は URL に 1 が無いので、2 をその場で消す。
 */

export const FOLLOW_AFTER_LOGIN_PARAM = "followAfterLogin";
const STORAGE_KEY = "jp.followAfterLogin";
/** これより古い印は使わない（ログインをやめて、だいぶ後に戻ってきた回） */
export const FOLLOW_AFTER_LOGIN_TTL_MS = 30 * 60 * 1000;

type Mark = { t: string; n: string; at: number };

function store(): Storage | null {
    try {
        return typeof sessionStorage !== "undefined" ? sessionStorage : null;
    } catch {
        // 保存を断る設定（プライベートの一部など）。印が無いだけで、ほかは今までどおり動く
        return null;
    }
}

function readMark(): Mark | null {
    try {
        const raw = store()?.getItem(STORAGE_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw) as Partial<Mark>;
        if (typeof v?.t !== "string" || typeof v?.n !== "string" || typeof v?.at !== "number") return null;
        return { t: v.t, n: v.n, at: v.at };
    } catch {
        return null;
    }
}

/** 合言葉。推し量れない長さの乱数（`crypto` が無い古い環境だけ Math.random） */
export function newFollowNonce(): string {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
            const a = new Uint8Array(16);
            crypto.getRandomValues(a);
            return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
        }
    } catch { /* 下へ */ }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** 戻り先（今の頁）に合言葉を載せた形。`path` はサイト内のパス（`pathname + search + hash`） */
export function withFollowMark(path: string, nonce: string): string {
    const u = new URL(path, "https://same-origin.invalid");
    u.searchParams.set(FOLLOW_AFTER_LOGIN_PARAM, nonce);
    return u.pathname + u.search + u.hash;
}

/** 板のボタンを押した瞬間に書く（押していない人には書かない＝閉じた人は印を持たない） */
export function rememberFollowAfterLogin(targetUserId: string, nonce: string, now = Date.now()): void {
    try {
        store()?.setItem(STORAGE_KEY, JSON.stringify({ t: targetUserId, n: nonce, at: now } satisfies Mark));
    } catch { /* 書けなければ自動のフォローをしないだけ */ }
}

/** 印を消す（URL の合言葉も外す）。板を閉じたとき・使い終えたとき */
export function clearFollowAfterLogin(): void {
    try { store()?.removeItem(STORAGE_KEY); } catch { /* 無視 */ }
    if (typeof window === "undefined") return;
    try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has(FOLLOW_AFTER_LOGIN_PARAM)) return;
        url.searchParams.delete(FOLLOW_AFTER_LOGIN_PARAM);
        // 履歴を増やさずに外す（戻るでもう一度フォローの頁に来ない）
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* 無視 */ }
}

/**
 * この頁でこの相手を自動でフォローしてよいか。**読むだけ**（消すのは `clearFollowAfterLogin`）。
 *
 * - URL に合言葉が無い → false。同じ相手の印が残っていれば、途中でやめた回なので消す
 * - URL の合言葉と、このタブに書いた合言葉・相手が一致し、30 分以内 → true
 * - それ以外（外から付けた合言葉・別の相手・古い） → false。URL の合言葉は外す
 */
export function hasFollowAfterLogin(targetUserId: string, now = Date.now()): boolean {
    if (typeof window === "undefined" || !targetUserId) return false;
    let param: string | null = null;
    try { param = new URL(window.location.href).searchParams.get(FOLLOW_AFTER_LOGIN_PARAM); } catch { return false; }
    const mark = readMark();
    if (!param) {
        if (mark && mark.t === targetUserId) clearFollowAfterLogin();
        return false;
    }
    const ok = !!mark && mark.n === param && mark.t === targetUserId && now - mark.at >= 0 && now - mark.at <= FOLLOW_AFTER_LOGIN_TTL_MS;
    if (!ok) {
        // 外から来た合言葉は URL から外すだけ（このタブの別の相手の印は残す）
        if (!mark || mark.t !== targetUserId) {
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete(FOLLOW_AFTER_LOGIN_PARAM);
                window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
            } catch { /* 無視 */ }
        } else {
            clearFollowAfterLogin();
        }
    }
    return ok;
}
