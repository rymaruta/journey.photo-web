"use client";

// app/components/SpotNext.tsx
//
// **撮影スポット詳細の「次へ」**（2026-11-09 owner「任せる」・デザイナーの提案書の案C）。
// 検索から入った人（入口の約52%）は1頁だけ見て帰りやすい。いま約5,300px 下にある「同じ県の一覧・近く・季節の一覧」と
// アプリの案内の札を、説明文のすぐ下（行きたい・地図で見る・シェアの下）へ引き上げる。
//
// - **リンクを増やさない・節を複製しない。** 一覧（県・国）への「すべて見る」と「この撮影スポットが載っている一覧」
//   （国・テーマ・季節）は、元の置き場（右の柱）から**ここへ移した**。「近くの撮影スポット」は絵つきの行を右の柱に残し、
//   ここからはその節へ飛ぶだけ（頁内のリンク・新しい URL は増えない）。
// - **最初の HTML の文字リンク**（`next/link`・先読みなし）。ボタンにしない。
// - 押せる面は高さ 44px 以上。本文系の字は 12px 以上。真鍮は合図だけ（札の眉）で、リンクは白（合図ではなく道）。
// - 数える: `nav_click`（area=spot_next・dest=area/nearby/topic）。アプリの札は `app_store_click`（placement=spot_detail）。

import React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { CHIP_OFF, CHIP_SIZE, CHIP_HIT, CHIP_ROW } from "./chipStyles";
import { SectionTitle } from "./SectionHead";
import AppInstallCard from "./AppInstallCard";
import TrackedLink from "./TrackedLink";
import { track } from "../../lib/utils/analytics";

export type SpotNextProps = {
    isJa: boolean;
    /** 県（国内）または国（海外）の一覧の行き先と、その名前。無ければ行を出さない */
    list: { href: string; name: string; nameEn: string } | null;
    /** 「近くの撮影スポット」の節があるか（あれば、その節へ飛ぶ行を出す） */
    hasNearby: boolean;
    topics: Array<{ href: string; label: string; labelEn?: string; count: number }>;
};

/** 近くの節（`SpotGuideClient` の `Head id`）の ID。ここと節の ID が食い違うと行が空振りする（試験で見張る） */
export const NEARBY_SECTION_ID = "spot-nearby";

const ROW = "flex min-h-[44px] w-full items-center justify-between gap-2 border-b border-line text-white hover:text-white/80 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const ROW_STYLE: React.CSSProperties = { fontSize: "15px", lineHeight: "22px", touchAction: "manipulation" };

export default function SpotNext({ isJa, list, hasNearby, topics }: SpotNextProps) {
    const hasRows = !!list || hasNearby;
    return (
        <section aria-label={isJa ? "次に見る" : "Next"} data-testid="spot-next" className="max-w-3xl pt-5 pb-6 border-b border-line">
            {(hasRows || topics.length > 0) && (
                <nav aria-label={isJa ? "観光スポットの一覧" : "Photo spot lists"}>
                    {hasRows && (
                        <ul className="m-0 p-0" style={{ listStyle: "none" }}>
                            {list && (
                                <li>
                                    <TrackedLink href={list.href} navArea="spot_next" navDest="area" className={ROW} style={ROW_STYLE} data-testid="spot-next-list">
                                        <span>{isJa ? `${list.name}の観光スポットをすべて見る` : `See all spots in ${list.nameEn}`}</span>
                                        <ChevronRightIcon aria-hidden="true" className="shrink-0 text-text-2" style={{ width: 14, height: 14, strokeWidth: 2 }} />
                                    </TrackedLink>
                                </li>
                            )}
                            {hasNearby && (
                                <li>
                                    {/* 頁内の移動（同じ頁の「近くの撮影スポット」へ）。新しい URL は増えない */}
                                    <Link href={`#${NEARBY_SECTION_ID}`} prefetch={false} className={ROW} style={ROW_STYLE} data-testid="spot-next-nearby"
                                       onClick={() => track("nav_click", { area: "spot_next", dest: "nearby" })}>
                                        <span>{isJa ? "近くの観光スポット" : "Nearby spots"}</span>
                                        <ChevronRightIcon aria-hidden="true" className="shrink-0 text-text-2" style={{ width: 14, height: 14, strokeWidth: 2 }} />
                                    </Link>
                                </li>
                            )}
                        </ul>
                    )}
                    {topics.length > 0 && (
                        <div className={hasRows ? "mt-4" : ""} data-testid="spot-topics">
                            <SectionTitle id="spot-topics">{isJa ? "この観光スポットが載っている一覧" : "Lists with this spot"}</SectionTitle>
                            <ul className={CHIP_ROW} style={{ listStyle: "none" }}>
                                {topics.map((t) => (
                                    <li key={t.href}>
                                        <TrackedLink href={t.href} navArea="spot_next" navDest="topic"
                                                     className={`${CHIP_HIT} inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors`}
                                                     style={CHIP_SIZE}>
                                            {!isJa && t.labelEn ? t.labelEn : t.label}
                                            <span className="text-white/60" style={{ fontSize: "12px" }}>{t.count}</span>
                                        </TrackedLink>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </nav>
            )}
            <AppInstallCard placement="spot_detail" className={hasRows || topics.length > 0 ? "mt-5" : ""} />
        </section>
    );
}
