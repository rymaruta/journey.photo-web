// app/learn/_parts/ChapterBody.tsx（サーバーコンポーネント）
//
// **教科書の「章」の本体**（2026-11-04）。`Chapter`（`lib/data/learn/chapterTypes.ts`）を描く。
// 順: 目次 → 節（要点・本文の塊・図・表・実例・よくある失敗）→ まとめ → 練習 → 確認クイズ → よくある質問 → 次に読む。
// 実例の写真は呼ぶ側がビルド時に選んで渡す（`examples`: 条件 id → 写真）。合う写真が無い塊は出さない。

import React from "react";
import Link from "next/link";
import TrackedLink from "@/app/components/TrackedLink";
import AppInstallCard from "@/app/components/AppInstallCard";
import { ROUTES } from "@/lib/routes";
import type { Photo } from "@/lib/data/photos";
import type { Block, Chapter } from "@/lib/data/learn/chapterTypes";
import { exampleRule } from "@/lib/data/learn/cameraBasics";
import { LEARN_ARTICLES } from "@/lib/data/learn/articles";
import { ExampleGrid, FaqList, LearnTable } from "./LearnParts";
import { Diagram } from "./Diagrams";
import QuizBlock from "./QuizBlock";
import InlineText from "./InlineText";

const CALLOUT: Record<"tip" | "warn" | "memo", { label: string; box: string; mark: string }> = {
    tip: { label: "コツ", box: "bg-accent-soft ring-1 ring-line", mark: "text-accent" },
    warn: { label: "気をつけたい", box: "bg-surface ring-1 ring-line-strong", mark: "text-white" },
    memo: { label: "補足", box: "bg-surface ring-1 ring-line", mark: "text-text-2" },
};

function BlockView({ b, sectionId, index, examples }: {
    b: Block; sectionId: string; index: number; examples: Map<string, Photo[]>;
}) {
    switch (b.t) {
        case "p":
            return <p className="m-0 mt-4 text-chip-text" style={{ fontSize: "16px", lineHeight: "30px" }}><InlineText text={b.text} /></p>;
        case "h":
            return <h3 className="m-0 mt-8 text-white font-semibold" style={{ fontSize: "18px", lineHeight: "28px" }}>{b.text}</h3>;
        case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
                <Tag className={`m-0 mt-4 pl-6 flex flex-col gap-2 text-chip-text marker:text-accent ${b.ordered ? "list-decimal" : "list-disc"}`} style={{ fontSize: "16px", lineHeight: "28px" }}>
                    {b.items.map((it) => <li key={it}><InlineText text={it} /></li>)}
                </Tag>
            );
        }
        case "table":
            return <LearnTable caption={b.caption} head={b.head} rows={b.rows} />;
        case "callout": {
            const c = CALLOUT[b.kind];
            return (
                <aside className={`mt-5 rounded-2xl px-4 py-3 ${c.box}`} data-testid={`learn-callout-${b.kind}`}>
                    <p className="m-0 text-white" style={{ fontSize: "15px", lineHeight: "26px" }}>
                        <span className={`font-semibold ${c.mark}`}>{b.title ?? c.label}　</span><InlineText text={b.text} />
                    </p>
                </aside>
            );
        }
        case "steps":
            return (
                <ol className="m-0 mt-5 p-0 list-none flex flex-col gap-3">
                    {b.items.map((s, i) => (
                        <li key={s.title} className="flex gap-3 rounded-2xl bg-surface ring-1 ring-line p-4">
                            <span aria-hidden="true" className="flex-shrink-0 w-8 h-8 rounded-full ring-1 ring-accent text-accent inline-flex items-center justify-center tabular-nums" style={{ fontSize: "14px" }}>{i + 1}</span>
                            <span className="min-w-0">
                                <span className="block text-white font-semibold" style={{ fontSize: "15px", lineHeight: "24px" }}>{s.title}</span>
                                <span className="block mt-1 text-text-2" style={{ fontSize: "15px", lineHeight: "26px" }}><InlineText text={s.text} /></span>
                            </span>
                        </li>
                    ))}
                </ol>
            );
        case "diagram":
            return <Diagram id={b.id} caption={b.caption} />;
        case "example": {
            const rule = exampleRule(b.rule);
            return <ExampleGrid id={`${sectionId}-${b.rule}-${index}`} heading={rule.heading} photos={examples.get(b.rule) ?? []} />;
        }
    }
}

export default function ChapterBody({ chapter, examples }: { chapter: Chapter; examples: Map<string, Photo[]> }) {
    const idx = LEARN_ARTICLES.findIndex((a) => a.id === chapter.slug);
    const prev = idx > 0 ? LEARN_ARTICLES[idx - 1] : undefined;
    const following = idx >= 0 && idx < LEARN_ARTICLES.length - 1 ? LEARN_ARTICLES[idx + 1] : undefined;
    return (
        <>
            <nav aria-labelledby="chapter-toc" className="rounded-2xl bg-surface ring-1 ring-line p-5 mb-10">
                <h2 id="chapter-toc" className="m-0 text-white font-semibold" style={{ fontSize: "15px" }}>この章でわかること（約{chapter.minutes}分）</h2>
                <ol className="m-0 mt-2 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                    {chapter.sections.map((s, i) => (
                        <li key={s.id}>
                            <Link href={`#${s.id}`} prefetch={false} className="flex items-center gap-2 min-h-[44px] text-text-2 hover:text-white" style={{ fontSize: "14px", lineHeight: "20px" }}>
                                <span className="text-text-3 tabular-nums" style={{ fontSize: "12px" }}>{String(i + 1).padStart(2, "0")}</span>
                                {s.title}
                            </Link>
                        </li>
                    ))}
                    <li><Link href="#chapter-summary" prefetch={false} className="flex items-center gap-2 min-h-[44px] text-text-2 hover:text-white" style={{ fontSize: "14px" }}><span className="text-text-3" style={{ fontSize: "12px" }}>∑</span>まとめ・練習・クイズ</Link></li>
                </ol>
            </nav>

            <article>
                {chapter.sections.map((s, i) => (
                    <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="py-10 border-t border-line scroll-mt-24" data-testid="learn-section">
                        <p aria-hidden="true" className="m-0 eyebrow text-accent">{chapter.number}.{i + 1}</p>
                        <h2 id={`${s.id}-title`} className="m-0 mt-1.5 font-serif font-bold text-white" style={{ fontSize: "26px", lineHeight: 1.4 }}>{s.title}</h2>
                        <p className="m-0 mt-4 rounded-xl bg-accent-soft px-4 py-3 text-white" style={{ fontSize: "15px", lineHeight: "24px" }} data-testid="learn-point">
                            <span className="text-accent font-semibold">要点　</span>{s.point}
                        </p>
                        {s.blocks.map((b, bi) => <BlockView key={bi} b={b} sectionId={s.id} index={bi} examples={examples} />)}
                        {s.pitfalls && s.pitfalls.length > 0 && (
                            <div className="mt-6">
                                <h3 className="m-0 text-white font-semibold" style={{ fontSize: "14px" }}>よくある失敗</h3>
                                <ul className="m-0 mt-2 pl-5 flex flex-col gap-2 text-text-2 marker:text-text-3" style={{ fontSize: "15px", lineHeight: "26px" }}>
                                    {s.pitfalls.map((p) => <li key={p}>{p}</li>)}
                                </ul>
                            </div>
                        )}
                    </section>
                ))}
            </article>

            <section id="chapter-summary" aria-labelledby="chapter-summary-title" className="py-10 border-t border-line scroll-mt-24">
                <p aria-hidden="true" className="m-0 eyebrow text-accent">SUMMARY</p>
                <h2 id="chapter-summary-title" className="m-0 mt-1.5 font-serif font-bold text-white" style={{ fontSize: "26px", lineHeight: 1.4 }}>この章のまとめ</h2>
                <ul className="m-0 mt-4 pl-5 flex flex-col gap-3 text-chip-text marker:text-accent" style={{ fontSize: "16px", lineHeight: "28px" }}>
                    {chapter.summary.map((s) => <li key={s}>{s}</li>)}
                </ul>

                <h3 className="m-0 mt-10 text-white font-semibold" style={{ fontSize: "18px" }}>外で撮ってみる（練習）</h3>
                <ol className="m-0 mt-3 p-0 list-none flex flex-col gap-3">
                    {chapter.drills.map((d, i) => (
                        <li key={d.title} className="rounded-2xl bg-surface ring-1 ring-line p-4" data-testid="learn-drill">
                            <p className="m-0 text-white font-semibold" style={{ fontSize: "15px", lineHeight: "24px" }}>
                                <span className="text-accent tabular-nums mr-2">練習 {i + 1}</span>{d.title}
                            </p>
                            <p className="m-0 mt-1 text-text-2" style={{ fontSize: "15px", lineHeight: "26px" }}>{d.text}</p>
                        </li>
                    ))}
                </ol>

                <h3 className="m-0 mt-10 text-white font-semibold" style={{ fontSize: "18px" }}>確認クイズ</h3>
                <QuizBlock items={chapter.quiz} />
            </section>

            {chapter.faq && chapter.faq.length > 0 && (
                <section aria-labelledby="chapter-faq" className="py-10 border-t border-line">
                    <h2 id="chapter-faq" className="m-0 font-serif font-bold text-white" style={{ fontSize: "24px", lineHeight: 1.4 }}>よくある質問</h2>
                    <FaqList items={chapter.faq} />
                </section>
            )}

            {(prev || following) && (
                <nav aria-label="前の章・次の章" className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="learn-prevnext">
                    {prev ? (
                        <TrackedLink contentType="article" href={prev.href} prefetch={false} className="rounded-2xl bg-surface ring-1 ring-line hover:ring-line-strong p-4 min-h-[72px] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                            <span className="block text-text-3" style={{ fontSize: "12px" }}>‹ 前</span>
                            <span className="block mt-1 text-white font-semibold" style={{ fontSize: "15px", lineHeight: "22px" }}>{prev.title}</span>
                        </TrackedLink>
                    ) : <span />}
                    {following ? (
                        <TrackedLink contentType="article" href={following.href} prefetch={false} className="rounded-2xl bg-surface ring-1 ring-line hover:ring-line-strong p-4 min-h-[72px] sm:text-right focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                            <span className="block text-text-3" style={{ fontSize: "12px" }}>次 ›</span>
                            <span className="block mt-1 text-white font-semibold" style={{ fontSize: "15px", lineHeight: "22px" }}>{following.title}</span>
                        </TrackedLink>
                    ) : <span />}
                </nav>
            )}

            <aside aria-labelledby="chapter-next" className="mt-6 rounded-2xl bg-accent-soft ring-1 ring-line p-5">
                <h2 id="chapter-next" className="m-0 text-white font-semibold" style={{ fontSize: "15px" }}>次に読む</h2>
                <ul className="m-0 mt-1 p-0 list-none">
                    {chapter.next.map((n) => {
                        const a = LEARN_ARTICLES.find((x) => x.id === n || x.href === n);
                        if (!a) return null;
                        return (
                            <li key={a.id}>
                                <TrackedLink contentType="article" href={a.href} prefetch={false} className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "15px" }}>
                                    {a.title}
                                </TrackedLink>
                            </li>
                        );
                    })}
                    {(chapter.links ?? []).map((l) => (
                        <li key={l.href}>
                            <TrackedLink contentType="article" href={l.href} prefetch={false} className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong" style={{ fontSize: "15px" }}>
                                {l.label}
                            </TrackedLink>
                        </li>
                    ))}
                    <li>
                        <TrackedLink contentType="article" href={ROUTES.LEARN} prefetch={false} className="inline-flex items-center min-h-[44px] text-text-2 underline underline-offset-4 hover:text-white" style={{ fontSize: "15px" }}>
                            教科書の一覧に戻る
                        </TrackedLink>
                    </li>
                </ul>
            </aside>

            {/* 読み終えたところで、アプリのご案内（2026-11-06）。「次に読む」の下＝フッターの札の手前 */}
            <AppInstallCard placement="article" className="mt-6" />
        </>
    );
}
