/**
 * 撮影スポット詳細（`/spots/<slug>`）のパスか。2026-11-09（入口の案C）。
 *
 * 詳細は説明文の下に自分のアプリの札（`placement=spot_detail`）を持つので、フッターの札（`banner`）は
 * この頁では出さない（同じ札が1頁に2枚並ばない）。
 *
 * `/spots/<名前>` で名前が下の予約語（`app/spots/` の下の道）でないものだけが詳細。
 * 予約語は `app/spots/` の中身と一致していること——見張りは `lib/utils/__tests__/spotDetailPath.test.ts`
 * （ディレクトリを読んで突き合わせる）。
 */
export const SPOTS_RESERVED_SEGMENTS = ["area", "city", "momiji", "sakura", "season", "snow", "theme"] as const;

export function isSpotDetailPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    const m = /^\/spots\/([^/]+)\/?$/.exec(pathname);
    return !!m && !(SPOTS_RESERVED_SEGMENTS as readonly string[]).includes(m[1]);
}

/**
 * 教科書の章（`/learn/<slug>`）のパスか。`/learn/<名前>` で名前が下の予約語（`app/learn/` の下の静的な道）でないもの。
 * 予約語は `app/learn/` の中身と一致していること——見張りは `lib/utils/__tests__/ownAppCardPages.test.ts`。
 */
export const LEARN_RESERVED_SEGMENTS = ["camera-basics", "camera-brands"] as const;

export function isLearnChapterPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    const m = /^\/learn\/([^/]+)\/?$/.exec(pathname);
    return !!m && !(LEARN_RESERVED_SEGMENTS as readonly string[]).includes(m[1]);
}

/**
 * 本文に自分のアプリの札（`AppInstallCard`）を持つ頁か（2026-11-10 札 #515・承認の決まり
 * 「本文に札のある頁ではフッターの札を出さない」）。この頁ではフッターの札（`banner`）を出さない（同じ札が1頁に2枚並ばない）。
 *  - ホーム（`/`・上段の札の下に `placement=home`。`/search` は同じ部品だが札を出さない）
 *  - 撮影スポット詳細（`/spots/<slug>`・`spot_detail`）
 *  - 教科書の章（`/learn/<slug>`・読み終えた所に `article`。2026-11-10 秘書室の判断で足した）
 * **本文に札を足した頁はここにも足す。** 漏れは `lib/utils/__tests__/ownAppCardPages.test.ts` が
 * ソースの読み込みのつながり（`AppInstallCard` を描く部品 → それを読む page.tsx）を数えて見張る。
 */
export function pageHasOwnAppCard(pathname: string | null | undefined): boolean {
    return pathname === "/" || isSpotDetailPath(pathname) || isLearnChapterPath(pathname);
}
