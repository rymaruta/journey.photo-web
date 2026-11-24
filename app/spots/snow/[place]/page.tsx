import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { featureTopics, featureView, FEATURES, topicMetadata } from "@/lib/data/spotTopics";
import { EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";

// 静的エクスポート: 列挙した組のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **地方別・県別の雪景色の撮影スポット**（`/spots/snow/<地方か県の綴り>`・2026-11-07）。
 * `MIN_TOPIC_SPOTS` 件以上の地方・県だけ（薄い頁を作らない・`lib/data/spotTopics.ts`）。
 */
export function generateStaticParams() {
    const params = featureTopics("snow").filter((t) => t.place).map((t) => ({ place: t.place!.slug }));
    return params.length > 0 ? params : [{ place: EMPTY_PARAM_PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ place: string }> }): Promise<Metadata> {
    const { place } = await params;
    return topicMetadata(featureView("snow", place));
}

export default async function SpotSnowPlacePage({ params }: { params: Promise<{ place: string }> }) {
    const { place } = await params;
    const view = featureView("snow", place);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow={FEATURES.snow.eyebrow} />;
}
