"use client";

// app/components/SpotPhotoTiles.tsx
//
// **`/spots` の写真の札**（2026-11-10・札 rymaruta/journey.photo-ios#516 の案A・owner 承認）。
// 県・国の札は正方形の代表写真に白の名前と件数（下だけ黒のぼかし）。先頭に「いまの季節」の棚。
//
// 色の決まり（板 `DesignSystem.dc.html`）: 写真の上は白だけ（副文は白 72%）。真鍮は黒地の上の眉ラベルだけ。
// 写真が無い・読めない札は「名前だけの札」（`surface-3`・縁 白14%・名前は白・件数は `text-2`）。

import React from "react";
import Link from "next/link";
import type { PhotoTile, SpotIndexPhotos } from "@/lib/data/spotIndexPhotos";
import { useLocale } from "@/app/i18n/context";
import SectionHead from "./SectionHead";
import { CreditMark, SpotPhoto, usePhotoFailed } from "./SpotPhotoParts";

/** 県・国の札の並び: 電話 3 列・タブレット 4 列・PC 6 列 */
export const PHOTO_TILE_GRID = "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 m-0 p-0";

const TILE = "relative block w-full aspect-square overflow-hidden rounded-xl focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent";
const SCRIM = "linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,0) 100%)";

/**
 * 写真の札（県・国）。名前と件数は写真の下端に白で。写真が無いか読めなければ名前だけの札。
 * `testId` は札のリンクに付ける。リンクの読み上げは名前と件数だけ（写真は飾り・`SpotPhoto` の注記）
 */
export function PhotoTileLink({ href, label, count, cover, testId }: {
    href: string; label: string; count: number; cover: PhotoTile | null | undefined; testId: string;
}) {
    const [failed, fail] = usePhotoFailed(cover?.src);
    const photo = !!cover && !failed;
    return (
        <div className="relative">
            <Link href={href} prefetch={false} data-testid={testId} data-photo={photo ? "1" : "0"}
                  className={`${TILE} ${photo ? "bg-surface-2" : "bg-surface-3 ring-1 ring-inset ring-line-strong hover:bg-white/10 transition-colors"}`}>
                {photo && cover && (
                    <>
                        <SpotPhoto src={cover.src} onFail={fail} />
                        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/5" style={{ background: SCRIM }} />
                    </>
                )}
                <span className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 px-2 pb-1.5 ${photo ? "text-white" : ""}`}>
                    <span className="min-w-0 truncate font-semibold text-white" style={{ fontSize: "15px", lineHeight: "20px" }}>{label}</span>
                    <span className={`shrink-0 tabular-nums ${photo ? "text-white/72" : "text-text-2"}`} style={{ fontSize: "12px", lineHeight: "18px" }}>{count}</span>
                </span>
            </Link>
            {/* © の読み上げは写っているスポット＋札の名前（「写真の出典: 阿寒湖（北海道）」・2026-11-10） */}
            {photo && cover?.creditKey && <CreditMark creditKey={cover.creditKey} name={cover.creditName ?? label} place={cover.creditName ? label : undefined} />}
        </div>
    );
}

const SEASON = {
    spring: { ja: "春", en: "Spring" },
    summer: { ja: "夏", en: "Summer" },
    autumn: { ja: "秋", en: "Autumn" },
    winter: { ja: "冬", en: "Winter" },
} as const;

/** いまの季節の棚の1枚（縦長 4:5 の写真＋名前・場所）。写真が読めなければ名前だけの札 */
function ShelfCard({ s }: { s: NonNullable<SpotIndexPhotos["seasonal"]>["spots"][number] }) {
    const [failed, fail] = usePhotoFailed(s.cover.src);
    return (
        <div className="relative">
            <Link href={`/spots/${s.slug}`} prefetch={false} data-testid="season-shelf-card" data-photo={failed ? "0" : "1"}
                  className="group block rounded-xl focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                <span className={`relative block w-full overflow-hidden rounded-xl ${failed ? "bg-surface-3 ring-1 ring-inset ring-line-strong" : "bg-surface-2"}`}
                      style={{ aspectRatio: "4 / 5" }}>
                    {failed ? (
                        <span className="absolute inset-0 flex items-center justify-center px-3 text-center font-serif font-bold text-white/80"
                              style={{ fontSize: "17px", lineHeight: "1.3" }}>{s.name}</span>
                    ) : <SpotPhoto src={s.cover.src} onFail={fail} />}
                </span>
                <span className="block mt-1.5 truncate font-semibold text-white" style={{ fontSize: "15px", lineHeight: "20px" }}>{s.name}</span>
                {s.region && <span className="block truncate text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>{s.region}</span>}
            </Link>
            {!failed && s.cover.creditKey && <CreditMark creditKey={s.cover.creditKey} name={s.name} />}
        </div>
    );
}

/** **いまの季節の棚**（`/spots` の先頭・ホームと同じ選び方＝`homeSeasonalSpots`）。横に流す */
export function SeasonShelf({ seasonal }: { seasonal: SpotIndexPhotos["seasonal"] }) {
    const { locale } = useLocale();
    const en = locale === "en";
    if (!seasonal || seasonal.spots.length === 0) return null;
    const name = SEASON[seasonal.season];
    return (
        <section className="mb-7" aria-labelledby="spots-season-shelf" data-testid="spots-season-shelf">
            <SectionHead id="spots-season-shelf"
                eyebrow={`${name.en.toUpperCase()} · ${en ? "THIS SEASON" : "いまの季節"}`}
                title={en ? `${name.en} photo spots` : `${name.ja}の撮影スポット`}
                href={seasonal.href} moreLabel={en ? `All ${seasonal.total}` : `すべて ${seasonal.total}`} />
            <ul className="flex gap-3 overflow-x-auto no-scrollbar m-0 p-0 -mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 md:-mx-8 md:px-8 md:scroll-px-8 lg:mx-0 lg:px-0 lg:scroll-px-0"
                style={{ listStyle: "none", scrollSnapType: "x proximity" }}>
                {seasonal.spots.map((s) => (
                    <li key={s.slug} className="shrink-0 w-[132px] lg:w-[150px]" style={{ scrollSnapAlign: "start" }}>
                        <ShelfCard s={s} />
                    </li>
                ))}
            </ul>
        </section>
    );
}
