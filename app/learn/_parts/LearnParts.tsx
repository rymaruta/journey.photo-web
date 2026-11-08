// app/learn/_parts/LearnParts.tsx（サーバーコンポーネント）
//
// **写真とカメラの教科書（/learn）の3頁で共通の部品**（2026-11-04）。
//
// 見た目はデザインの板「黒塗りの真鍮」と `SpotTopicPage` に合わせる: 黒地・h1 は明朝・眉ラベルは真鍮・
// 副文は text-2・札は surface に白8% の縁・本文系の最小 12・押せるもの 44。真鍮は黒地の上だけ
// （写真の上には置かない）。
//
// 実例の写真（`ExampleGrid`）は**ビルド時に選んだ本物の写真**。合う写真が無ければ何も描かない
// （空の枠・「まだありません」を出さない——呼ぶ側で塊ごと消える）。

import React from "react";
import Link from "next/link";
import TrackedLink from "../../components/TrackedLink";
import Thumb from "@/app/components/Thumb";
import type { Photo } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";
import { siteConfig, generateBreadcrumbStructuredData } from "@/lib/utils/seo";
import { photoAltText } from "@/lib/utils/photoAlt";
import { photoTitleFor } from "@/lib/utils/photoTitle";
import { exifSettingsLine } from "@/lib/utils/exifDisplay";
import { cameraOf } from "@/lib/learn/examples";
import { LEARN_TITLE } from "@/lib/data/learn/articles";

/** JSON-LD を `<script>` に埋める形（`</script>` で閉じられないように。`SpotTopicPage` と同じ） */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export function JsonLd({ data }: { data: unknown }) {
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

export type Crumb = { name: string; href: string };

/** 教科書のパンくず（ホーム / 写真とカメラの教科書 / …）。画面と構造化データで同じ段 */
export function learnCrumbs(current?: Crumb): Crumb[] {
    const base: Crumb[] = [{ name: "ホーム", href: ROUTES.HOME }, { name: LEARN_TITLE, href: ROUTES.LEARN }];
    return current ? [...base, current] : base;
}

export function breadcrumbData(crumbs: Crumb[]) {
    return generateBreadcrumbStructuredData(crumbs.map((c) => ({ name: c.name, url: `${siteConfig.url}${c.href === "/" ? "" : c.href}` })));
}

/** 画面のパンくず。最後の段（今いる頁）はリンクにせず `aria-current` */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
    return (
        <nav aria-label="パンくずリスト" className="mb-3 text-text-2" style={{ fontSize: "12px", lineHeight: "18px" }}>
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

/** 頁の頭（眉・明朝の h1・導入文） */
export function LearnHeader({ eyebrow, title, lead, testId }: { eyebrow: string; title: string; lead: string; testId?: string }) {
    return (
        <header className="mb-8" data-testid={testId}>
            <p className="m-0 mb-2 eyebrow text-accent">{eyebrow}</p>
            <h1 className="m-0 font-serif font-bold text-white wrap-anywhere" style={{ fontSize: "clamp(30px, 5vw, 44px)", lineHeight: 1.3 }}>
                {title}
            </h1>
            <p className="m-0 mt-4 text-text-2 max-w-3xl" style={{ fontSize: "16px", lineHeight: "28px" }}>{lead}</p>
        </header>
    );
}

/** 実例の1枚（サムネ・題・撮影設定・機種）。押すと写真の頁へ */
export function PhotoExampleCard({ photo, sizes }: { photo: Photo; sizes: string }) {
    const title = photoTitleFor(photo, "ja").text;
    const settings = exifSettingsLine(photo.exif);
    const camera = cameraOf(photo);
    return (
        <TrackedLink
            contentType="photo"
            href={ROUTES.PHOTO(photo.id)}
            prefetch={false}
            className="group block rounded-xl overflow-hidden bg-surface ring-1 ring-line hover:ring-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ touchAction: "manipulation" }}
            data-testid="learn-example"
        >
            <span className="block relative bg-surface-4" style={{ aspectRatio: "4 / 3" }}>
                <Thumb photo={photo} alt={photoAltText(photo, "ja")} sizes={sizes} cellAspect={4 / 3} />
            </span>
            <span className="block p-3">
                <span className="block text-white font-medium truncate" style={{ fontSize: "14px", lineHeight: "20px" }}>{title}</span>
                {settings && (
                    <span className="block mt-1 text-text-2 tabular-nums" style={{ fontSize: "12px", lineHeight: "18px" }} data-testid="learn-example-settings">
                        {settings}
                    </span>
                )}
                {camera && <span className="block text-text-3 truncate" style={{ fontSize: "12px", lineHeight: "18px" }}>{camera}</span>}
            </span>
        </TrackedLink>
    );
}

/** 実例の塊（見出し＋最大4枚）。**写真が無ければ何も描かない** */
export function ExampleGrid({ id, heading, photos }: { id: string; heading: string; photos: Photo[] }) {
    if (photos.length === 0) return null;
    return (
        <section aria-labelledby={id} className="mt-6" data-testid="learn-example-group">
            <h3 id={id} className="m-0 mb-3 text-white font-semibold" style={{ fontSize: "14px", lineHeight: "20px" }}>
                このサイトの実例：{heading}
            </h3>
            <ul className="m-0 p-0 list-none grid grid-cols-2 sm:grid-cols-4 gap-3">
                {photos.map((p) => (
                    <li key={p.id}>
                        <PhotoExampleCard photo={p} sizes="(min-width: 640px) 200px, 45vw" />
                    </li>
                ))}
            </ul>
        </section>
    );
}

/**
 * **目安の表**。パソコン幅（md・768px 以上）は表、**スマホ幅は行ごとの札**（最初の列を見出しに、
 * 残りを「ラベル＋値」で縦に並べる）。
 *
 * 2026-11-04 判断（確かめ役の指摘・幅 390 の画面写真）: 4列の早見表が 388px と枠（358px）より広く、
 * 「向く人」の列が 68px に潰れていた。横スクロールの表はスマホで読みにくいので、形を変える。
 * 2つの形は `display: none` で片方だけ出す（読み上げも片方だけ）。
 */
export function LearnTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
    return (
        <div className="mt-5" data-testid="learn-table">
            {/* スマホ幅: 行ごとの札 */}
            <div className="md:hidden" data-testid="learn-table-cards">
                <p className="m-0 mb-2 text-text-2" style={{ fontSize: "12px", lineHeight: "18px" }}>{caption}</p>
                <ul className="m-0 p-0 list-none flex flex-col gap-2" aria-label={caption}>
                    {rows.map((r) => (
                        <li key={r.join("|")} className="rounded-xl bg-surface ring-1 ring-line px-4 py-3">
                            <p className="m-0 text-white font-semibold" style={{ fontSize: "15px", lineHeight: "22px" }}>{r[0]}</p>
                            <dl className="m-0 mt-2 flex flex-col gap-2">
                                {r.slice(1).map((cell, i) => (
                                    <div key={head[i + 1] ?? i}>
                                        <dt className="text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>{head[i + 1]}</dt>
                                        <dd className="m-0 text-chip-text" style={{ fontSize: "14px", lineHeight: "22px" }}>{cell}</dd>
                                    </div>
                                ))}
                            </dl>
                        </li>
                    ))}
                </ul>
            </div>
            {/* パソコン幅: 表 */}
            <div className="hidden md:block rounded-xl ring-1 ring-line overflow-hidden" data-testid="learn-table-grid">
                <table className="w-full border-collapse text-left" style={{ fontSize: "14px", lineHeight: "22px" }}>
                    <caption className="text-left px-4 pt-3 pb-2 text-text-2" style={{ fontSize: "12px", lineHeight: "18px", captionSide: "top" }}>{caption}</caption>
                    <thead>
                        <tr className="bg-surface">
                            {head.map((h) => (
                                <th key={h} scope="col" className="px-4 py-2.5 font-semibold text-text-2 whitespace-nowrap border-b border-line" style={{ fontSize: "12px" }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.join("|")} className="border-b border-line last:border-b-0">
                                {r.map((cell, i) => i === 0
                                    ? <th key={i} scope="row" className="px-4 py-3 font-medium text-white align-top">{cell}</th>
                                    : <td key={i} className="px-4 py-3 text-text-2 align-top">{cell}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** よくある質問（開閉は `<details>`。JS 無しで動く） */
export function FaqList({ items }: { items: { q: string; a: string }[] }) {
    return (
        <div className="mt-4 flex flex-col gap-3">
            {items.map((f) => (
                <details key={f.q} className="group rounded-xl bg-surface ring-1 ring-line">
                    <summary className="flex items-center justify-between gap-3 min-h-[52px] px-4 py-3 cursor-pointer list-none text-white font-medium" style={{ fontSize: "15px", lineHeight: "22px" }}>
                        <span>{f.q}</span>
                        <span aria-hidden="true" className="text-text-3 transition-transform group-open:rotate-45 motion-reduce:transition-none" style={{ fontSize: "18px" }}>＋</span>
                    </summary>
                    <p className="m-0 px-4 pb-4 text-text-2" style={{ fontSize: "15px", lineHeight: "26px" }}>{f.a}</p>
                </details>
            ))}
        </div>
    );
}

/** 外へ出るリンク（真鍮・↗・新しいタブで開くことを読み上げる） */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong"
            style={{ fontSize: "14px" }}
        >
            {children}
            <span aria-hidden="true">↗</span>
            <span className="sr-only">（新しいタブで開きます）</span>
        </a>
    );
}
