import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { seasonThemeTopics, seasonThemeView, topicMetadata } from "@/lib/data/spotTopics";
import { EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";

// 静的エクスポート: 列挙した組のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **季節 × カテゴリの撮影スポット一覧**（`/spots/season/<季節>/theme/<カテゴリ>`・2026-11-05）。
 * 「秋の寺社の撮影スポット」のような検索語の着地点。季節の案内を持つ行のうち、
 * そのカテゴリが **`MIN_TOPIC_SPOTS` 件以上**の組だけ作る。
 * 地方別の頁（`/spots/season/<季節>/<地方>`）とは `theme` の1段で分かれる（地方の綴りに `theme` は無い）
 */
export function generateStaticParams() {
    const params = seasonThemeTopics().map((t) => ({ season: t.season as string, category: t.categorySlug }));
    return params.length > 0 ? params : [{ season: EMPTY_PARAM_PLACEHOLDER, category: EMPTY_PARAM_PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ season: string; category: string }> }): Promise<Metadata> {
    const { season, category } = await params;
    return topicMetadata(seasonThemeView(season, category));
}

export default async function SpotSeasonThemePage({ params }: { params: Promise<{ season: string; category: string }> }) {
    const { season, category } = await params;
    const view = seasonThemeView(season, category);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow="Photo spots · Season & Theme" />;
}
