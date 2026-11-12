// app/help/page.tsx（サーバーコンポーネント）
//
// **使い方の目次**（2026-11-12・札 journey.photo-ios#517）。台帳（`lib/data/helpPages.ts`）の全頁へ札で行ける。
// iPhone のアプリの入口は 設定 → ヘルプと規約 → 使い方 の1か所（ここを開く）。

import React from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import { siteConfig } from "@/lib/utils/seo";
import { HELP_PAGES, HELP_TITLE, HELP_DESCRIPTION } from "@/lib/data/helpPages";
import HelpFigure from "./HelpFigure";
import { Breadcrumbs, JsonLd, breadcrumbData, helpCrumbs, helpMetadata } from "./HelpParts";

export const metadata = helpMetadata(ROUTES.HELP, HELP_TITLE, HELP_DESCRIPTION);

export default function HelpIndexPage() {
    const crumbs = helpCrumbs();
    const collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: HELP_TITLE,
        description: HELP_DESCRIPTION,
        url: `${siteConfig.url}${ROUTES.HELP}`,
        inLanguage: "ja-JP",
        isPartOf: { "@type": "WebSite", name: siteConfig.name, url: siteConfig.url },
        mainEntity: {
            "@type": "ItemList",
            numberOfItems: HELP_PAGES.length,
            itemListElement: HELP_PAGES.map((p, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: `${siteConfig.url}${ROUTES.HELP_PAGE(p.slug)}`,
                name: p.title,
            })),
        },
    };

    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            <JsonLd data={collection} />
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-5xl" data-testid="help-index">
                <Breadcrumbs crumbs={crumbs} />
                <header className="mb-6">
                    <p className="m-0 mb-2 eyebrow text-accent">使い方</p>
                    <h1 className="m-0 font-serif font-bold text-white wrap-anywhere" style={{ fontSize: "clamp(28px, 5vw, 40px)", lineHeight: 1.3 }}>
                        {HELP_TITLE}
                    </h1>
                    <p className="m-0 mt-3 text-text-2 max-w-3xl" style={{ fontSize: "15px", lineHeight: "24px" }}>
                        機能ごとに、絵1枚と3行で説明します。知りたい機能を選んでください。
                    </p>
                </header>
                <ul className="m-0 p-0 list-none grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="help-cards">
                    {HELP_PAGES.map((p) => (
                        <li key={p.slug} className="min-w-0">
                            <Link
                                href={ROUTES.HELP_PAGE(p.slug)}
                                prefetch={false}
                                className="group flex flex-col h-full rounded-2xl overflow-hidden bg-surface ring-1 ring-line hover:ring-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                data-testid="help-card"
                            >
                                <span className="block bg-bg border-b border-line">
                                    <HelpFigure slug={p.slug} label={p.figureLabel} compact idPrefix="card" />
                                </span>
                                <span className="flex flex-col gap-0.5 p-3">
                                    <span className="text-white font-semibold wrap-anywhere" style={{ fontSize: "14px", lineHeight: "20px" }}>{p.cardTitle}</span>
                                    <span className="text-text-3 wrap-anywhere" style={{ fontSize: "12px", lineHeight: "18px" }}>{p.summary}</span>
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
                <p className="m-0 mt-8 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                    困ったときや、ここに無いことは
                    <Link href={ROUTES.FEEDBACK()} prefetch={false} className="inline-flex items-center min-h-[44px] mx-1 text-accent underline underline-offset-4 hover:text-accent-strong">意見を送る</Link>
                    から知らせてください。
                </p>
            </main>
        </>
    );
}
