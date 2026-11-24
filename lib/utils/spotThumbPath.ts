// lib/utils/spotThumbPath.ts（クライアントからも読める・fs を読まない）
//
// **撮影スポットの一覧の行（丸い印）に出す写真の小さい版の場所。**（2026-11-04）
//
// 小さい版は `/images/spots/thumb/<slug>.jpg`（`scripts/spot-thumbs.mjs` が作る・短い辺 240px）。
// 全 2,910 枚のファイル名はスポットの `slug` と同じなので、サーバーは「在るかどうか」の印（`thumb: true`）だけを
// 渡し、クライアントがこの関数で場所を組む——RSC ペイロードに 1 行ごとのパス（約 40 バイト × 数千行）を
// 載せない。印を付ける判断はサーバー側（`lib/data/spotThumbs.ts` の `hasSpotRowThumb`）で、
// 「ファイルの名前が slug と同じ」ことも確かめてから付ける。

/** `scripts/spot-thumbs.mjs` の置き場（`lib/data/spotThumbs.ts` の `SPOT_THUMB_DIR` と同じ） */
export const SPOT_ROW_THUMB_DIR = "/images/spots/thumb";

/** スポットの一覧の行に出す小さい版の場所 */
export function spotRowThumbPath(slug: string): string {
    return `${SPOT_ROW_THUMB_DIR}/${slug}.jpg`;
}
