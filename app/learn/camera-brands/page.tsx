// app/learn/camera-brands/page.tsx（サーバーコンポーネント）
//
// **カメラメーカーの特徴を比較**（2026-11-04 に作り直し）。中身は `lib/data/learn/cameraBrands.ts`。
// 早見表 → 用途から選ぶ → メーカーごと（このサイトでそのメーカーで撮った写真へのリンク）→ 買う前の確認 → FAQ。
// 機種の写真への道は、既存の機材の集約頁（`/camera/<機種>`・`collectEntries(…, "camera")`）を使う。

import React from "react";
import CameraBrandsAnalytics from "./CameraBrandsAnalytics";
import Link from "next/link";
import { loadAllPhotos } from "@/lib/server/photos";
import { ROUTES } from "@/lib/routes";
import { collectEntries, collectionPath, type CollectionEntry } from "@/lib/utils/collections";
import { learnArticle } from "@/lib/data/learn/articles";
import {
    BRANDS, BRANDS_FAQ, BRANDS_LEAD, BUYING_CHECKLIST, CAMERA_TERMS, CHOOSING_STEPS, COMPARISON_AXES, COMMON_MISTAKES, QUICK_ANSWERS, SHOOTING_PATHS, SMARTPHONE_NOTE, USE_CASES, brandOfCamera,
} from "@/lib/data/learn/cameraBrands";
import { exampleRule } from "@/lib/data/learn/cameraBasics";
import { pickExamples } from "@/lib/learn/examples";
import { articleStructuredData, learnMetadata } from "@/lib/learn/seo";
import {
    Breadcrumbs, ExampleGrid, ExternalLink, FaqList, JsonLd, LearnHeader, LearnTable, breadcrumbData, learnCrumbs,
} from "../_parts/LearnParts";

const ARTICLE = learnArticle("camera-brands");
const TITLE = ARTICLE.title;

export const metadata = learnMetadata(ARTICLE.href, TITLE, ARTICLE.description, "article");

/** そのメーカーの機種のうち、このサイトに写真がある機種（多い順） */
function camerasByBrand(entries: CollectionEntry[]): Map<string, CollectionEntry[]> {
    const out = new Map<string, CollectionEntry[]>();
    for (const e of entries) {
        const b = brandOfCamera(e.label);
        if (!b) continue;
        out.set(b.id, [...(out.get(b.id) ?? []), e]);
    }
    return out;
}

export default async function CameraBrandsPage() {
    const photos = await loadAllPhotos();
    const crumbs = learnCrumbs({ name: ARTICLE.title, href: ARTICLE.href });
    const byBrand = camerasByBrand(collectEntries(photos, "camera"));
    const phonePhotos = pickExamples(photos, exampleRule("smartphone"));

    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            <JsonLd data={articleStructuredData({
                path: ARTICLE.href,
                headline: ARTICLE.title,
                description: ARTICLE.description,
                published: ARTICLE.published!,
                modified: ARTICLE.modified!,
                images: [],
            })} />
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-4xl" data-testid="learn-brands">
                <CameraBrandsAnalytics />
                <Breadcrumbs crumbs={crumbs} />
                <LearnHeader eyebrow={ARTICLE.eyebrow} title={ARTICLE.title} lead={BRANDS_LEAD} />

                <section aria-labelledby="brands-conclusion" className="mb-10">
                    <h2 id="brands-conclusion" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>結論｜カメラメーカーは撮りたいものから選ぼう</h2>
                    <p className="m-0 mt-3 text-chip-text" style={{ fontSize: "15px", lineHeight: "26px" }}>メーカーの名前だけで画質や使いやすさは決まりません。まずは自分の撮影目的に近い候補を見つけ、実際の機種とレンズを比較しましょう。</p>
                    <LearnTable caption="目的別の候補（順位ではありません）" head={["撮影目的", "まず比較したいメーカー・シリーズ"]} rows={QUICK_ANSWERS.map((item) => [item.need, item.answer])} />
                </section>

                <section aria-labelledby="brands-steps" className="mb-10">
                    <h2 id="brands-steps" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>迷ったら、この4ステップで選ぼう</h2>
                    <ol className="m-0 mt-5 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {CHOOSING_STEPS.map((step, index) => (
                            <li key={step.title} className="rounded-xl bg-surface ring-1 ring-line p-4">
                                <p className="m-0 text-accent font-semibold" style={{ fontSize: "13px" }}>STEP {index + 1}</p>
                                <h3 className="m-0 mt-2 font-semibold text-white" style={{ fontSize: "16px" }}>{step.title}</h3>
                                <p className="m-0 mt-2 text-chip-text" style={{ fontSize: "14px", lineHeight: "24px" }}>{step.detail}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                <section aria-labelledby="brands-terms" className="mb-10">
                    <h2 id="brands-terms" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>まず知っておきたい8つの用語</h2>
                    <p className="m-0 mt-3 text-chip-text" style={{ fontSize: "15px", lineHeight: "26px" }}>専門用語がわからなくても大丈夫。比較表を読む前に、ここだけ押さえましょう。</p>
                    <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {CAMERA_TERMS.map((item) => (
                            <div key={item.term} className="rounded-xl bg-surface ring-1 ring-line p-4">
                                <dt className="font-semibold text-white" style={{ fontSize: "16px" }}>{item.term}</dt>
                                <dd className="m-0 mt-2 text-chip-text" style={{ fontSize: "14px", lineHeight: "24px" }}>{item.explanation}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                <section aria-labelledby="brands-table">
                    <h2 id="brands-table" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>カメラメーカー9社の違いを比較｜マウント・センサー・向いている人</h2>
                    <LearnTable
                        caption="主なマウントとセンサーの大きさ（機種ごとの仕様は公式サイトで確かめてください）"
                        head={["メーカー", "主なマウント", "センサーの大きさ", "向く人"]}
                        rows={BRANDS.map((b) => [b.name, b.mounts, b.sensors, b.forWhom])}
                    />
                </section>

                <section aria-labelledby="brands-usecase" className="mt-12">
                    <h2 id="brands-usecase" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>用途別のカメラの選び方｜風景・人物・旅行・動画</h2>
                    <LearnTable caption="撮りたいものから、見るべきところ" head={["撮りたいもの", "見るところ"]} rows={USE_CASES.map((u) => [u.need, u.look])} />
                </section>


                <section aria-labelledby="brands-paths" className="mt-12">
                    <h2 id="brands-paths" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>撮りたい写真別｜比較するメーカーの候補</h2>
                    <p className="m-0 mt-3 text-chip-text" style={{ fontSize: "15px", lineHeight: "26px" }}>順位ではなく、用途に合う候補を紹介します。ここにないメーカーでも撮影できないわけではありません。</p>
                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {SHOOTING_PATHS.map((item) => (
                            <article key={item.title} className="rounded-2xl bg-surface ring-1 ring-line p-5">
                                <h3 className="m-0 font-semibold text-white" style={{ fontSize: "18px" }}>{item.title}</h3>
                                <p className="m-0 mt-3 text-accent" style={{ fontSize: "14px", lineHeight: "24px" }}>{item.candidates}</p>
                                <p className="m-0 mt-3 text-chip-text" style={{ fontSize: "14px", lineHeight: "25px" }}>{item.reason}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section aria-labelledby="brands-axes" className="mt-12">
                    <h2 id="brands-axes" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>メーカーを比べる6つの視点</h2>
                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {COMPARISON_AXES.map((item) => (
                            <article key={item.title} className="rounded-2xl border border-line p-5">
                                <p className="m-0 text-accent font-semibold" style={{ fontSize: "13px" }}>{item.title}</p>
                                <h3 className="m-0 mt-2 font-semibold text-white" style={{ fontSize: "17px" }}>{item.question}</h3>
                                <p className="m-0 mt-3 text-chip-text" style={{ fontSize: "14px", lineHeight: "25px" }}>{item.body}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <nav aria-label="メーカーへ移動" className="mt-12 flex flex-wrap gap-2">
                    {BRANDS.map((b) => (
                        <Link
                            key={b.id}
                            href={`#${b.id}`} prefetch={false}
                            data-learn-target="brand_jump"
                            className="inline-flex items-center min-h-[44px] px-4 rounded-full bg-chip ring-1 ring-line text-chip-text hover:text-white"
                            style={{ fontSize: "13px", touchAction: "manipulation" }}
                        >
                            {b.name}
                        </Link>
                    ))}
                </nav>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {BRANDS.map((b) => {
                        const cams = byBrand.get(b.id) ?? [];
                        return (
                            <section
                                key={b.id}
                                id={b.id}
                                aria-labelledby={`${b.id}-name`}
                                className="scroll-mt-24 rounded-2xl bg-surface ring-1 ring-line p-5 flex flex-col"
                                data-testid="learn-brand"
                            >
                                <p aria-hidden="true" className="m-0 eyebrow text-accent">{b.series}</p>
                                <h2 id={`${b.id}-name`} className="m-0 mt-1 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.3 }}>{b.name}</h2>
                                <p className="m-0 mt-3 text-white font-medium" style={{ fontSize: "15px", lineHeight: "24px" }}>{b.character}</p>
                                <p className="m-0 mt-2 text-chip-text" style={{ fontSize: "15px", lineHeight: "26px" }}>{b.detail}</p>
                                <dl className="m-0 mt-4 grid gap-3" style={{ fontSize: "14px", lineHeight: "22px" }}>
                                    <div>
                                        <dt className="text-text-3" style={{ fontSize: "12px" }}>こんな人に</dt>
                                        <dd className="m-0 text-white">{b.forWhom}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-text-3" style={{ fontSize: "12px" }}>気をつけたい点</dt>
                                        <dd className="m-0 text-text-2">{b.caution}</dd>
                                    </div>
                                </dl>
                                {cams.length > 0 && (
                                    <div className="mt-4" data-testid="learn-brand-cameras">
                                        <p className="m-0 text-text-3" style={{ fontSize: "12px" }}>このサイトで、このメーカーで撮った写真</p>
                                        <ul className="m-0 p-0 list-none flex flex-wrap gap-x-4">
                                            {cams.map((c) => (
                                                <li key={c.slug}>
                                                    <Link href={collectionPath("camera", c.slug)} prefetch={false} data-learn-target="camera_examples" className="inline-flex items-center gap-1 min-h-[44px] text-white underline underline-offset-4 decoration-line-strong hover:decoration-white" style={{ fontSize: "14px" }}>
                                                        {c.label}<span className="text-text-3 tabular-nums">（{c.count}枚）</span>
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div className="mt-auto pt-3">
                                    <div data-learn-target="brand_official"><ExternalLink href={b.official}>{b.name} の公式サイト</ExternalLink></div>
                                </div>
                            </section>
                        );
                    })}
                </div>
                <p className="m-0 mt-4 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                    このページは各メーカーの一般的な傾向をまとめたものです。仕様・互換性・価格・発売状況は、各メーカーの公式情報で確かめてください。
                </p>

                <section aria-labelledby="brands-phone" className="mt-12 py-10 border-t border-line">
                    <h2 id="brands-phone" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>スマートフォンから始める</h2>
                    {SMARTPHONE_NOTE.map((p) => (
                        <p key={p} className="m-0 mt-4 text-chip-text" style={{ fontSize: "16px", lineHeight: "30px" }}>{p}</p>
                    ))}
                    <ExampleGrid id="brands-phone-examples" heading={exampleRule("smartphone").heading} photos={phonePhotos} />
                </section>

                <section aria-labelledby="brands-buying" className="py-10 border-t border-line">
                    <h2 id="brands-buying" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>買う前に確かめたい6つのこと</h2>
                    <ol className="m-0 mt-4 p-0 list-none flex flex-col gap-5">
                        {BUYING_CHECKLIST.map((item, i) => (
                            <li key={item.title} className="flex gap-4">
                                <span aria-hidden="true" className="flex-shrink-0 w-8 text-accent font-semibold tabular-nums" style={{ fontSize: "15px", lineHeight: "26px" }}>{String(i + 1).padStart(2, "0")}</span>
                                <div>
                                    <h3 className="m-0 text-white font-semibold" style={{ fontSize: "17px", lineHeight: "26px" }}>{item.title}</h3>
                                    <p className="m-0 mt-1 text-chip-text" style={{ fontSize: "15px", lineHeight: "26px" }}>{item.body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>


                <section aria-labelledby="brands-mistakes" className="py-10 border-t border-line">
                    <h2 id="brands-mistakes" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>購入前に避けたい5つの失敗</h2>
                    <div className="mt-5 grid gap-4">
                        {COMMON_MISTAKES.map((item) => (
                            <article key={item.title} className="rounded-xl bg-surface ring-1 ring-line p-5">
                                <h3 className="m-0 text-white font-semibold" style={{ fontSize: "16px" }}>{item.title}</h3>
                                <p className="m-0 mt-2 text-chip-text" style={{ fontSize: "14px", lineHeight: "25px" }}>{item.fix}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section aria-labelledby="brands-faq" className="py-10 border-t border-line">
                    <h2 id="brands-faq" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>カメラメーカー比較でよくある質問</h2>
                    <FaqList items={BRANDS_FAQ} />
                </section>

                <aside aria-labelledby="brands-next" className="mt-6 rounded-2xl bg-accent-soft ring-1 ring-line p-5">
                    <h2 id="brands-next" className="m-0 text-white font-semibold" style={{ fontSize: "15px" }}>次に読む</h2>
                    <Link href={ROUTES.LEARN_CAMERA_BASICS} prefetch={false} data-learn-target="camera_basics" className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "15px" }}>
                        カメラの使い方 完全入門（F値・シャッター・ISO）
                    </Link>
                </aside>
            </main>
        </>
    );
}
