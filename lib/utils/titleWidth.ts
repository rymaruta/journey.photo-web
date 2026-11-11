// lib/utils/titleWidth.ts
//
// 検索結果の題の長さ（全角換算）。撮影スポットの頁（`spotPageMeta.ts`）とテーマの頁（`spotTopics.ts`）が同じ数え方を使う。
// 2026-11-11: `spotPageMeta.ts` から移した（`spotTopics.ts` から読むと循環 import になるため）。

/** 全角換算の長さ（半角の英数・記号は 0.5） */
export function titleWidth(s: string): number {
    return [...s].reduce((n, ch) => n + (/[\u0020-\u007e]/.test(ch) ? 0.5 : 1), 0);
}
