// app/help/HelpParts.tsx（サーバーコンポーネント）
//
// **使い方（/help）の頁で共通の部品**（2026-11-12・札 journey.photo-ios#517）。
//
// 見た目はデザインの板「黒塗りの真鍮」と今の Web の頁（`SpotTopicPage`・教科書の頁）に合わせる:
// 黒地・h1 は明朝・眉ラベルは真鍮・副文は text-2・札は surface に白8% の縁・本文系の最小 12・押せるもの 44。
// 真鍮は黒地の上だけ（絵の写真の色面の上には置かない）。
//
// develop にも同じ形で入れるので、main にしか無い部品（教科書の `LearnParts`）には頼らない。

import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ROUTES } from "@/lib/routes";
import { siteConfig, generateBreadcrumbStructuredData, shareOgImage, shareImageUrl, INDEXABLE_ROBOTS } from "@/lib/utils/seo";

/** JSON-LD を `<script>` に埋める形（`</script>` で閉じられないように。`SpotTopicPage` と同じ） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export function JsonLd({ data }: { data: unknown }) {
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

export type Crumb = { name: string; href: string };

/** 使い方のパンくず（ホーム / 使い方 / …）。画面と構造化データで同じ段 */
export function helpCrumbs(current?: Crumb): Crumb[] {
    const base: Crumb[] = [{ name: "ホーム", href: ROUTES.HOME }, { name: "使い方", href: ROUTES.HELP }];
    return current ? [...base, current] : base;
}

export function breadcrumbData(crumbs: Crumb[]) {
    return generateBreadcrumbStructuredData(crumbs.map((c) => ({ name: c.name, url: `${siteConfig.url}${c.href === "/" ? "" : c.href}` })));
}

/** 画面のパンくず。最後の段（今いる頁）はリンクにせず `aria-current` */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
    return (
        <nav aria-label="パンくずリスト" className="mb-2 text-text-2" style={{ fontSize: "12px", lineHeight: "18px" }}>
            <ol className="m-0 p-0 list-none flex flex-wrap items-center">
                {crumbs.map((c, i) => {
                    const last = i === crumbs.length - 1;
                    return (
                        <li key={c.href} className="inline-flex items-center">
                            {i > 0 && <span className="mx-1.5 text-text-3" aria-hidden="true">/</span>}
                            {last ? (
                                <span aria-current="page" className="text-text-2">{c.name}</span>
                            ) : (
                                <Link href={c.href} prefetch={false} className="inline-flex items-center min-h-[44px] hover:text-white transition-colors">
                                    {c.name}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

/** 頁のメタデータ。題にサイト名は足さない（ルートの `title.template` が足す） */
export function helpMetadata(path: string, title: string, description: string): Metadata {
    const url = `${siteConfig.url}${path}`;
    return {
        title,
        description,
        alternates: { canonical: url },
        robots: INDEXABLE_ROBOTS,
        openGraph: {
            type: "website",
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
