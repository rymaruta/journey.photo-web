// app/learn/page.tsx（サーバーコンポーネント）
//
// **写真とカメラの教科書の一覧**（2026-11-04）。記事は `lib/data/learn/articles.ts` の台帳から並べる。
// 3本目は既存の構図ガイド（`/composition`）——同じものを二度作らない。
// カードの写真はビルド時に選んだこのサイトの本物の写真（`coverPhotos`。無ければ写真の枠ごと出さない）。

import React from "react";
import TrackedLink from "@/app/components/TrackedLink";
import { loadAllPhotos } from "@/lib/server/photos";
import { ROUTES } from "@/lib/routes";
import { siteConfig, publicImageUrl } from "@/lib/utils/seo";
import { LEARN_ARTICLES, LEARN_TITLE } from "@/lib/data/learn/articles";
import { coverPhotos } from "@/lib/learn/covers";
import { learnMetadata } from "@/lib/learn/seo";
import Thumb from "@/app/components/Thumb";
import { photoAltText } from "@/lib/utils/photoAlt";
import { Breadcrumbs, JsonLd, LearnHeader, breadcrumbData, learnCrumbs } from "./_parts/LearnParts";

const DESCRIPTION = "F値・シャッタースピード・ISO感度の基本から、カメラメーカーの選び方、構図まで。このサイトの写真の撮影設定を実例に、写真の「なぜ？」をやさしく解説します。";

export const metadata = learnMetadata(ROUTES.LEARN, LEARN_TITLE, DESCRIPTION, "website");

export default async function LearnPage() {
    const photos = await loadAllPhotos();
    const covers = coverPhotos(photos);
    const crumbs = learnCrumbs();
    const lead = covers["camera-basics"];
    const collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: LEARN_TITLE,
        description: DESCRIPTION,
        url: `${siteConfig.url}${ROUTES.LEARN}`,
        inLanguage: "ja-JP",
        isPartOf: { "@type": "WebSite", name: siteConfig.name, url: siteConfig.url },
        mainEntity: {
            "@type": "ItemList",
            numberOfItems: LEARN_ARTICLES.length,
            itemListElement: LEARN_ARTICLES.map((a, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: `${siteConfig.url}${a.href}`,
                name: a.title,
            })),
        },
        ...(lead ? { image: publicImageUrl(lead.src || lead.thumbSrc) } : {}),
    };

    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            <JsonLd data={collection} />
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-5xl" data-testid="learn-index">
                <Breadcrumbs crumbs={crumbs} />
                <LearnHeader
                    eyebrow="撮影ガイド"
                    title={LEARN_TITLE}
                    lead="専門用語を覚える前に、撮りたい写真を撮れるようになろう。露出・ピント・動き・光と色・レンズ・構図・場面別・現像・機材の手入れまで、順に読めば一通り身につく教科書です。このサイトに載っている写真の撮影設定を、実例として一緒に見ていきます。はじめての人は、第1章から順番にどうぞ。"
                />

                <ul className="m-0 p-0 list-none grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {LEARN_ARTICLES.map((a) => {
                        const cover = covers[a.id];
                        return (
                            <li key={a.id}>
                                <TrackedLink
                                    contentType="article"
                                    href={a.href}
                                    prefetch={false}
                                    className="group flex flex-col h-full rounded-2xl overflow-hidden bg-surface ring-1 ring-line hover:ring-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    style={{ touchAction: "manipulation" }}
                                    data-testid="learn-card"
                                >
                                    {cover && (
                                        <span className="block relative bg-surface-4" style={{ aspectRatio: "3 / 2" }}>
                                            <Thumb photo={cover} alt={photoAltText(cover, "ja")} sizes="(min-width: 768px) 320px, 92vw" cellAspect={3 / 2} />
                                        </span>
                                    )}
                                    <span className="flex flex-col flex-1 p-5">
                                        <span className="eyebrow text-accent">{a.eyebrow}</span>
                                        {(a.level || a.minutes) && (
                                            <span className="block mt-1 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                                                {[a.level, a.minutes ? `約${a.minutes}分` : null].filter(Boolean).join(" ・ ")}
                                            </span>
                                        )}
                                        <span className="block mt-2 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "30px" }}>{a.title}</span>
                                        <span className="block mt-2 text-text-2" style={{ fontSize: "14px", lineHeight: "22px" }}>{a.description}</span>
                                        <span className="mt-auto pt-4 text-white font-semibold" style={{ fontSize: "14px" }}>
                                            読む<span aria-hidden="true"> ›</span>
                                        </span>
                                    </span>
                                </TrackedLink>
                            </li>
                        );
                    })}
                </ul>

                <p className="m-0 mt-10 text-text-2" style={{ fontSize: "14px", lineHeight: "22px" }}>
                    学んだら、旅先や日常で撮ってみましょう。次に行く場所は
                    <TrackedLink contentType="spot" href={ROUTES.SPOTS} prefetch={false} className="inline-flex items-center min-h-[44px] mx-1 text-accent underline underline-offset-4 hover:text-accent-strong">撮影スポット</TrackedLink>
                    で探せます。
                </p>
            </main>
        </>
    );
}
