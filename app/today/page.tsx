// app/today/page.tsx（サーバーコンポーネント）
//
// **今日の日の出・日の入り時刻（ハブ）**（2026-11-07）。「現在地で調べる」ボタンと、県ごとの頁（/today/<県>）への入口。
// 費用を増やさない: 外部 API もサーバーも使わず、座標と日付から端末の中で計算する（`lib/utils/sunTimes.ts`）。
//
// 位置情報はボタンを押したときだけ、ブラウザの中で使う（`TodayHub.tsx`）。頁の中に書いてある約束と、
// 実際の動きが食い違わないよう `app/today/__tests__/` が見張る。

import React from "react";
import { ROUTES } from "@/lib/routes";
import { siteConfig, generateItemListStructuredData } from "@/lib/utils/seo";
import { learnMetadata } from "@/lib/learn/seo";
import { PREFECTURES } from "@/lib/data/prefectures";
import { shortPrefName, TODAY_HUB_TITLE } from "@/lib/data/todayPlaces";
import { Breadcrumbs, JsonLd, LearnHeader, breadcrumbData } from "@/app/learn/_parts/LearnParts";
import TodayHub from "./TodayHub";
import PrefChips from "./PrefChips";

const DESCRIPTION = "現在地または都道府県を選ぶと、今日の日の出、日の入り時刻、朝夕のゴールデンアワーとブルーアワー、近くの観光スポットがわかります。座標と日付から計算した目安で、開いた日の値を表示します。";

// 題はサイト名を足さない（ルートの `title.template` が足す。`pageTitles.test.ts` の決まり）
export const metadata = learnMetadata(ROUTES.TODAY, TODAY_HUB_TITLE, DESCRIPTION, "website");

export default function TodayHubPage() {
    const crumbs = [{ name: "ホーム", href: ROUTES.HOME }, { name: "今日の日の出・日の入り", href: ROUTES.TODAY }];
    const prefList = generateItemListStructuredData(
        "都道府県ごとの今日の日の出・日の入り時刻",
        PREFECTURES.map((p) => ({ name: `${shortPrefName(p)}の今日の日の出・日の入り時刻`, url: `${siteConfig.url}${ROUTES.TODAY_PREF(p.slug)}` })),
    );
    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            <JsonLd data={prefList} />
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-5xl" data-testid="today-index">
                <Breadcrumbs crumbs={crumbs} />
                <LearnHeader
                    eyebrow="TODAY · 日の出・日の入り"
                    title="今日の日の出・日の入り時刻"
                    lead="日の出、日の入りの時刻と方位、朝夕のゴールデンアワーとブルーアワー、近くの観光スポットを、今日の日付で調べられます。現在地で調べるか、県を選んでください。"
                />

                <section aria-labelledby="today-here-heading" className="mb-10">
                    <h2 id="today-here-heading" className="m-0 mb-3 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.3" }}>現在地で調べる</h2>
                    <TodayHub />
                </section>

                <section aria-labelledby="today-pref-heading" className="mb-10">
                    <h2 id="today-pref-heading" className="m-0 mb-1 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.3" }}>県を選んで調べる</h2>
                    <p className="m-0 mb-4 max-w-2xl text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>
                        県庁所在地の市付近の座標で計算した、今日の値と月ごとの時刻表です。
                    </p>
                    <PrefChips />
                </section>

                <section aria-labelledby="today-about-heading">
                    <h2 id="today-about-heading" className="m-0 mb-2 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.3" }}>この頁の値について</h2>
                    <p className="m-0 max-w-3xl text-text-2" style={{ fontSize: "15px", lineHeight: "26px" }}>
                        値は座標と日付から端末の中で計算した目安で、国立天文台などの公式の暦ではありません。天気や山・建物の影は含みません。
                        時刻は日本時間（Asia/Tokyo）です。計算の方法と誤差は、各県の頁に書いてあります。
                    </p>
                </section>
            </main>
        </>
    );
}
