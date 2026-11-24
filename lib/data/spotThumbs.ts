// lib/data/spotThumbs.ts（サーバー専用・ビルド時に `public/` を見る）
//
// **撮影スポットの写真の小さい版（サムネ）の場所。**（2026-10-08）
//
// 作るのは `scripts/spot-thumbs.mjs`（短い辺 240px・品質 70・プログレッシブの JPEG）。
// 置き場は元の写真の隣の `thumb/`:
//
//     /images/spots/<slug>.jpg        → /images/spots/thumb/<slug>.jpg
//
// アプリ向けの JSON（`spotFeed.ts` の `image.thumbUrl`）は**ファイルが在るときだけ**出す。
// 在るかはビルドの時点の `public/` で見る（`next build` は `public/` をそのまま `out/` へ写す）。
// 本番のビルドは `next build` の前にサムネを作る（`scripts/prepare-static-build.js`）。

import fs from "node:fs";
import path from "node:path";
import type { Spot } from "./spots";
import { SPOT_IMAGES, spotCoverImage, type SpotImage } from "./spotImages";
import { spotRowThumbPath } from "../utils/spotThumbPath";

/** `scripts/spot-thumbs.mjs` の `THUMB_DIR_NAME` と同じ */
export const SPOT_THUMB_DIR = "thumb";

/**
 * サイトに置いた写真の場所（`local.src`）から、サムネの場所。
 * `/images/spots/<名前>.jpg` の形でなければ undefined（サムネを作っていない）
 */
export function spotThumbSrc(localSrc: string): string | undefined {
    const m = /^\/images\/spots\/([^/]+\.jpg)$/.exec(localSrc);
    return m ? `/images/spots/${SPOT_THUMB_DIR}/${m[1]}` : undefined;
}

/** サムネのファイルが `public/` に在るか */
export function spotThumbExists(src: string, publicDir: string = path.join(process.cwd(), "public")): boolean {
    return fs.existsSync(path.join(publicDir, src));
}

/**
 * **撮影スポットの一覧の行（丸い印）に写真を出してよいか**（2026-11-04）。
 *
 * 判定は**スポットの頁の代表写真と同じ1本**（`spotCoverImage`＝`shownSpotImage`：公開済み・パノラマの自由が無い国の
 * 建築を除く・`aiCheck.imageChecked` かつ座標のずれ無し（または人が確かめた）・CC BY 系は作者が名前・使えるライセンス）。
 * 新しい緩い条件は作らない。そのうえで、小さい版のファイルが `public/` に在り、名前が `slug` と同じときだけ真
 * （クライアントが `spotRowThumbPath(slug)` で場所を組むため）。
 * 作者・ライセンス・出典は行には出さない——行は同じスポットの頁（`/spots/<slug>`）へのリンクで、そこに出ている
 */
export function hasSpotRowThumb(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
    exists: (src: string) => boolean = spotThumbExists,
): boolean {
    const cover = spotCoverImage(spot, images);
    if (!cover?.src) return false;
    const thumb = spotThumbSrc(cover.src);
    return thumb !== undefined && thumb === spotRowThumbPath(spot.slug) && exists(thumb);
}
