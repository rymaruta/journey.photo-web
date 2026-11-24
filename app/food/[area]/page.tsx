import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withPlaceholderParam } from "@/lib/server/staticParams";
import { appItunes, siteConfig, pageRobots, shareOgImage, generateBreadcrumbStructuredData } from "@/lib/utils/seo";
import { ROUTES } from "@/lib/routes";
import SectionHead from "@/app/components/SectionHead";
import {
    foodAreas, foodArea, foodPrefecture, foodSpotLinks, foodTitle, foodDescription, foodHeading, isFoodIndexable,
    type FoodArea, type FoodItem,
} from "@/lib/data/localFood";

// 静的エクスポート: 公開済みの県だけを書き出し、それ以外は 404
export const dynamicParams = false;

/**
 * **県ごとの郷土料理とお土産**（2026-11-23・案 B の試作。まず 5 県）。
 * データと決まり（お店を載せない・文は自前の要約・写真を使わない・伝承地域の撮影スポットだけ結ぶ）は
 * `lib/data/localFood.ts` の冒頭。
 */
export function generateStaticParams() {
    // 0件だと `output: export` がビルドを落とすので、1件は返す
    return withPlaceholderParam(foodAreas().map((a) => ({ area: a.area })), "area");
}

/** JSON-LD を `<script>` に埋める形（`SpotTopicPage.tsx` と同じ。`</script>` で閉じられないように） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

function view(slug: string): { a: FoodArea; name: string; nameEn: string } | null {
    const a = foodArea(slug);
    const p = a ? foodPrefecture(a) : null;
    return a && p ? { a, name: p.name, nameEn: p.nameEn } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
    const { area } = await params;
    const v = view(area);
    if (!v) return { robots: { index: false, follow: true } };
    const title = foodTitle(v.name, v.a);
    const description = foodDescription(v.name, v.a);
    const url = `${siteConfig.url}${ROUTES.FOOD(v.a.area)}`;
    return {
        // サイト名の template を外した完全な形（撮影スポット・テーマの頁と同じ）
        title: { absolute: title },
        description,
        alternates: { canonical: url },
        itunes: appItunes(url),
        robots: pageRobots(isFoodIndexable(v.a)),
        openGraph: {
            type: "website", url, siteName: siteConfig.name,
            locale: siteConfig.locale.ja, title, description,
            // 料理の写真は使わない（権利）。サイトの固定の代表画像
            images: [shareOgImage()],
        },
    };
}

function ItemCard({ item, kind }: { item: FoodItem; kind: "dish" | "souvenir" }) {
    const spots = foodSpotLinks(item);
    return (
        <li id={item.id} className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-2 min-w-0" data-testid={`food-${kind}`}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="m-0 font-serif font-bold text-white" style={{ fontSize: "19px", lineHeight: "1.35" }}>{item.name}</h3>
                <span className="text-text-2" style={{ fontSize: "13px" }}>{item.where}</span>
            </div>
            <p className="m-0 text-white/85" style={{ fontSize: "15px", lineHeight: "24px" }}>{item.summary}</p>
            {item.season && (
                <p className="m-0 text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>
                    <span className="text-white/60">時季 </span>{item.season}
                </p>
            )}
            {spots.length > 0 && (
                <p className="m-0" style={{ fontSize: "14px", lineHeight: "22px" }} data-testid="food-spots">
                    <span className="text-white/60">伝承地域の観光スポット </span>
                    {spots.map((s, i) => (
                        <React.Fragment key={s.slug}>
                            {i > 0 && <span className="text-white/60">、</span>}
                            <Link href={`/spots/${s.slug}`} prefetch={false}
                                  className="text-accent underline underline-offset-4 hover:text-accent-strong">{s.name}</Link>
                        </React.Fragment>
                    ))}
                </p>
            )}
            <p className="m-0 text-white/50" style={{ fontSize: "12px", lineHeight: "18px" }}>
                出典: <a href={item.source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white/80">{item.source.title}</a>
            </p>
        </li>
    );
}

export default async function FoodAreaPage({ params }: { params: Promise<{ area: string }> }) {
    const { area } = await params;
    const v = view(area);
    if (!v) notFound();
    const { a, name } = v;
    const abs = (p: string) => `${siteConfig.url}${p}`;
    const breadcrumb = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: "観光スポット", url: abs(ROUTES.SPOTS) },
        { name, url: abs(ROUTES.SPOT_AREA(a.area)) },
        { name: foodHeading(name, a), url: abs(ROUTES.FOOD(a.area)) },
    ]);
    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumb) }} />
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl" data-testid="food-page">
                <nav aria-label="パンくずリスト" className="mb-2 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>
                    <Link href="/" prefetch={false} className="hover:text-white/90">ホーム</Link>
                    <span className="mx-1.5" aria-hidden>/</span>
                    <Link href={ROUTES.SPOTS} prefetch={false} className="hover:text-white/90">観光スポット</Link>
                    <span className="mx-1.5" aria-hidden>/</span>
                    <Link href={ROUTES.SPOT_AREA(a.area)} prefetch={false} className="hover:text-white/90">{name}</Link>
                </nav>
                <p aria-hidden className="m-0 mb-1.5 eyebrow text-accent">Local food · {v.nameEn}</p>
                <h1 className="font-serif text-4xl font-bold m-0 wrap-anywhere" data-testid="food-title">{foodHeading(name, a)}</h1>
                <p className="m-0 mt-2 mb-2 text-text-2 max-w-3xl" style={{ fontSize: "15px", lineHeight: "24px" }}>{a.intro}</p>
                <p className="m-0 mb-6 text-white/60" style={{ fontSize: "13px" }}>
                    郷土料理 {a.dishes.length}{a.souvenirs.length > 0 && `　お土産 ${a.souvenirs.length}`}
                </p>

                <section className="mb-8" aria-labelledby="food-dishes">
                    <SectionHead id="food-dishes" title="郷土料理" />
                    <ul className="grid gap-3 sm:grid-cols-2 m-0 p-0" style={{ listStyle: "none" }}>
                        {a.dishes.map((d) => <ItemCard key={d.id} item={d} kind="dish" />)}
                    </ul>
                </section>

                {a.souvenirs.length > 0 && (
                    <section className="mb-8" aria-labelledby="food-souvenirs">
                        <SectionHead id="food-souvenirs" title="お土産" />
                        <ul className="grid gap-3 sm:grid-cols-2 m-0 p-0" style={{ listStyle: "none" }}>
                            {a.souvenirs.map((d) => <ItemCard key={d.id} item={d} kind="souvenir" />)}
                        </ul>
                    </section>
                )}

                <p className="m-0 mb-6">
                    <Link href={ROUTES.SPOT_AREA(a.area)} prefetch={false} data-testid="food-area-link"
                          className="inline-flex items-center min-h-[44px] text-accent underline underline-offset-4 hover:text-accent-strong"
                          style={{ fontSize: "15px" }}>
                        {name}の観光スポットを見る
                    </Link>
                </p>

                <footer className="border-t border-line pt-4 text-white/55 max-w-3xl" style={{ fontSize: "12px", lineHeight: "20px" }} data-testid="food-credit">
                    <p className="m-0">
                        出典: 農林水産省「うちの郷土料理」（各品目の出典のリンク先）。journey.photo が内容を要約・編集して作成しました。
                        農林水産省が作成したものではありません。
                    </p>
                    {a.aiCheck && (
                        <p className="m-0 mt-1">
                            {a.aiCheck.method}（{a.aiCheck.checkedAt}）。お店の情報は載せていません。
                        </p>
                    )}
                </footer>
            </main>
        </>
    );
}
