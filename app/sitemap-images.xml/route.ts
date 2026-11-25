// 画像サイトマップ。
// Next の MetadataRoute.Sitemap とは別に、写真の頁・観光スポットの頁ごとに画像の URL（image:loc）を並べる。
//
// **載せるのは image:loc だけ**（2026-11-25）。Google の画像サイトマップの文書は、使うのは
// `image:image` と `image:loc` だけで、`image:caption`・`image:title`・`image:geo_location`・`image:license`
// は文書から外した、と書いている。以前は写真の題と説明を caption と title に入れていた（本番で 57 か所）。
// 題と説明は、写真の頁の本文・alt・JSON-LD の `ImageObject` が持つ。
// Wikimedia などほかのサイトの作例の画像は残す（2026-11-25 owner「画像ないからしんどい」。自分の画像だけに絞る案はやめた）

import { loadAllPhotos } from "@/lib/server/photos";
import { siteConfig, publicImageUrl } from "@/lib/utils/seo";
import type { Photo } from "@/lib/data/photos";
import { esc } from "@/lib/utils/xmlEscape";
import { SPOTS, type Spot } from "@/lib/data/spots";
import { publishableSpots } from "@/lib/utils/spotGuide";
import { spotCoverImage } from "@/lib/data/spotImages";
import { spotSamples, spotCoverSeoSource, spotSeoImage } from "@/lib/data/spotSamples";

export const dynamic = "force-static";

// 出すURLはサイトのドメインに揃える（`publicImageUrl`。同じ配信の別名で
// 2つに割れていた——実測 30件中 11件が CloudFront の既定ドメイン）
const toAbsolute = (src: string): string => publicImageUrl(src);

/**
 * **1つの `<url>` に載せる画像の上限。** Google の画像サイトマップの決まり
 * 「Each `<url>` tag can contain up to 1,000 `<image:image>` tags.」（2026-10-11 に文書で確認）
 */
export const MAX_IMAGES_PER_URL = 1000;

/** 撮影地ページ1つぶんの画像（ページの URL と、載せる画像の URL） */
export type SpotImageEntry = { loc: string; images: { src: string }[] };

/**
 * **撮影地ページ（`/spots/<slug>`）の画像**（2026-10-11・owner「検索で見つけてもらう」）。
 * 以前は投稿写真だけで、撮影地ページの代表写真・作例は1枚も載っていなかった。
 *
 * - 載せるページはサイトマップ（`lib/server/sitemap.ts`）と同じ `publishableSpots`（下書きは載せない）
 * - 載せる画像は**画面に出しているものだけ**: 代表写真（`spotCoverImage`・サイト内に置いた縮小版）と
 *   作例（`spotSamples`・代表写真と同じ1枚は除く）。数え方は `SpotGuidePage` と同じ
 * - ライセンス・題・説明は書かない（`image:loc` だけ。上の注記）。作者・ライセンスはページの JSON-LD の `ImageObject` が持つ
 * - 作例の画像は Commons・Flickr の URL のまま（画面が読んでいる URL と同じ）
 * - 2026-10-22: 代表写真は**横 1,200px 以上の版があればそれ**（Commons の 1280px・`spotCoverSeoSource`）。
 *   無ければサイトに置いた縮小版（960px）。代表写真が 1,200 に届かず届く作例があれば、その作例を先頭に
 *   （`spotSeoImage`・OGP と構造化データと同じ1枚）
 */
export function spotImageEntries(spots: readonly Spot[] = publishableSpots(SPOTS)): SpotImageEntry[] {
    const out: SpotImageEntry[] = [];
    for (const spot of spots) {
        const cover = spotCoverImage(spot);
        const coverSeo = cover?.src ? spotCoverSeoSource(spot) : undefined;
        const samples = spotSamples(spot, { exclude: [cover?.sourceUrl] });
        const seo = spotSeoImage(spot, samples);
        const lead = seo?.from === "sample" ? seo.sample : undefined;
        const ordered = lead ? [lead, ...samples.filter((s) => s !== lead)] : samples;
        const sampleImages = ordered.map((s) => ({ src: toAbsolute(s.src) }));
        const coverImages = coverSeo ? [{ src: coverSeo.url }] : [];
        const images = (lead
            ? [sampleImages[0], ...coverImages, ...sampleImages.slice(1)]
            : [...coverImages, ...sampleImages]
        ).slice(0, MAX_IMAGES_PER_URL);
        if (images.length > 0) out.push({ loc: `${siteConfig.url}/spots/${spot.slug}`, images });
    }
    return out;
}

/** 画像1枚ぶん（`image:loc` だけ） */
function imageEntry(src: string): string {
    return ["    <image:image>", `      <image:loc>${esc(src)}</image:loc>`, "    </image:image>"].join("\n");
}

/**
 * 画像サイトマップの XML を組み立てる。
 *
 * **`GET` から切り出してある**のは、中身をテストから直に見るため
 * （`feed.xml/route.ts` の `buildFeed` と同じ形。あちらは「制御文字1つで
 * フィード全体が壊れない」をここで固定している）。
 */
export function buildImageSitemap(photos: readonly Photo[], spots: readonly SpotImageEntry[] = []): string {
    const entries = photos.map((p) => {
        // **1つの `<url>` に画像を何枚でも入れられる**（規格上 1000 枚まで）。
        //
        // 1投稿に複数枚を入れられるようにしたので、表紙だけ載せると
        // **ページ数も画像の数も減る**。ページ数が減るのは承知の判断だが、
        // 画像の数は減らさない——`extraImages` も並べる。
        // **`i?.src` で読む。** 要素が null でも落とさない——ここが投げると
        // **画像サイトマップが丸ごと出なくなる**（1枚の壊れた値で全部を失う）
        const images = [p.src, ...(p.extraImages ?? []).map((i) => i?.src)]
            .filter((src): src is string => typeof src === "string" && !!src)
            .slice(0, MAX_IMAGES_PER_URL);
        return [
            "  <url>",
            `    <loc>${esc(`${siteConfig.url}/photo/${p.id}`)}</loc>`,
            ...images.map((src) => imageEntry(toAbsolute(src))),
            "  </url>",
        ].join("\n");
    });

    const spotEntries = spots.map((e) => [
        "  <url>",
        `    <loc>${esc(e.loc)}</loc>`,
        ...e.images.slice(0, MAX_IMAGES_PER_URL).map((img) => imageEntry(img.src)),
        "  </url>",
    ].join("\n"));

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        ...entries,
        ...spotEntries,
        "</urlset>",
    ].join("\n");
}

export async function GET() {
    const photos = (await loadAllPhotos()).filter((p) => p.published !== false && p.src);
    return new Response(buildImageSitemap(photos, spotImageEntries()), {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
}
