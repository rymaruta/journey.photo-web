// app/learn/camera-basics/page.tsx（サーバーコンポーネント）
//
// **カメラの使い方 完全入門**（2026-11-04 に作り直し）。中身は `lib/data/learn/cameraBasics.ts`。
// 各レッスンは「要点 → 本文 → 目安の表 → このサイトの実例 → よくある失敗」。
// 実例の写真はビルド時に `photos.json` の EXIF から選ぶ（`pickExamples`）。合う写真が無い塊は出さない。

import React from "react";
import Link from "next/link";
import TrackedLink from "@/app/components/TrackedLink";
import InlineText from "../_parts/InlineText";
import { loadAllPhotos } from "@/lib/server/photos";
import { ROUTES } from "@/lib/routes";
import { publicImageUrl } from "@/lib/utils/seo";
import { learnArticle } from "@/lib/data/learn/articles";
import {
    BASICS_FAQ, BASICS_LEAD, FIELD_GUIDES, LAB_AFTER_LESSON, LESSONS, exampleRule,
} from "@/lib/data/learn/cameraBasics";
import { pickExamples } from "@/lib/learn/examples";
import { articleStructuredData, learnMetadata } from "@/lib/learn/seo";
import ExposureLab from "./ExposureLab";
import { BASICS_DIAGRAMS, BASICS_DRILLS, BASICS_QUIZ, BASICS_SUMMARY } from "@/lib/data/learn/basicsExtras";
import { Diagram } from "../_parts/Diagrams";
import QuizBlock from "../_parts/QuizBlock";
import {
    Breadcrumbs, ExampleGrid, FaqList, JsonLd, LearnHeader, LearnTable, breadcrumbData, learnCrumbs,
} from "../_parts/LearnParts";

const ARTICLE = learnArticle("camera-basics");
const TITLE = "カメラの使い方 完全入門｜F値・シャッター速度・ISOをやさしく解説";

export const metadata = learnMetadata(ARTICLE.href, TITLE, ARTICLE.description, "article");

export default async function CameraBasicsPage() {
    const photos = await loadAllPhotos();
    const crumbs = learnCrumbs({ name: ARTICLE.title, href: ARTICLE.href });
    // レッスンごとの実例（条件 id → 写真）。同じ写真が別の塊にも出るのは構わない（条件が違う）
    const examples = new Map(
        LESSONS.flatMap((l) => l.examples ?? []).map((id) => [id, pickExamples(photos, exampleRule(id))] as const),
    );
    const shown = [...examples.values()].flat();
    const images = [...new Set(shown.map((p) => publicImageUrl(p.src || p.thumbSrc)))].slice(0, 6);

    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            <JsonLd data={articleStructuredData({
                path: ARTICLE.href,
                headline: ARTICLE.title,
                description: ARTICLE.description,
                published: ARTICLE.published!,
                modified: ARTICLE.modified!,
                images,
            })} />
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-3xl" data-testid="learn-basics">
                <Breadcrumbs crumbs={crumbs} />
                <LearnHeader eyebrow={ARTICLE.eyebrow} title={ARTICLE.title} lead={BASICS_LEAD} />

                <nav aria-labelledby="basics-toc" className="rounded-2xl bg-surface ring-1 ring-line p-5 mb-10">
                    <h2 id="basics-toc" className="m-0 text-white font-semibold" style={{ fontSize: "15px" }}>この記事でわかること</h2>
                    <ol className="m-0 mt-2 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                        {LESSONS.map((l, i) => (
                            <li key={l.id}>
                                <Link href={`#${l.id}`} prefetch={false} className="flex items-center gap-2 min-h-[44px] text-text-2 hover:text-white" style={{ fontSize: "14px", lineHeight: "20px" }}>
                                    <span className="text-text-3 tabular-nums" style={{ fontSize: "12px" }}>{String(i + 1).padStart(2, "0")}</span>
                                    {l.title}
                                </Link>
                            </li>
                        ))}
                    </ol>
                </nav>

                <article>
                    {LESSONS.map((l, i) => (
                        <React.Fragment key={l.id}>
                            <section id={l.id} aria-labelledby={`${l.id}-title`} className="py-10 border-t border-line scroll-mt-24" data-testid="learn-lesson">
                                <p aria-hidden="true" className="m-0 eyebrow text-accent">レッスン {i + 1}</p>
                                <h2 id={`${l.id}-title`} className="m-0 mt-1.5 font-serif font-bold text-white" style={{ fontSize: "26px", lineHeight: 1.4 }}>{l.title}</h2>
                                <p className="m-0 mt-4 rounded-xl bg-accent-soft px-4 py-3 text-white" style={{ fontSize: "15px", lineHeight: "24px" }} data-testid="learn-point">
                                    <span className="text-accent font-semibold">要点　</span>{l.point}
                                </p>
                                {l.body.map((para) => (
                                    <p key={para} className="m-0 mt-4 text-chip-text" style={{ fontSize: "16px", lineHeight: "30px" }}><InlineText text={para} /></p>
                                ))}
                                {l.table && <LearnTable {...l.table} />}
                                {(l.examples ?? []).map((id) => (
                                    <ExampleGrid key={id} id={`${l.id}-${id}`} heading={exampleRule(id).heading} photos={examples.get(id) ?? []} />
                                ))}
                                {(BASICS_DIAGRAMS[l.id] ?? []).map((d) => <Diagram key={d.id} id={d.id} caption={d.caption} />)}
                                {l.pitfalls && l.pitfalls.length > 0 && (
                                    <div className="mt-6">
                                        <h3 className="m-0 text-white font-semibold" style={{ fontSize: "14px" }}>よくある失敗</h3>
                                        <ul className="m-0 mt-2 pl-5 flex flex-col gap-2 text-text-2 marker:text-text-3" style={{ fontSize: "15px", lineHeight: "26px" }}>
                                            {l.pitfalls.map((p) => <li key={p}>{p}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </section>
                            {l.id === LAB_AFTER_LESSON && <ExposureLab />}
                        </React.Fragment>
                    ))}
                </article>

                {FIELD_GUIDES.map((g) => (
                    <section key={g.id} aria-labelledby={`guide-${g.id}`} className="py-10 border-t border-line">
                        <p aria-hidden="true" className="m-0 eyebrow text-accent">撮影の手引き</p>
                        <h2 id={`guide-${g.id}`} className="m-0 mt-1.5 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>{g.title}</h2>
                        <ul className="m-0 mt-4 pl-5 flex flex-col gap-3 text-chip-text marker:text-accent" style={{ fontSize: "15px", lineHeight: "26px" }}>
                            {g.items.map((item) => <li key={item}><InlineText text={item} /></li>)}
                        </ul>
                    </section>
                ))}

                <section id="chapter-summary" aria-labelledby="basics-summary-title" className="py-10 border-t border-line scroll-mt-24">
                    <p aria-hidden="true" className="m-0 eyebrow text-accent">SUMMARY</p>
                    <h2 id="basics-summary-title" className="m-0 mt-1.5 font-serif font-bold text-white" style={{ fontSize: "26px", lineHeight: 1.4 }}>この章のまとめ</h2>
                    <ul className="m-0 mt-4 pl-5 flex flex-col gap-3 text-chip-text marker:text-accent" style={{ fontSize: "16px", lineHeight: "28px" }}>
                        {BASICS_SUMMARY.map((t) => <li key={t}>{t}</li>)}
                    </ul>
                    <h3 className="m-0 mt-10 text-white font-semibold" style={{ fontSize: "18px" }}>外で撮ってみる（練習）</h3>
                    <ol className="m-0 mt-3 p-0 list-none flex flex-col gap-3">
                        {BASICS_DRILLS.map((d, i) => (
                            <li key={d.title} className="rounded-2xl bg-surface ring-1 ring-line p-4" data-testid="learn-drill">
                                <p className="m-0 text-white font-semibold" style={{ fontSize: "15px", lineHeight: "24px" }}>
                                    <span className="text-accent tabular-nums mr-2">練習 {i + 1}</span>{d.title}
                                </p>
                                <p className="m-0 mt-1 text-text-2" style={{ fontSize: "15px", lineHeight: "26px" }}>{d.text}</p>
                            </li>
                        ))}
                    </ol>
                    <h3 className="m-0 mt-10 text-white font-semibold" style={{ fontSize: "18px" }}>確認クイズ</h3>
                    <QuizBlock items={BASICS_QUIZ} />
                </section>

                <section aria-labelledby="basics-faq" className="py-10 border-t border-line">
                    <h2 id="basics-faq" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>よくある質問</h2>
                    <FaqList items={BASICS_FAQ} />
                </section>

                <aside aria-labelledby="basics-next" className="mt-6 rounded-2xl bg-accent-soft ring-1 ring-line p-5">
                    <h2 id="basics-next" className="m-0 text-white font-semibold" style={{ fontSize: "15px" }}>次に読む</h2>
                    <ul className="m-0 mt-1 p-0 list-none">
                        <li>
                            <TrackedLink contentType="article" href="/learn/focus-and-blur" prefetch={false} className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "15px" }}>
                                第2章 ピントとぼけ｜狙った所だけをくっきり写す
                            </TrackedLink>
                        </li>
                        <li>
                            <TrackedLink contentType="article" href={ROUTES.LEARN_CAMERA_BRANDS} prefetch={false} className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "15px" }}>
                                カメラメーカーの特徴を比較する
                            </TrackedLink>
                        </li>
                        <li>
                            <TrackedLink contentType="article" href={ROUTES.COMPOSITION} prefetch={false} className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "15px" }}>
                                構図ガイドで、ガイド線を自分の写真に重ねる
                            </TrackedLink>
                        </li>
                    </ul>
                </aside>
            </main>
        </>
    );
}
