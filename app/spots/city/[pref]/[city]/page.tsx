import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SpotTopicPage from "@/app/components/SpotTopicPage";
import { cityTopics, cityView, topicMetadata } from "@/lib/data/spotTopics";
import { EMPTY_PARAM_PLACEHOLDER } from "@/lib/server/staticParams";

/** 日本語の綴りは、ブラウザ経由だと %エンコードのまま届くことがある（`SpotPage` の `decodeURIComponent` と同じ判断） */
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

// 静的エクスポート: 列挙した組のみ生成し、それ以外は 404
export const dynamicParams = false;

/**
 * **市区町村の撮影スポット一覧**（`/spots/city/<県の綴り>/<市区町村名>`・2026-11-05）。
 * 「鎌倉市 撮影スポット」のような検索語の着地点。**`MIN_TOPIC_SPOTS` 件以上の市区町村だけ**作る
 * （薄い頁を量産しない・`lib/data/spotTopics.ts`）。
 *
 * ⚠️ `/spots/city` は `/spots/<slug>` と同じ親の下。`city` という slug のスポットは台帳に入れられない
 * （見張りは `spotsLedger.test.ts` の予約スラッグの項）。
 */
export function generateStaticParams() {
    const params = cityTopics().map((t) => ({ pref: t.prefSlug, city: t.city }));
    return params.length > 0 ? params : [{ pref: EMPTY_PARAM_PLACEHOLDER, city: EMPTY_PARAM_PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ pref: string; city: string }> }): Promise<Metadata> {
    const { pref, city } = await params;
    return topicMetadata(cityView(pref, safeDecode(city)));
}

export default async function SpotCityPage({ params }: { params: Promise<{ pref: string; city: string }> }) {
    const { pref, city } = await params;
    const view = cityView(pref, safeDecode(city));
    if (!view) notFound();
    return <SpotTopicPage view={view} eyebrow="Photo spots · City" />;
}
