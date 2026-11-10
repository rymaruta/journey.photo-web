"use client";

import React from "react";
import Link from "next/link";
import type { SpotIndexItem } from "@/lib/data/spotLink";
import { useLocale } from "@/app/i18n/context";
import { ROUTES } from "@/lib/routes";
import { CHIP_ON, CHIP_OFF, CHIP_SIZE, CHIP_HIT } from "./chipStyles";
import { CreditMark, PhotoCredits, SpotPhoto, usePhotoFailed } from "./SpotPhotoParts";

/**
 * **公式撮影地ガイドの索引**（`/spots`）。
 *
 * owner の指示書 第8章:「旅のテーマ」から撮影スポットを発見できるようにする。
 * ただし **「これらは固定の見た目だけのカードではなく、登録済みスポットの
 * カテゴリやタグと実際に紐付けてください」「該当スポットがないテーマは、
 * 空の特集として表示しないでください」**。
 *
 * だから**テーマの一覧は持たない**——台帳の `category` を数えて、
 * **実際に在るものだけ**をチップにする。0件のテーマは存在しようがない。
 */
/**
 * **受け取るのは解いたあとの軽い形だけ**（`SpotIndexItem`）。
 * 台帳の `Spot` をそのまま受けると、全文がこのページの HTML に乗る
 * ——実測 518KB／120件。`lib/data/spotLink.ts` の注記を参照。
 */
type Props = {
    spots: SpotIndexItem[];
    /**
     * どの区画の一覧か（`/spots/area/<slug>`）。見出しとパンくずに使う。
     * 省くと区画名のない一覧になる。
     */
    area?: { name: string; nameEn: string };
    /** 格子の下・写真の出典の上に足す節（市区町村の段など。サーバーで描いたもの） */
    children?: React.ReactNode;
};

/**
 * **スポットの札**（2026-11-10・札 rymaruta/journey.photo-ios#516 の案A・owner 承認）。正方形の写真＋名前（明朝 18・
 * 板の「格子・札の題」）＋市区町村。説明 2 行は PC（`lg`）だけ。写真の出典は札の下に置かず、頁の下の「写真の出典」に
 * まとめる（札の右上の © から移れる）。**写真が無いか読めなければ名前だけの札**（壊れた画像の印を出さない）
 */
function SpotCard({ s, areaName, isJa }: { s: SpotIndexItem; areaName?: string; isJa: boolean }) {
    const cover = s.cover;
    const [failed, fail] = usePhotoFailed(cover?.src);
    const photo = !!cover && !failed;
    // 県の頁では県名を繰り返さない（「北海道 釧路市」→「釧路市」）
    const where = areaName && s.region.startsWith(`${areaName} `) ? s.region.slice(areaName.length + 1) : s.region;
    return (
        <div className="relative h-full">
            <Link href={`/spots/${s.slug}`} prefetch={false} data-testid="spot-card" data-photo={photo ? "1" : "0"}
                  className="group block h-full rounded-xl focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                <span className={`relative block w-full aspect-square overflow-hidden rounded-xl ${photo ? "bg-surface-2" : "bg-surface-3 ring-1 ring-inset ring-line-strong"}`}>
                    {photo && cover ? (
                        <SpotPhoto src={cover.src} onFail={fail} className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-[1.02] motion-reduce:transition-none" />
                    ) : (
                        /* 代表写真が無い・読めないときは**名前**（無関係な写真で埋めない） */
                        <span className="absolute inset-0 flex items-center justify-center px-3 text-center font-serif font-bold text-white/80"
                              style={{ fontSize: "17px", lineHeight: "1.3" }}>{s.name}</span>
                    )}
                </span>
                <span className="block mt-2 font-serif font-bold text-white line-clamp-2 wrap-anywhere" style={{ fontSize: "18px", lineHeight: "24px" }}>{s.name}</span>
                {(where || s.stage === "review") && (
                    <span className="block mt-0.5 truncate text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>
                        {s.stage === "review" && (isJa ? "下書き" : "Draft")}
                        {s.stage === "review" && where ? " ・ " : ""}
                        {where}
                    </span>
                )}
                {s.summary && (
                    <span className="hidden lg:block mt-1.5 text-text-2 line-clamp-2" data-testid="spot-card-summary"
                          style={{ fontSize: "13px", lineHeight: "20px" }}>{s.summary}</span>
                )}
            </Link>
            {photo && cover?.credit && <CreditMark creditKey={s.slug} name={s.name} />}
        </div>
    );
}

export default function SpotIndexClient({ spots, area, children }: Props) {
    const { locale } = useLocale();
    const isJa = locale !== "en";
    const [theme, setTheme] = React.useState<string | null>(null);

    /** 台帳に実際に在るカテゴリと件数（**架空のテーマを出さない**） */
    // 運営未確認の下書きの数。**「運営が調べた」と言えるのは人が確かめた行だけ**
    const draftCount = spots.filter((s) => s.stage === "review").length;
    const themes = React.useMemo(() => {
        const m = new Map<string, number>();
        for (const s of spots) {
            const c = (s.category ?? "").trim();
            if (c) m.set(c, (m.get(c) ?? 0) + 1);
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }, [spots]);

    const shown = theme ? spots.filter((s) => s.category === theme) : spots;
    const credits = React.useMemo(() => spots.flatMap((s) => s.cover?.credit
        ? [{ key: s.slug, name: s.name, credit: s.cover.credit }] : []), [spots]);

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl">
            {/* **戻り道を必ず出す。** 区画のページは `/spots` からしか辿れない */}
            <p className="m-0 mb-2" style={{ fontSize: "13px", lineHeight: "18px" }}>
                {/* 戻り道は当たり 44（押せる所の決まり・2026-10-31 束 2 P5）。以前は 13 の字の高さだけ */}
                <Link href={ROUTES.SPOTS} prefetch={false}
                      className="inline-flex items-center min-h-[44px] text-text-2 hover:text-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent rounded"
                      data-testid="spots-back">
                    {isJa ? "← 撮影スポットをさがす" : "← Find a place to shoot"}
                </Link>
            </p>
            <h1 className="font-serif text-4xl font-bold m-0 wrap-anywhere" data-testid="spots-title">
                {area
                    ? (isJa ? `${area.name}の撮影スポット` : `Photo spots in ${area.nameEn}`)
                    : (isJa ? "撮影スポットをさがす" : "Find a place to shoot")}
            </h1>
            {spots.length > 0 && (
            <p className="m-0 mt-2 mb-5 text-text-2" style={{ fontSize: "15px", lineHeight: "24px" }}>
                {/* **「運営が調べた」と言えるのは、人が確かめた行だけ**（`stage`）。
                    全部が下書きならそう言う
                    2026-10-11: 公開の行も人が確かめたのは数件で、多くは AI 照合。「運営が調べた」は
                    言い過ぎなので外した（確かめ方は各ページの出典の行と、索引の description が書く） */}
                {draftCount >= spots.length
                    ? (isJa
                        ? `撮影スポットの下書きです（${spots.length}件・運営未確認）。写真の投稿がまだ無い場所も載っています。`
                        : `Draft guides, not checked by us yet (${spots.length}). Places with no photos yet are listed too.`)
                    : (isJa
                        ? `撮影スポットの案内です（${spots.length}件${draftCount > 0 ? `・うち下書き${draftCount}件` : ""}）。写真の投稿がまだ無い場所も載っています。`
                        : `Photo spot guides (${spots.length}${draftCount > 0 ? `, ${draftCount} drafts` : ""}). Places with no photos yet are listed too.`)}
            </p>
            )}

            {/* 旅のテーマ＝**台帳に在るカテゴリだけ**。0件のテーマは作らない。
                **2026-11-09（Web 入口ページ監査の案A）: スマホは横に流す1行**。青森県は21個の札が
                390px の画面で6行を占め、最初の写真が画面の下端だった。`lg` 以上は広いので従来どおり折り返す。
                当たり 44 のために行に上下 5px の余白（`FilterBar` の `WRAPPING_ROW` と同じ作り）。
                行の端は画面の端まで流す（`-mx-4 px-4`・`sm` 以上の余白に合わせて広げる） */}
            {themes.length > 0 && (
                <div role="group" aria-label={isJa ? "テーマでしぼる" : "Filter by theme"}
                     data-testid="spots-theme-row"
                     className="flex flex-nowrap gap-x-1.5 m-0 -mt-[5px] mb-[19px] py-[5px] -mx-4 px-4 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8 overflow-x-auto no-scrollbar lg:mx-0 lg:px-0 lg:overflow-visible lg:flex-wrap lg:gap-y-2.5">
                    <button type="button" role="switch" aria-checked={theme === null}
                            onClick={() => setTheme(null)}
                            className={`${CHIP_HIT} shrink-0 inline-flex items-center rounded-full transition-colors ${
                                theme === null ? CHIP_ON : CHIP_OFF
                            }`}
                            style={CHIP_SIZE}>
                        {isJa ? "すべて" : "All"}
                    </button>
                    {themes.map(([c, n]) => (
                        <button key={c} type="button" role="switch" aria-checked={theme === c}
                                onClick={() => setTheme(theme === c ? null : c)}
                                className={`${CHIP_HIT} shrink-0 inline-flex items-center gap-1.5 rounded-full transition-colors ${
                                    theme === c ? CHIP_ON : CHIP_OFF
                                }`}
                                style={CHIP_SIZE}>
                            {c}
                            {/* 件数は**選択状態に合わせて色を変える**。白の塗りの上で
                                `text-white/60` のままだと、選んだテーマの件数が消えていた */}
                            <span className={theme === c ? "text-ink/70" : "text-white/60"} style={{ fontSize: "12px" }}>{n}</span>
                        </button>
                    ))}
                </div>
            )}

            {shown.length === 0 ? (
                /* **架空のスポットで埋めない。** 0件なら0件と言う */
                <p className="m-0 text-white/70" style={{ fontSize: "14px" }}>
                    {isJa ? "公開中の撮影スポットはまだありません。" : "No published spots yet."}
                </p>
            ) : (
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-5 m-0 p-0" style={{ listStyle: "none" }} data-testid="spot-grid">
                    {shown.map((s) => <li key={s.slug}><SpotCard s={s} areaName={area?.name} isJa={isJa} /></li>)}
                </ul>
            )}
            {children}
            {/* 写真の出典（CC BY・CC BY-SA）は畳まず、頁の下に常に出す（2026-11-10 秘書室の判断）。テーマで絞っても全部 */}
            <PhotoCredits items={credits} />
        </main>
    );
}
