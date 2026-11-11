"use client";

// app/components/SpotWants.tsx
//
// **みんなの「行きたい」を出す3か所**（2026-11-11・撮影スポットを払うの②・案の資料の第7章の絵）。
// 数は毎日1回の集計（`/app/data/spot-wants.json`・`lib/utils/spotWants.ts`）。**10未満は配られない**ので、
// 無い撮影スポットには何も出さない（「0」と言わない）。数が載ったあとに描く（静的な HTML には焼かない）。
//
//  - `SpotWantsLine`: 撮影スポットの頁の題の下に1行「今月の行きたい 1,284 · 全国1位」
//  - `AreaWantsTop`: 県の一覧の頭に「今月いちばん行きたい」3つ（並びの既定は変えない）
//  （トップの上位の並びは置かない——iOS に無く、入口を増やさない・2026-11-11 確かめ役の指摘 9）

import React from "react";
import Link from "next/link";
import { useLocale } from "../i18n/context";
import { useSpotWants, wantCount } from "../../lib/utils/spotWants";

export function SpotWantsLine({ slug }: { slug: string }) {
    const { locale } = useLocale();
    const en = locale === "en";
    const file = useSpotWants();
    const hit = file?.spots.find((s) => s.slug === slug);
    if (!hit) return null;
    return (
        <p className="m-0 mt-2 flex items-baseline gap-2 text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }} data-testid="spot-wants-line">
            <span>{en ? "Want to go this month" : "今月の行きたい"}</span>
            <span className="text-white font-semibold tabular-nums">{wantCount(hit.n, en)}</span>
            {/* 順位は日本の撮影スポットだけ（海外は数だけ・2026-11-11 判断） */}
            {hit.rank !== undefined && <>
                <span aria-hidden="true">·</span>
                <span className="text-accent tabular-nums">{en ? `#${hit.rank} in Japan` : `全国${hit.rank}位`}</span>
            </>}
        </p>
    );
}

export function AreaWantsTop({ spots }: { spots: readonly { slug: string; name: string; city?: string }[] }) {
    const { locale } = useLocale();
    const en = locale === "en";
    const file = useSpotWants();
    const top = React.useMemo(() => {
        if (!file) return [];
        const here = new Map(spots.map((s) => [s.slug, s]));
        return file.spots.filter((w) => here.has(w.slug)).slice(0, 3).map((w) => ({ ...w, city: here.get(w.slug)!.city, name: here.get(w.slug)!.name }));
    }, [file, spots]);
    if (top.length === 0) return null;
    return (
        <section className="mb-6" aria-labelledby="area-wants-top" data-testid="area-wants-top">
            <p id="area-wants-top" className="m-0 mb-2 eyebrow text-accent">{en ? "Most wanted this month" : "今月いちばん行きたい"}</p>
            <ol className="m-0 p-0 border-t border-line" style={{ listStyle: "none" }}>
                {top.map((w, i) => (
                    <li key={w.slug} className="border-b border-line">
                        <Link href={`/spots/${w.slug}`} prefetch={false}
                              className="flex items-center gap-3 min-h-[52px] text-white hover:bg-surface focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                            <span className="w-6 text-center font-serif font-bold text-accent tabular-nums" style={{ fontSize: "18px" }}>{i + 1}</span>
                            <span className="flex-1 min-w-0 truncate font-semibold" style={{ fontSize: "15px" }}>
                                {w.name}{w.city && <span className="ml-2 font-normal text-text-3" style={{ fontSize: "12px" }}>{w.city}</span>}
                            </span>
                            <span className="text-text-2 tabular-nums" style={{ fontSize: "13px" }}>{wantCount(w.n, en)}</span>
                        </Link>
                    </li>
                ))}
            </ol>
        </section>
    );
}
