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
 * 本文に自分のアプリの札を持つ頁か（2026-11-10 札 #515・owner 承認の第2版の推奨）。
 * ホーム（`/`・上段の札の下に `placement=home`）と撮影スポット詳細（`spot_detail`）。
 * この頁ではフッターの札（`banner`）を出さない（同じ札が1頁に2枚並ばない）。
 */
export function pageHasOwnAppCard(pathname: string | null | undefined): boolean {
    return pathname === "/" || isSpotDetailPath(pathname);
}
