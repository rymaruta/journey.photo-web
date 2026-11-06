import type { Metadata } from "next";
import { SPOTS } from "@/lib/data/spots";
import { publishableSpots } from "@/lib/utils/spotGuide";
import { siteConfig } from "@/lib/utils/seo";
import SpotCompareClient from "./SpotCompareClient";

export const metadata: Metadata = {
  title: "撮影スポット比較",
  description: "確認済みの撮影スポットを2〜3件並べて、場所・季節・撮影時間帯・アクセス情報を比較できます。",
  alternates: { canonical: `${siteConfig.url}/spots/compare` },
  robots: { index: false, follow: true },
};

export default function SpotComparePage() {
  // 未確認の下書きを比較対象に含めない。必要な項目だけクライアントへ渡す。
  const spots = publishableSpots(SPOTS).map((spot) => ({
    id: spot.spotId,
    slug: spot.slug,
    name: spot.name,
    region: [spot.region?.prefecture, spot.region?.city, spot.region?.country].filter(Boolean).join(" / "),
    category: spot.category ?? "",
    summary: spot.summary ?? "",
    seasons: (spot.seasonalGuide ?? []).map((x) => ({ season: x.season, text: x.text })),
    times: (spot.timeOfDayGuide ?? []).map((x) => ({ time: x.time, text: x.text })),
    access: [spot.access?.transit, spot.access?.car, spot.access?.walk].filter(Boolean).join(" / "),
  }));
  return <SpotCompareClient spots={spots} />;
}
