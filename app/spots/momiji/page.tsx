import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { momijiView, topicMetadata } from "@/lib/data/spotTopics";

/**
 * **紅葉の撮影スポットのまとめ**（`/spots/momiji`・2026-11-06）。秋の案内に「紅葉」の記述がある日本のスポット。
 * 地方別・県別の頁（`/spots/momiji/<place>`）への入口。台帳に1件も無ければ頁は作らない（404）。
 */
export function generateMetadata(): Metadata {
    return topicMetadata(momijiView(null));
}

export default function SpotMomijiPage() {
    const view = momijiView(null);
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow="Photo spots · Autumn foliage" />;
}
