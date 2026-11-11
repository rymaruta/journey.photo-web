// lib/learn/seo.ts
//
// **教科書（/learn）の頁のメタデータと記事の構造化データ**（2026-11-04）。
//
// - 題はサイト名を足さない（ルートの `title.template` が足す。`pageTitles.test.ts` の決まり）
// - robots は `INDEXABLE_ROBOTS`（`max-image-preview: large` を消さない。`pageRobots` の注記）
// - 共有カードの画像は固定の代表画像（`shareOgImage`）。利用者の写真を勝手に代表にしない（#432）
// - FAQPage の構造化データは付けない。Google は 2023-08 から FAQ のリッチリザルトを
//   政府・医療の権威あるサイトに限っていて、このサイトでは出ない

import type { Metadata } from "next";
import { siteConfig, shareOgImage, shareImageUrl, INDEXABLE_ROBOTS, ORGANIZATION_ID, SITE_SHORT_NAME } from "@/lib/utils/seo";

export function learnMetadata(path: string, title: string, description: string, type: "website" | "article"): Metadata {
    const url = `${siteConfig.url}${path}`;
    return {
        title,
        description,
        alternates: { canonical: url },
        robots: INDEXABLE_ROBOTS,
        openGraph: {
            type,
            locale: siteConfig.locale.ja,
            url,
            siteName: siteConfig.name,
            title,
            description,
            images: [shareOgImage()],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [shareImageUrl()],
        },
    };
}

/** 記事（Article）の構造化データ。画像は記事に並べた実例の写真（無ければ代表画像） */
export function articleStructuredData(input: {
    path: string;
    headline: string;
    description: string;
    published: string;
    modified: string;
    images: string[];
}) {
    const url = `${siteConfig.url}${input.path}`;
    // 書き手・発行元は全ページに出している Organization（`app/layout.tsx`）を @id で指す
    // （#525 の続き・確かめ役 2026-11-11。ここで別の Organization を作ると、検索エンジンには
    // ロゴ・別名・sameAs の無い2つ目の組織に見える）
    // 型・名前・URL も添える（@id だけだと、記事の頁だけを読む道具には名前の無い書き手に見える）
    const org = { "@type": "Organization", "@id": ORGANIZATION_ID, name: SITE_SHORT_NAME, url: siteConfig.url };
    return {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: input.headline,
        description: input.description,
        inLanguage: "ja-JP",
        mainEntityOfPage: url,
        url,
        image: input.images.length > 0 ? input.images : [shareImageUrl()],
        author: org,
        publisher: org,
        datePublished: input.published,
        dateModified: input.modified,
    };
}
