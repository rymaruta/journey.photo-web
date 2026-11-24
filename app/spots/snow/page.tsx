import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { featureView, FEATURES, topicMetadata } from "@/lib/data/spotTopics";

/**
 * **雪景色（冬）の撮影スポットのまとめ**（`/spots/snow`・2026-11-07）。冬の案内に「雪」の記述がある日本のスポット。
 * 地方別・県別の頁（`/spots/snow/<place>`）への入口。台帳に1件も無ければ頁は作らない（404）。
 */
export function generateMetadata(): Metadata {
    return topicMetadata(featureView("snow", null));
}

export default function SpotSnowPage() {
    const view = featureView("snow", null);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow={FEATURES.snow.eyebrow} />;
}
