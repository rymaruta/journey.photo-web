// app/help/[slug]/page.tsx（サーバーコンポーネント）
//
// **使い方の1頁**（2026-11-12・札 journey.photo-ios#517）。絵1枚と3行。要る頁だけ畳んだ節（`folds`）。
// 中身は台帳（`lib/data/helpPages.ts`）にあり、ここは並べるだけ。

import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import { HELP_PAGES, CHECKED_APP_VERSION, helpPageBySlug } from "@/lib/data/helpPages";
import HelpFigure from "../HelpFigure";
import { Breadcrumbs, JsonLd, breadcrumbData, helpCrumbs, helpMetadata } from "../HelpParts";

// 静的エクスポート: 台帳の slug だけ生成し、それ以外は 404
export const dynamicParams = false;

export function generateStaticParams() {
    return HELP_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const page = helpPageBySlug(slug);
    if (!page) return { robots: { index: false, follow: true } };
    return helpMetadata(ROUTES.HELP_PAGE(page.slug), page.title, page.description);
}

export default async function HelpPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const page = helpPageBySlug(slug);
    if (!page) notFound();
    const crumbs = helpCrumbs({ name: page.title, href: ROUTES.HELP_PAGE(page.slug) });
    const others = HELP_PAGES.filter((p) => p.slug !== page.slug);

    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-3xl" data-testid="help-page">
                <Breadcrumbs crumbs={crumbs} />
                <header className="mb-5">
                    {/* 眉は「使い方」と使える所。中黒で区切らず、余白で分ける（2026-11-12 owner の好み） */}
                    <p className="m-0 mb-2 flex flex-wrap gap-x-3 eyebrow normal-case text-accent">
                        <span>使い方</span>
                        <span data-testid="help-scope">{page.scope}</span>
                    </p>
                    <h1 className="m-0 font-serif font-bold text-white wrap-anywhere" style={{ fontSize: "clamp(26px, 5vw, 36px)", lineHeight: 1.3 }}>
                        {page.title}
                    </h1>
                </header>

                <figure className="m-0 rounded-2xl bg-surface ring-1 ring-line p-3 sm:p-4">
                    <HelpFigure slug={page.slug} label={page.figureLabel} />
                </figure>

                <ol className="m-0 mt-5 p-0 list-none flex flex-col gap-3" data-testid="help-lines">
                    {page.lines.map((line, i) => (
                        <li key={i} className="flex gap-3">
                            <span aria-hidden="true" className="shrink-0 tabular-nums text-text-3" style={{ fontSize: "15px", lineHeight: "26px", minWidth: "1.2em" }}>{i + 1}</span>
                            <span className="text-white/90 wrap-anywhere" style={{ fontSize: "16px", lineHeight: "26px" }}>{line}</span>
                        </li>
                    ))}
                </ol>

                {page.folds && page.folds.length > 0 && (
                    <div className="mt-6 rounded-2xl bg-surface ring-1 ring-line overflow-hidden" data-testid="help-folds">
                        {page.folds.map((fold, i) => (
                            <details key={fold.title} className={`group ${i > 0 ? "border-t border-line" : ""}`}>
                                <summary className="flex items-center justify-between gap-3 min-h-[52px] px-4 cursor-pointer list-none text-white [&::-webkit-details-marker]:hidden" style={{ fontSize: "15px", lineHeight: "22px" }}>
                                    <span>{fold.title}</span>
                                    <span aria-hidden="true" className="text-text-3 transition-transform group-open:rotate-45" style={{ fontSize: "20px", lineHeight: "20px" }}>＋</span>
                                </summary>
                                <ul className="m-0 px-4 pb-4 pl-8 flex flex-col gap-2 list-disc text-text-2" style={{ fontSize: "14px", lineHeight: "22px" }}>
                                    {fold.items.map((item) => <li key={item} className="wrap-anywhere">{item}</li>)}
                                </ul>
                                {fold.links && (
                                    <p className="m-0 px-4 pb-3">
                                        {fold.links.map((l) => (
                                            <Link key={l.href} href={l.href} prefetch={false} className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "14px" }}>
                                                {l.label}
                                            </Link>
                                        ))}
                                    </p>
                                )}
                            </details>
                        ))}
                    </div>
                )}

                {/* App Store への札は置かない（フッターの先頭にアプリのご案内の札が出る・同じ札を2枚にしない） */}
                <p className="m-0 mt-6 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }} data-testid="help-version">
                    この頁は iPhone のアプリ {CHECKED_APP_VERSION} の時点の内容です。
                </p>

                <nav aria-labelledby="help-others" className="mt-10 border-t border-line pt-6">
                    <h2 id="help-others" className="m-0 mb-2 eyebrow text-accent">ほかの使い方</h2>
                    <ul className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-x-6" data-testid="help-others">
                        {others.map((p) => (
                            <li key={p.slug}>
                                <Link href={ROUTES.HELP_PAGE(p.slug)} prefetch={false} className="flex items-center min-h-[44px] text-white/90 hover:text-white wrap-anywhere" style={{ fontSize: "15px" }}>
                                    {p.title}
                                </Link>
                            </li>
                        ))}
                        <li>
                            <Link href={ROUTES.HELP} prefetch={false} className="flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "15px" }}>
                                使い方の目次
                            </Link>
                        </li>
                    </ul>
                </nav>
            </main>
        </>
    );
}
