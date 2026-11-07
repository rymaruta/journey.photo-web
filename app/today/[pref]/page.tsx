// app/today/[pref]/page.tsx（サーバーコンポーネント）
//
// **県ごとの「今日の日の出・日の入り時刻」**（2026-11-07・47頁）。県庁所在地の市付近の座標で計算する。
//
// 書き出す（ビルド時）もの: 月ごとの表・近くの撮影スポット・説明。検索の入口で、JavaScript が無くても読める。
// 書き出さないもの: **今日の値**。ブラウザの今日の日付でクライアントが計算する（`TodayLightPanel.tsx`）。
// 静的 HTML に日の値を焼くと、週1回の再ビルドの間、昨日の値を今日として見せてしまう。
//
// 座標の出どころは `lib/data/todayPlaces.ts`（県庁所在地の市のスポットの座標の平均。無ければ県内の重心）。

import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import { siteConfig, generateItemListStructuredData } from "@/lib/utils/seo";
import { learnMetadata } from "@/lib/learn/seo";
import { PREFECTURES } from "@/lib/data/prefectures";
import { todayPlace, todayPrefTitle, nearbyForPlace, NEARBY_RADIUS_KM, NEARBY_LIMIT, type TodayPlace } from "@/lib/data/todayPlaces";
import { lightCalendar, lightCellText } from "@/lib/utils/lightCalendar";
import { TODAY_TIME_ZONE, monthlyDayLengths } from "@/lib/utils/todayLight";
import { direction } from "@/lib/utils/spotLight";
import { distanceLabel } from "@/lib/utils/journey";
import { withPlaceholderParam } from "@/lib/server/staticParams";
import { Breadcrumbs, JsonLd, LearnHeader, breadcrumbData } from "@/app/learn/_parts/LearnParts";
import TodayLightPanel from "../TodayLightPanel";
import PrefChips from "../PrefChips";

// 静的エクスポート: 列挙した県のみ生成し、それ以外は 404
export const dynamicParams = false;

export function generateStaticParams() {
    return withPlaceholderParam(PREFECTURES.map((p) => ({ pref: p.slug })), "pref");
}

function todayPrefDescription(place: TodayPlace): string {
    return `${place.shortName}（${place.capital}付近）の今日の日の出・日の入り時刻、朝夕のゴールデンアワーとブルーアワー、月ごとの時刻表、近くの撮影スポット。座標と日付から計算した目安で、開いた日の値を表示します。`;
}

export async function generateMetadata({ params }: { params: Promise<{ pref: string }> }): Promise<Metadata> {
    const { pref } = await params;
    const place = todayPlace(pref);
    if (!place) return {};
    return learnMetadata(ROUTES.TODAY_PREF(pref), todayPrefTitle(place), todayPrefDescription(place), "website");
}

const H2 = "m-0 mb-3 font-serif font-bold text-white";
const H2_STYLE = { fontSize: "22px", lineHeight: "1.3" } as const;
const BODY = { fontSize: "15px", lineHeight: "26px" } as const;

export default async function TodayPrefPage({ params }: { params: Promise<{ pref: string }> }) {
    const { pref } = await params;
    const place = todayPlace(pref);
    if (!place) notFound();

    const calendar = lightCalendar(place.coords, "日本");
    const lengths = monthlyDayLengths(place.coords);
    const near = nearbyForPlace(place);

    const crumbs = [
        { name: "ホーム", href: ROUTES.HOME },
        { name: "今日の日の出・日の入り", href: ROUTES.TODAY },
        { name: place.shortName, href: ROUTES.TODAY_PREF(pref) },
    ];
    const itemList = near.items.length > 0
        ? generateItemListStructuredData(`${place.shortName}の近くの撮影スポット`, near.items.map((i) => ({ name: i.name, url: `${siteConfig.url}/spots/${i.slug}` })))
        : null;

    const basisNote = place.basis === "capital-spots"
        ? `計算に使う座標は、このサイトに載せている${place.capital}の撮影スポット${place.sampleCount}件の座標の平均です。`
        : `${place.capital}に載せている撮影スポットが無いため、${place.pref.name}内の撮影スポット${place.sampleCount}件の座標の平均（県の中ほど）で計算しています。県庁所在地からは離れていることがあります。`;

    return (
        <>
            <JsonLd data={breadcrumbData(crumbs)} />
            {itemList && <JsonLd data={itemList} />}
            <main className="min-h-screen bg-bg text-white px-4 sm:px-6 md:px-8 pt-6 pb-24 mx-auto w-full max-w-5xl" data-testid="today-pref" data-pref={pref}>
                <Breadcrumbs crumbs={crumbs} />
                <LearnHeader
                    eyebrow="TODAY · 日の出・日の入り"
                    title={`${place.shortName}の今日の日の出・日の入り時刻`}
                    lead={`${place.pref.name}（${place.capital}付近）の今日の日の出・日の入りの時刻と方位、朝夕のゴールデンアワー・ブルーアワー、月ごとの時刻表、近くの撮影スポットをまとめました。`}
                />

                <section aria-labelledby="today-now-heading" className="mb-10" data-testid="today-now">
                    <h2 id="today-now-heading" className={H2} style={H2_STYLE}>今日の光</h2>
                    <TodayLightPanel coords={place.coords} />
                </section>

                {calendar && (
                    <section aria-labelledby="today-months-heading" className="mb-10" data-testid="today-months">
                        <h2 id="today-months-heading" className={H2} style={H2_STYLE}>{place.shortName}の月ごとの日の出・日の入り</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left" style={{ fontSize: "13px", lineHeight: "18px" }}>
                                <caption className="sr-only">{place.shortName}の各月15日の日の出・日の入り（時刻と方位）、昼の長さ、夕方のゴールデンアワー</caption>
                                <thead>
                                    <tr className="text-text-2 border-b border-line align-bottom" style={{ fontSize: "12px" }}>
                                        <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">月</th>
                                        <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">日の出</th>
                                        <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">日の入り</th>
                                        <th scope="col" className="py-2 pr-3 font-normal whitespace-nowrap">昼の長さ</th>
                                        <th scope="col" className="py-2 font-normal whitespace-nowrap">夕方のゴールデンアワー</th>
                                    </tr>
                                </thead>
                                <tbody className="font-sans tabular-nums text-white/85">
                                    {calendar.rows.map((r) => (
                                        <tr key={r.month} className="border-b border-line/60" data-testid="today-month-row">
                                            <th scope="row" className="py-2 pr-3 font-normal font-sans text-text-2 whitespace-nowrap">{r.month}月</th>
                                            <td className="py-2 pr-3 whitespace-nowrap">
                                                {lightCellText(r.sunrise, true)}
                                                <span className="block text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }}>{direction(r.sunriseAzimuth, true)}</span>
                                            </td>
                                            <td className="py-2 pr-3 whitespace-nowrap">
                                                {lightCellText(r.sunset, true)}
                                                <span className="block text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }}>{direction(r.sunsetAzimuth, true)}</span>
                                            </td>
                                            <td className="py-2 pr-3 whitespace-nowrap">{lengths[r.month - 1].dayLength ?? "—"}</td>
                                            <td className="py-2 whitespace-nowrap">{lightCellText(r.eveningGolden, true)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="m-0 mt-2 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                            各月15日の計算値（日本時間）。方位は北から時計回り。天気や山・建物の影は含みません。
                        </p>
                    </section>
                )}

                <section aria-labelledby="today-nearby-heading" className="mb-10" data-testid="today-nearby-section">
                    <h2 id="today-nearby-heading" className={H2} style={H2_STYLE}>{place.shortName}の近くの撮影スポット</h2>
                    <p className="m-0 mb-3 max-w-3xl text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>
                        {near.filledFromPrefecture
                            ? `${place.capital}付近から${NEARBY_RADIUS_KM}km 以内のスポットは${near.withinRadius}件でした。足りないぶんは、${place.pref.name}内のスポットを近い順に加えています（最大${NEARBY_LIMIT}件）。`
                            : `${place.capital}付近から${NEARBY_RADIUS_KM}km 以内のスポットを、近い順に最大${NEARBY_LIMIT}件並べています（直線距離）。`}
                    </p>
                    {near.items.length > 0 ? (
                        <ul className="m-0 p-0 list-none divide-y divide-line/60 rounded-2xl bg-surface ring-1 ring-line">
                            {near.items.map((s) => (
                                <li key={s.slug}>
                                    <Link href={`/spots/${s.slug}`} prefetch={false}
                                          className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2 text-white hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                                          style={{ fontSize: "15px", lineHeight: "22px" }}>
                                        <span className="min-w-0">
                                            <span className="block wrap-anywhere">{s.name}</span>
                                            <span className="block text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }}>
                                                {[s.kind, s.prefName !== place.pref.name ? s.prefName : ""].filter(Boolean).join("・")}
                                            </span>
                                        </span>
                                        <span className="flex-shrink-0 font-sans tabular-nums text-text-2" style={{ fontSize: "13px" }}>{distanceLabel(s.km, true)}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="m-0 text-text-2" style={BODY}>近くに載せている撮影スポットはまだありません。</p>
                    )}
                    <p className="m-0 mt-3">
                        <Link href={ROUTES.SPOT_AREA(pref)} prefetch={false} className="inline-flex min-h-[44px] items-center text-text-2 hover:text-white" style={{ fontSize: "13px" }}>
                            {place.pref.name}の撮影スポットをすべて見る<span aria-hidden="true" className="ml-1">›</span>
                        </Link>
                    </p>
                </section>

                <section aria-labelledby="today-about-heading" className="mb-10" data-testid="today-about">
                    <h2 id="today-about-heading" className={H2} style={H2_STYLE}>ゴールデンアワーとブルーアワー</h2>
                    <p className="m-0 mb-3 max-w-3xl text-text-2" style={BODY}>
                        このサイトでは、太陽の高さ（高度）で時間帯を決めています。日の出・日の入りは、太陽の上端が地平線にかかる時刻（高度 −0.833°）です。
                    </p>
                    <ul className="m-0 mb-3 max-w-3xl pl-5 text-text-2" style={BODY}>
                        <li><strong className="font-semibold text-white">ゴールデンアワー</strong>: 太陽の高度が +6° から −4° の間。朝は日の出をはさんで −4° から +6° へ、夕方は +6° から −4° へ。低い太陽の光が横から差し、影が長く、色が暖かくなります。</li>
                        <li><strong className="font-semibold text-white">ブルーアワー</strong>: 高度が −4° から −6° の間。日の出前と日の入り後の短い時間で、空が青く沈みます。</li>
                    </ul>
                    <p className="m-0 max-w-3xl text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                        ゴールデンアワーの角度には決まった定義がなく、ほかのサイトやアプリと数分違うことがあります。
                    </p>
                </section>

                <section aria-labelledby="today-method-heading" className="mb-10" data-testid="today-method">
                    <h2 id="today-method-heading" className={H2} style={H2_STYLE}>計算の方法と誤差</h2>
                    <p className="m-0 mb-3 max-w-3xl text-text-2" style={BODY}>
                        日の出・日の入りは、座標と日付から「日の出の方程式」（NOAA の簡略式）で計算しています。誤差はおおむね1〜2分で、
                        東京の国立天文台の暦の値と1分以内で合うことを試験で確かめています。方位も同じ式で出し、暦の値と 0.5° 以内で合うことを試験で確かめています。
                        これは目安で、国立天文台などの公式の暦ではありません。
                    </p>
                    <p className="m-0 mb-3 max-w-3xl text-text-2" style={BODY}>
                        {basisNote}
                        スポットの座標は約1km に丸めてあり、平均した点から使ったスポットのいちばん遠い点までは約{place.spreadKm}km あるため、県庁や市役所の位置とは数 km ずれることがあります。
                        経度が 0.1° ずれると日の出・日の入りは約0.4分動くので、時刻への影響は小さい範囲です。
                    </p>
                    <p className="m-0 max-w-3xl text-text-2" style={BODY}>
                        海抜や、山・建物で隠れる地平線、天気（雲・霧）、大気の状態による見え方の違いは含みません。時刻は日本時間（{TODAY_TIME_ZONE}）です。
                        今日の値は、頁を開いたブラウザの今日の日付で計算しています。
                    </p>
                </section>

                <section aria-labelledby="today-others-heading">
                    <h2 id="today-others-heading" className={H2} style={H2_STYLE}>ほかの県の日の出・日の入り</h2>
                    <PrefChips currentSlug={pref} />
                    <p className="m-0 mt-2">
                        <Link href={ROUTES.TODAY} prefetch={false} className="inline-flex min-h-[44px] items-center text-text-2 hover:text-white" style={{ fontSize: "13px" }}>
                            現在地で調べる<span aria-hidden="true" className="ml-1">›</span>
                        </Link>
                    </p>
                </section>
            </main>
        </>
    );
}
