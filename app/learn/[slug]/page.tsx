// app/learn/[slug]/page.tsx（サーバーコンポーネント）
//
// **教科書の章**（2026-11-04）。中身は `lib/data/learn/chapters/<slug>.ts`（`Chapter`）。
// 書き終えた章だけが頁になる（`CHAPTERS`）。実例の写真はビルド時に `photos.json` の EXIF から選ぶ。

import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadAllPhotos } from "@/lib/server/photos";
import { publicImageUrl } from "@/lib/utils/seo";
import { CHAPTERS, chapterBySlug } from "@/lib/data/learn/chapters";
import { exampleRule } from "@/lib/data/learn/cameraBasics";
import { pickExamples } from "@/lib/learn/examples";
import { articleStructuredData, learnMetadata } from "@/lib/learn/seo";
import { Breadcrumbs, JsonLd, LearnHeader, breadcrumbData, learnCrumbs } from "../_parts/LearnParts";
import ChapterBody from "../_parts/ChapterBody";

// 静的エクスポート: 書き終えた章だけを作り、それ以外は 404
export const dynamicParams = false;

export function generateStaticParams() {
    return CHAPTERS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const chapter = chapterBySlug(slug);
    if (!chapter) return { robots: { index: false, follow: true } };
    return learnMetadata(`/learn/${chapter.slug}`, chapter.title, chapter.description, "article");
}

export default async function ChapterPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const chapter = chapterBySlug(slug);
    if (!chapter) notFound();
    const photos = await loadAllPhotos();
    const ruleIds = [...new Set(chapter.sections.flatMap((s) => s.blocks).flatMap((b) => (b.t === "example" ? [b.rule] : [])))];
    const examples = new Map(ruleIds.map((id) => [id, pickExamples(photos, exampleRule(id))] as const));
    const images = [...new Set([...examples.values()].flat().map((p) => publicImageUrl(p.src || p.thumbSrc)))].slice(0, 6);
    const path = `/learn/${chapter.slug}`;
    const crumbs = learnCrumbs({ name: chapter.title, href: path });
    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            <JsonLd data={articleStructuredData({
                path, headline: chapter.title, description: chapter.description,
                published: chapter.published, modified: chapter.modified, images,
            })} />
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-3xl" data-testid="learn-chapter">
                <Breadcrumbs crumbs={crumbs} />
                <LearnHeader eyebrow={`${chapter.eyebrow}・${chapter.level}`} title={chapter.title} lead={chapter.lead} />
                <ChapterBody chapter={chapter} examples={examples} />
            </main>
        </>
    );
}
