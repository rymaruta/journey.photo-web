import type { MetadataRoute } from "next";
import { esc } from "../utils/xmlEscape";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { siteConfig, publicImageUrl } from "../utils/seo";
import { collectEntries, collectionPath, collectionIndexPath, isIndexableCollection, isIndexableCollectionIndex, photosInCollection, type CollectionType } from "../utils/collections";
import { SPOTS } from "../data/spots";
import { spotAreas, visibleSpotsInArea } from "../data/spotLink";
import { publishableSpots, visibleSpots } from "../utils/spotGuide";
import { spotTopicSitemapEntries } from "../data/spotTopics";
import RAW_PHOTOS from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";
import { ROUTES } from "../routes";
import { LEARN_ARTICLES } from "../data/learn/articles";
import { PREFECTURES } from "../data/prefectures";

/**
 * 2026-11-09: サイトマップを**種類別に分けた**（`/sitemap.xml` は束ねる索引、各種類は `/sitemap-<種類>.xml`）。
 * Search Console は sitemap ごとに「検出された URL 数」を出すので、種類ごとの登録数を見て
 * 施策の効果（スポット詳細・県別・ハブ・今日の日の出…）を分けて比べられる。
 * **画像サイトマップ（`/sitemap-images.xml`）はこれとは別のまま**（URL を変えない）。
 *
 * 🔴 **`lastmod` に「ビルドした時刻」を入れない。** 中身が変わった日だけを申告する。
 * 毎回全ページが「今日更新」になると Google が lastmod を信用しなくなる。
 * 日付が取れない頁は `lastmod` を**書かない**（`now` で埋めない）。
 *
 * サイトマップは最新の photos.json（DynamoDB から同期）で再生成される。
 * 定期ビルドは**週1**（日曜 03:00 JST）。以前は毎日だったが 2026-09 に
 * 枠の都合で週1へ変えてある（CLAUDE.md）。写真の削除・非公開は API が
 * その場で再ビルドを頼むので、定期ビルド待ちにはならない。
 */

async function loadPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        return JSON.parse(data) as Photo[];
    }
    return RAW_PHOTOS as Photo[];
}

// 出すURLはサイトのドメインに揃える（`publicImageUrl`）
const toAbsolute = (src: string): string => publicImageUrl(src);

/** プライバシーポリシーの本文を最後に変えた日。**`app/privacy/page.tsx` の `LAST_UPDATED` と揃える**（`page.facts.test.ts` が見る） */
const PRIVACY_LAST_MODIFIED = "2026-10-18";

/** 利用規約の本文を最後に変えた日。**`app/terms/page.tsx` の `LAST_UPDATED` と揃える** */
const TERMS_LAST_MODIFIED = "2026-09-17";

/** 種類（ファイル名は `sitemap-<種類>.xml`）。並びは索引に出す順 */
export const SITEMAP_KINDS = ["spots", "areas", "hubs", "today", "learn", "collections", "photos", "pages"] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];

/** 種類の説明（索引・テスト・運用メモ用） */
export const SITEMAP_KIND_LABEL: Record<SitemapKind, string> = {
    spots: "スポット詳細（/spots/<slug>）",
    areas: "県別・エリア・市・国の一覧（/spots と /spots/area・/spots/city）",
    hubs: "テーマ・季節・紅葉/桜/雪景色のハブ（/spots/theme・season・momiji・sakura・snow）",
    today: "今日の日の出・日の入り（/today と47県）",
    learn: "写真とカメラの教科書・構図ガイド",
    collections: "写真の集約（タグ・撮影地・カテゴリ・カメラとその索引）",
    photos: "写真の個別ページ（/photo/<id>）",
    pages: "トップ・地図・規約・プロフィールなど",
};

/** `lastModified` は日付が取れたときだけ付ける（取れなければ書かない） */
const lm = (v: string | Date | null | undefined): { lastModified?: string | Date } =>
    v ? { lastModified: v } : {};

/** 切り口の頁（`spotTopicSitemapEntries`）を、県・市・国（areas）とテーマ・季節系（hubs）に分ける */
const isAreaLike = (url: string, baseUrl: string): boolean =>
    url.startsWith(`${baseUrl}/spots/area/`) || url.startsWith(`${baseUrl}/spots/city/`);

export async function sitemapGroups(): Promise<Record<SitemapKind, MetadataRoute.Sitemap>> {
    const baseUrl = siteConfig.url;
    const photos = (await loadPhotos()).filter((p) => p.published !== false);

    // 写真ページ: 画像サイトマップ付き（Google 画像検索への露出を強化）
    const photoUrls: MetadataRoute.Sitemap = photos.map((p) => ({
        url: `${baseUrl}/photo/${p.id}`,
        ...lm(p.updatedAt ?? p.createdAt),
        changeFrequency: "monthly",
        priority: 0.8,
        images: [toAbsolute(p.src)],
    }));

    // ユーザープロフィール: 投稿があるユーザーごと。lastmod は最新投稿日時
    const byUser = new Map<string, string>();
    for (const p of photos) {
        if (!p.userId) continue;
        const t = String(p.updatedAt ?? p.createdAt ?? p.date ?? "");
        const cur = byUser.get(p.userId);
        if (!cur || t > cur) byUser.set(p.userId, t);
    }
    const userUrls: MetadataRoute.Sitemap = Array.from(byUser.entries()).map(([userId, last]) => ({
        url: `${baseUrl}/users/${userId}`,
        ...lm(last),
        changeFrequency: "weekly",
        priority: 0.6,
    }));

    // 集約（ランディング）ページ: タグ / 撮影地 / カテゴリ。ロングテール検索の受け皿。
    // lastModified は「その集約内で最も新しい写真」の日時、代表画像も添える。
    const collectionUrls: MetadataRoute.Sitemap = (["tag", "location", "category", "camera"] as CollectionType[])
        .flatMap((type) =>
            // 写真が少ないページはサイトマップに載せない（noindex と揃える）
            collectEntries(photos, type).filter((e) => isIndexableCollection(e.count, type)).map((e) => {
                const matched = photosInCollection(photos, type, e.slug);
                const last = matched
                    .map((p) => String(p.updatedAt ?? p.createdAt ?? p.date ?? ""))
                    .reduce((a, b) => (b > a ? b : a), "");
                const rep = matched[0]?.src;
                return {
                    url: `${baseUrl}${collectionPath(type, e.slug)}`,
                    ...lm(last),
                    changeFrequency: "weekly" as const,
                    priority: 0.5,
                    ...(rep ? { images: [toAbsolute(rep)] } : {}),
                };
            })
        );

    // lastmod は「中身が変わった日」。ビルド時刻を入れると、写真を1枚も
    // 足していないビルドでもトップと /privacy が「今日更新」と申告する。
    // 毎回それをやると lastmod ごと信用されなくなり、本当に増えた写真の
    // 発見が遅れる（sitemap を出している目的そのものを損なう）。
    // トップは一番新しい写真の日付、/privacy は本文を変えた日を使う。
    const newestPhoto = photos
        .map((p) => p.updatedAt ?? p.createdAt ?? "")
        .filter(Boolean)
        .sort()
        .pop();

    /**
     * **索引ページ**（`/category` `/location` `/camera`）。
     * 「すべて見る」の行き先で、トップから集約ページへ渡す唯一の1本
     * （柱は `/search?…`＝`robots.txt` で `Disallow`＝行き止まり）。
     *
     * `/tag` は作っていない——トップの PC の右の柱（`DiscoverRail`）が**検索に載るタグ
     * だけ**を `/tag/*` へ直接張り、写真ページのタグも `/tag/*` を張る（2026-09-29 まで
     * はトップの写真カードのタグのチップが49本張っていた）。
     * lastmod は中身（エントリの一覧）が写真に連動するのでトップと同じ。
     */
    const indexUrls: MetadataRoute.Sitemap = (["location", "category", "camera"] as CollectionType[])
        .filter((type) => isIndexableCollectionIndex(collectEntries(photos, type).length))
        .map((type) => ({
            url: `${baseUrl}${collectionIndexPath(type)}`,
            ...lm(newestPhoto),
            changeFrequency: "weekly" as const,
            priority: 0.5,
        }));

    /**
     * **公式撮影地ガイド。**
     *
     * 🔴 **写真の枚数では絞らない。** 投稿0枚でも、公開の条件
     * （`publishBlockers`）を満たすガイドは索引に出す——それが今回の設計の肝
     * （owner:「写真件数を、公式撮影地ガイドの公開条件にしないでください」）。
     *
     * **未公開のスポットは載せない**（`publishableSpots` が下書きと情報不足を落とす）。
     * `lastModified` は**そのスポットの確認日**——中身は写真ではなく人が書いた
     * 文章なので、写真の更新に連動させると嘘になる。
     */
    const spots = publishableSpots(SPOTS);
    const latestUpdatedAt = (rows: readonly { updatedAt?: string }[]): string | undefined =>
        rows.map((r) => r.updatedAt).filter((t): t is string => !!t).sort().pop();
    const spotUrls: MetadataRoute.Sitemap = spots.map((sp) => ({
        url: `${baseUrl}/spots/${sp.slug}`,
        ...lm(sp.updatedAt ? new Date(sp.updatedAt) : undefined),
        changeFrequency: "monthly" as const,
        priority: 0.7,
    }));
    /** 索引は**中身が3件以上あるときだけ**（`/location` と同じ判断） */
    // lastmod は索引が並べる行（`visibleSpots`）の更新日の最大（ビルド時刻にしない）
    const spotIndexUrls: MetadataRoute.Sitemap = spots.length >= 3 ? [{
        url: `${baseUrl}/spots`,
        ...lm(latestUpdatedAt(visibleSpots(SPOTS))),
        changeFrequency: "weekly" as const,
        priority: 0.6,
    }] : [];
    /**
     * **都道府県ごとの一覧**（`/spots/area/<slug>`）。
     *
     * `/spots` を県の一覧に分けたときに生まれたページで、「北海道 撮影スポット」
     * のような語の着地点になる。**2件以上ある県だけ**——1件の県のページは
     * そのスポットの個別ページと中身が同じになる（`CLAUDE.md` の撮影地の線と
     * 同じ考え方）。ページ側の `robots` も同じ線で判断している。
     */
    // **人が確かめた件数で見る**（`count` は下書きを含む。下書きしか無い県を
    // 検索の着地点にしない。ページ側の `robots` も `publishedCount` で判断）
    const spotAreaUrls: MetadataRoute.Sitemap = spotAreas()
        .filter((a) => a.publishedCount >= 2)
        .map((a) => ({
            url: `${baseUrl}/spots/area/${a.slug}`,
            // その県の頁が並べる行（`visibleSpotsInArea`）の更新日の最大。ビルド時刻にしない（2026-11-09）
            ...lm(latestUpdatedAt(visibleSpotsInArea(a.slug))),
            changeFrequency: "weekly" as const,
            priority: 0.6,
        }));

    // 今日の日の出・日の入り（2026-11-07）。ハブと47県。HTML は日付で変わらない（今日の値は開いたブラウザが計算する）ので
    // lastModified は付けない（ビルドの時刻を「更新日」と申告しない）
    const todayUrls: MetadataRoute.Sitemap = [
        { url: `${baseUrl}${ROUTES.TODAY}`, changeFrequency: "monthly" as const, priority: 0.6 },
        ...PREFECTURES.map((p) => ({ url: `${baseUrl}${ROUTES.TODAY_PREF(p.slug)}`, changeFrequency: "monthly" as const, priority: 0.5 })),
    ];

    const topicUrls = spotTopicSitemapEntries(baseUrl); // 国・テーマ・季節の切り口の頁（2026-10-11・`lib/data/spotTopics.ts`）

    const fixedPages: MetadataRoute.Sitemap = [
        {
            url: baseUrl,
            ...lm(newestPhoto),
            changeFrequency: "daily",
            priority: 1.0,
        },
        {
            url: `${baseUrl}/privacy`,
            lastModified: PRIVACY_LAST_MODIFIED,
            changeFrequency: "yearly",
            priority: 0.2,
        },
        {
            // 利用規約。プライバシーポリシーと同じ扱い（本文を変えた日を出す）
            url: `${baseUrl}/terms`,
            lastModified: TERMS_LAST_MODIFIED,
            changeFrequency: "yearly",
            priority: 0.2,
        },
        {
            // 撮影地マップ。中身は写真に連動するので lastmod もトップと同じ
            url: `${baseUrl}/map`,
            ...lm(newestPhoto),
            changeFrequency: "weekly",
            priority: 0.5,
        },
    ];

    return {
        spots: spotUrls,
        areas: [...spotIndexUrls, ...spotAreaUrls, ...topicUrls.filter((e) => isAreaLike(e.url, baseUrl))],
        hubs: topicUrls.filter((e) => !isAreaLike(e.url, baseUrl)),
        today: todayUrls,
        learn: [
            // 写真とカメラの教科書（2026-11-04）。一覧と、この頁群の記事
            {
                url: `${baseUrl}${ROUTES.LEARN}`,
                lastModified: LEARN_ARTICLES.reduce((m, a) => (a.modified && a.modified > m ? a.modified : m), ""),
                changeFrequency: "monthly" as const,
                priority: 0.7,
            },
            ...LEARN_ARTICLES.filter((a) => a.modified).map((a) => ({
                url: `${baseUrl}${a.href}`,
                lastModified: a.modified,
                changeFrequency: "monthly" as const,
                priority: 0.8,
            })),
            // 構図ガイド（2026-11-04・検索に出せる公開頁にした。`app/composition/layout.tsx`）。
            // 中身は端末内で動く道具で更新日が無いので、lastModified は付けない
            {
                url: `${baseUrl}${ROUTES.COMPOSITION}`,
                changeFrequency: "monthly" as const,
                priority: 0.6,
            },
        ],
        collections: [...indexUrls, ...collectionUrls],
        photos: photoUrls,
        pages: [...fixedPages, ...userUrls],
    };
}

/** 全種類をつないだ一覧（件数・重複・lastmod の検査用。配信は種類別） */
export async function allSitemapEntries(): Promise<MetadataRoute.Sitemap> {
    const g = await sitemapGroups();
    return SITEMAP_KINDS.flatMap((k) => g[k]);
}

const URLSET_NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
const IMAGE_NS = 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';

const lastmodText = (v: string | Date | undefined): string =>
    v === undefined || v === "" ? "" : typeof v === "string" ? v : v.toISOString();

/** 1つの種類の `<urlset>`。画像を持つ行（写真・集約）だけ `<image:image>` を付ける */
export function renderUrlset(entries: MetadataRoute.Sitemap): string {
    const hasImages = entries.some((e) => e.images?.length);
    const rows = entries.map((e) => {
        const lastmod = lastmodText(e.lastModified);
        return [
            "  <url>",
            `    <loc>${esc(e.url)}</loc>`,
            lastmod ? `    <lastmod>${esc(lastmod)}</lastmod>` : "",
            e.changeFrequency ? `    <changefreq>${e.changeFrequency}</changefreq>` : "",
            e.priority !== undefined ? `    <priority>${e.priority}</priority>` : "",
            ...(e.images ?? []).map((img) => `    <image:image><image:loc>${esc(img)}</image:loc></image:image>`),
            "  </url>",
        ].filter(Boolean).join("\n");
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<urlset ${URLSET_NS}${hasImages ? ` ${IMAGE_NS}` : ""}>`,
        ...rows,
        "</urlset>",
    ].join("\n") + "\n";
}

/**
 * 索引（`/sitemap.xml`）。各種類の `<lastmod>` は**その種類の行の最大**（行が日付を持たない種類は書かない）。
 * ビルド時刻は入れない。
 */
export function renderSitemapIndex(groups: Record<SitemapKind, MetadataRoute.Sitemap>): string {
    const baseUrl = siteConfig.url;
    const rows = SITEMAP_KINDS.map((k) => {
        const last = groups[k].map((e) => lastmodText(e.lastModified)).filter(Boolean).sort().pop();
        return [
            "  <sitemap>",
            `    <loc>${esc(`${baseUrl}/sitemap-${k}.xml`)}</loc>`,
            last ? `    <lastmod>${esc(last)}</lastmod>` : "",
            "  </sitemap>",
        ].filter(Boolean).join("\n");
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<sitemapindex ${URLSET_NS}>`,
        ...rows,
        "</sitemapindex>",
    ].join("\n") + "\n";
}

export const xmlResponse = (body: string): Response =>
    new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
