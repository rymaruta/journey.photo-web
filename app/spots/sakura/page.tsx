import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { featureView, FEATURES, topicMetadata } from "@/lib/data/spotTopics";

/**
 * **桜（春）の撮影スポットのまとめ**（`/spots/sakura`・2026-11-07）。春の案内に「桜」の記述がある日本のスポット。
 * 地方別・県別の頁（`/spots/sakura/<place>`）への入口。台帳に1件も無ければ頁は作らない（404）。
 */
export function generateMetadata(): Metadata {
    return topicMetadata(featureView("sakura", null));
}

export default function SpotSakuraPage() {
    const view = featureView("sakura", null);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow={FEATURES.sakura.eyebrow} />;
}
