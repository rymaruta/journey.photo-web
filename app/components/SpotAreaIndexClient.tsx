"use client";

import React from "react";
import Link from "next/link";
import type { SpotArea } from "@/lib/data/spotLink";
import { REGIONS, REGION_EN, type RegionName } from "@/lib/data/prefectures";
import { useLocale } from "@/app/i18n/context";
import { CHIP_OFF, CHIP_SIZE, CHIP_HIT, CHIP_ROW } from "./chipStyles";
import SpotListSearch from "./SpotListSearch";
import SectionHead from "./SectionHead";
import type { SpotIndexPhotos } from "@/lib/data/spotIndexPhotos";
import { ROUTES } from "@/lib/routes";
import { PhotoTileLink, PHOTO_TILE_GRID, SeasonShelf } from "./SpotPhotoTiles";
import { PhotoCredits } from "./SpotPhotoParts";

/**
 * **公式撮影地ガイドの入口**（`/spots`）。**都道府県の一覧**を出す。
 *
 * 🔴 ここにスポットそのものを並べない。台帳が伸びるとページが重くなり、
 * HTML は `no-cache, no-store` で配るので**訪問のたびに**落ちる
 * （実測は `lib/data/spotLink.ts` の `SpotArea` の注記）。
 *
 * 受け取るのは**県の名前と件数だけ**——47県でも3KBに満たない。
 */
type Props = {
    areas: SpotArea[];
    /** ページを建てているスポットの数（下書きを建てる設定なら下書きを含む） */
    total: number;
    /** うち運営未確認の下書き。`total` と同じなら全部が下書き */
    draftCount: number;
    /**
     * 県の一覧の下に足す節（季節・テーマの切り口・2026-10-11）。サーバー側で描いたものを受け取る
     * （切り口の一覧を props のデータで渡さない——`app/spots/page.tsx`）
     */
    children?: React.ReactNode;
    /**
     * 地方の下の節（季節・市区町村・テーマ）へ飛ぶ近道の行き先（2026-11-09）。`id` は見出しの `id`（`app/spots/page.tsx` が、
     * 実際に描く節だけを渡す）。無い節への死んだリンクを出さないため、ここでは決めない
     */
    jumps?: Array<{ id: string; label: string; labelEn: string }>;
    /**
     * 写真の札に要るもの（2026-11-10・案A）: 県の代表写真・件数の多い国・いまの季節の棚・頁の下の写真の出典。
     * サーバー（`spotIndexPhotos`）が解いた**写真の場所と出典だけ**。無ければ県は名前だけの札になる
     */
    photos?: SpotIndexPhotos;
};

/** 地方の節。**北海道は東北と同じ節**（2026-11-10 案A: 札 1 枚だけの節を作らない） */
const sectionOf = (r: RegionName): string => (r === "北海道" || r === "東北" ? "北海道・東北" : r);

export default function SpotAreaIndexClient({ areas, total, draftCount, children, jumps = [], photos }: Props) {
    const { locale } = useLocale();
    const isJa = locale !== "en";

    /** 地方ごとにまとめる。**0件の地方は作らない**。北海道と東北は1つの節（両方あるときだけ「北海道・東北」と名乗る） */
    const groups = React.useMemo(() => {
        const out: Array<{ key: string; label: string; labelEn: string; items: SpotArea[] }> = [];
        for (const r of REGIONS) {
            const items = areas.filter((a) => a.region === r);
            if (items.length === 0) continue;
            const prev = out[out.length - 1];
            if (prev && prev.key === sectionOf(r)) {
                prev.items.push(...items);
                prev.label = sectionOf(r);
                prev.labelEn = "Hokkaido & Tohoku";
            } else {
                out.push({ key: sectionOf(r), label: r, labelEn: REGION_EN[r], items });
            }
        }
        const overseas = areas.filter((a) => a.region === null);
        if (overseas.length > 0) out.push({ key: "overseas", label: "海外", labelEn: "Outside Japan", items: overseas });
        return out;
    }, [areas]);

    /**
     * ページ内の近道（2026-11-09 判断）。本番 390px の実測で、地方の一覧は先頭の約 1,500px だが、そのあとに季節・市区町村・
     * テーマの節が続いてページ全体は 13,000px を超える。**地図は採らず、地方・節の見出しへ飛ぶ帯にした**
     * （理由は報告。軽く・静的HTMLのリンクのまま・押す先が同じページの見出しなので迷わない）。
     * 描いている地方と節だけを並べる（死んだリンクを出さない）
     */
    const jumpItems = [
        ...groups.map((g) => ({
            id: `spots-region-${g.key === "overseas" ? "overseas" : g.label}`,
            label: isJa ? g.label : g.labelEn,
        })),
        ...jumps.map((j) => ({ id: j.id, label: isJa ? j.label : j.labelEn })),
    ];

    /** 県の一覧と切り口の節（静的HTML。検索の結果があるあいだだけ隠れる） */
    const list = (
        <>
            {photos && <SeasonShelf seasonal={photos.seasonal} />}
            {jumpItems.length > 1 && (
                <nav aria-label={isJa ? "このページ内の移動" : "Jump to a section"} className="mb-6" data-testid="spots-jump-band">
                    <ul className={CHIP_ROW} style={{ listStyle: "none" }}>
                        {jumpItems.map((j) => (
                            <li key={j.id}>
                                <Link href={`#${j.id}`} prefetch={false}
                                   className={`${CHIP_HIT} inline-flex items-center rounded-full ${CHIP_OFF} transition-colors`}
                                   style={CHIP_SIZE}>
                                    {j.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            )}
            {groups.length === 0 ? (
                /* **架空の県で埋めない。** 0件なら0件と言う */
                <p className="m-0 text-white/70" style={{ fontSize: "14px" }}>
                    {isJa ? "公開中の撮影スポットはまだありません。" : "No published spots yet."}
                </p>
            ) : (
                groups.map(({ key, label, labelEn, items }) => {
                    const overseas = key === "overseas";
                    const sum = items.reduce((n, a) => n + a.count, 0);
                    const countries = overseas ? photos?.countries ?? [] : [];
                    return (
                    <section key={key} className="mb-7">
                        {/* 地方の見出しは節の見出し（明朝 22・`SectionHead`・2026-10-31 束 2 P3）。以前は明朝 17 */}
                        <SectionHead id={`spots-region-${overseas ? "overseas" : label}`}
                            title={<>
                                {isJa ? label : labelEn}
                                {/* 地方の件数（2026-11-09・見出しだけだと中身の多さが分からない）。12 以上・text-2（黒の上 10.6:1 の定義値） */}
                                <span aria-hidden="true" className="ml-2 align-baseline font-sans font-normal tabular-nums text-text-2" style={{ fontSize: "13px" }}>
                                    {isJa ? `${sum.toLocaleString("ja-JP")}件` : `${sum.toLocaleString("en-US")}`}
                                </span>
                            </>} />
                        {/* 県・国は写真の札（2026-11-10 案A）。海外は件数の多い国を札にし、最後の札で国の一覧へ */}
                        <ul className={PHOTO_TILE_GRID} style={{ listStyle: "none" }}>
                            {overseas && countries.length > 0 ? (
                                <>
                                    {countries.map((c) => (
                                        <li key={c.code}>
                                            <PhotoTileLink href={c.href} label={isJa ? c.name : c.nameEn} count={c.count} cover={c.cover} testId="spots-country-tile" />
                                        </li>
                                    ))}
                                    <li>
                                        <Link href={ROUTES.SPOT_AREA(items[0].slug)} prefetch={false} data-testid="spots-all-countries"
                                              className="flex flex-col justify-end w-full aspect-square rounded-xl bg-surface-3 ring-1 ring-inset ring-line-strong hover:bg-white/10 transition-colors px-2 pb-1.5 text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                                            <span className="font-semibold" style={{ fontSize: "15px", lineHeight: "20px" }}>
                                                {isJa ? <>すべての国・<wbr />地域<span className="tabular-nums">（{photos?.countryTotal ?? countries.length}）</span></> : `All countries (${photos?.countryTotal ?? countries.length})`}
                                                <span aria-hidden="true" className="ml-0.5 text-text-2">›</span>
                                            </span>
                                        </Link>
                                    </li>
                                </>
                            ) : items.map((a) => (
                                <li key={a.slug}>
                                    <PhotoTileLink href={ROUTES.SPOT_AREA(a.slug)} label={isJa ? a.name : a.nameEn} count={a.count}
                                                   cover={photos?.areaCovers[a.slug]} testId="spots-area-tile" />
                                </li>
                            ))}
                        </ul>
                    </section>
                    );
                })
            )}
            {children}
            {/* 写真の出典（CC BY・CC BY-SA）は畳まず、頁の下に常に出す（2026-11-10 秘書室の判断） */}
            {photos && <PhotoCredits items={photos.credits} />}
        </>
    );

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl">
            <h1 className="font-serif text-4xl font-bold m-0 wrap-anywhere" data-testid="spots-title">
                {isJa ? "撮影スポットをさがす" : "Find a place to shoot"}
            </h1>
            {/* 0件のときは下の「まだありません」だけを出す（「0件の下書きです」と並べない） */}
            {total > 0 && (
            <p className="m-0 mt-2 mb-6 text-text-2" style={{ fontSize: "15px", lineHeight: "24px" }}>
                {/* **「運営が調べた」と言えるのは、人が確かめた行だけ。** 全部が下書きなら
                    そう言う（2026-09-24 の台帳は 1,417件が未確認のまま「調べた」と名乗っていた）
                    2026-10-11: 公開の行も人が確かめたのは数件で、多くは AI 照合。「運営が調べた」は
                    言い過ぎなので外した（確かめ方は各ページの出典の行と、索引の description が書く） */}
                {draftCount >= total
                    ? (isJa
                        ? `撮影スポットの下書きです（${total}件・運営未確認）。地域を選ぶと、その中のスポットが出ます。`
                        : `Draft guides, not checked by us yet (${total}). Pick an area to see the spots in it.`)
                    : (isJa
                        ? `撮影スポットの案内です（${total}件${draftCount > 0 ? `・うち下書き${draftCount}件` : ""}）。地域を選ぶと、その中のスポットが出ます。`
                        : `Photo spot guides (${total}${draftCount > 0 ? `, ${draftCount} drafts` : ""}). Pick an area to see the spots in it.`)}
            </p>
            )}

            {/* 検索窓（2026-11-09）。県の一覧と切り口の節は**消さずに**その子にする——結果があるあいだだけ隠れる（静的HTMLには残る）。
                スポットが0件のときは検索窓を出さない */}
            {total > 0 ? <SpotListSearch areas={areas} isJa={isJa}>{list}</SpotListSearch> : list}
        </main>
    );
}
