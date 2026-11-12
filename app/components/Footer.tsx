"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import { OVERSEAS_SLUG } from "../../lib/data/prefectures";
import AppInstallCard from "./AppInstallCard";
import TrackedLink from "./TrackedLink";
import { pageHasOwnAppCard } from "../../lib/utils/spotDetailPath";
import type { NavDest } from "../../lib/utils/analytics";

/**
 * フッター（2026-11-10 札 #515・owner 承認の第2版の推奨「さがす・まなぶの2つの組を、全部文字リンクの2列で」）。
 *
 * 以前は「サイト」「撮影スポット」「規約」の3つの組を電話で1列に積み、390px で約1513px（画面約1.8枚）あった。
 * いまは目的で2つの組に分け、**電話でも開け閉めなしの2列**。規約と © は最後の1行。
 *  - 外したもの: 作品（ロゴとホームのタブと同じ行き先）・サイトの組の「撮影スポット」（一覧と同じ `/spots`）・
 *    いいねした写真・保存した写真・行きたい場所（自分専用の頁で巡回を断っている。☰ のログイン中の組にある）
 *  - 撮影スポットの行き先は 11-05 owner「WEB版をもっと認知してもらいたい」の意図どおり1つも減らさない
 */
export default function Footer() {
    const { locale, labels } = useLocale();
    const navLabels = labels.navigation || {};
    const en = locale === "en";
    // 本文に自分のアプリの札がある頁（ホーム・撮影スポット詳細・教科書の章）では、フッターの札は出さない（`spotDetailPath.ts`）
    const showBanner = !pageHasOwnAppCard(usePathname());

    // さがす。2列で読むと対になる並び: 地図・一覧 → 桜・紅葉 → 雪景色・海外 → 春・夏 → 秋・冬
    // 撮影スポットの行き先は nav_click（area=footer）を数える。地図は以前どおり数えない
    const findLinks: Array<{ href: string; label: string; dest?: NavDest }> = [
        { href: ROUTES.MAP, label: navLabels.map || (en ? "Map" : "撮影地マップ") },
        { dest: "spots", href: ROUTES.SPOTS, label: en ? "All photo spots" : "観光スポットの一覧" },
        { dest: "topic", href: ROUTES.SPOT_SAKURA(), label: en ? "Cherry blossoms" : "桜の観光スポット" },
        { dest: "topic", href: ROUTES.SPOT_MOMIJI(), label: en ? "Autumn foliage" : "紅葉の観光スポット" },
        { dest: "topic", href: ROUTES.SPOT_SNOW(), label: en ? "Snow scenery" : "雪景色の観光スポット" },
        { dest: "area", href: ROUTES.SPOT_AREA(OVERSEAS_SLUG), label: en ? "Outside Japan" : "海外の観光スポット" },
        { dest: "topic", href: ROUTES.SPOT_SEASON("spring"), label: en ? "Spring" : "春の観光スポット" },
        { dest: "topic", href: ROUTES.SPOT_SEASON("summer"), label: en ? "Summer" : "夏の観光スポット" },
        { dest: "topic", href: ROUTES.SPOT_SEASON("autumn"), label: en ? "Autumn" : "秋の観光スポット" },
        { dest: "topic", href: ROUTES.SPOT_SEASON("winter"), label: en ? "Winter" : "冬の観光スポット" },
    ];
    // まなぶ。撮りに行く前に読む・見る頁
    const learnLinks = [
        { href: ROUTES.LEARN, label: en ? "Photography guides" : "写真とカメラの教科書" },
        { href: ROUTES.COMPOSITION, label: en ? "Composition guide" : "構図ガイド" },
        { href: ROUTES.TODAY, label: en ? "Today's sunrise & sunset" : "今日の日の出・日の入り" },
    ];
    const legalLinks = [
        { href: ROUTES.TERMS, label: en ? "Terms" : "利用規約" },
        { href: ROUTES.PRIVACY, label: en ? "Privacy" : "プライバシーポリシー" },
        // 意見箱（2026-11-11 札 #546）。規約と同じ最後の1行に（組や行を増やさない）
        { href: ROUTES.FEEDBACK("footer"), label: en ? "Send feedback" : "意見を送る" },
    ];

    // 押せる高さ 44px・字 13px（px で書く。rem の段に頼らない）。押している間は真鍮（黒地の上）
    const linkClass = "inline-flex min-h-[44px] items-center justify-start text-left text-text-2 transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
    const linkStyle: React.CSSProperties = { fontSize: "13px", lineHeight: "18px", touchAction: "manipulation" };
    const headingClass = "m-0 mb-1 font-semibold text-text-3";
    const headingStyle: React.CSSProperties = { fontSize: "12px", lineHeight: "16px", letterSpacing: "0.06em" };
    // 組の中の2列。列の左端は組をまたいで縦にそろう（どちらの組も同じ幅・同じ列の隙間）
    const columnsClass = "grid grid-cols-2 justify-items-start gap-x-4";

    return (
        <footer className="border-t border-line bg-bg" style={{ paddingBottom: "var(--page-bar-h, 0px)" }}>
            {/* **左揃え**（2026-11-06 owner「フッターの左揃えなどの整列感大事にして」）。
                ご案内の札 → ブランド（左）｜さがす・まなぶ（右）→ © と規約の1行。どの行も同じ左端から始まる */}
            <div className="mx-auto max-w-5xl px-6 py-10 text-left md:px-8 md:py-12">
                {/* 電話の幅は 11-09 承認の小さい形（PC は今までの大きさ） */}
                {showBanner && <AppInstallCard placement="banner" compact />}

                <div className={`${showBanner ? "mt-10" : ""} grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12`}>
                    <div className="flex flex-col items-start gap-3">
                        <div className="inline-flex items-center gap-3">
                            {/* ヘッダー・アプリアイコンと共通の公式アパーチャロゴ */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/logo-aperture.png" alt="" aria-hidden="true" width={40} height={40} decoding="async" className="h-9 w-9 flex-shrink-0" />
                            <p className="m-0 font-wordmark text-[26px] font-semibold tracking-tight text-white">Journey Photo</p>
                        </div>
                        <p className="m-0 text-[15px] leading-[22px] text-text-2">
                            {en ? "Moments that move someone's next journey." : "旅の一瞬を、誰かの次の旅へ。"}
                        </p>
                    </div>

                    {/* PC は さがす（2列）｜まなぶ（1列）を横に。見出しは同じ高さ */}
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-6">
                        <nav aria-label={en ? "Find" : "さがす"} className="flex flex-col" data-testid="footer-spot-links">
                            <p className={headingClass} style={headingStyle}>{en ? "Find" : "さがす"}</p>
                            <div className={columnsClass}>
                                {findLinks.map(({ href, label, dest }) => dest
                                    ? <TrackedLink key={href} href={href} navArea="footer" navDest={dest} className={linkClass} style={linkStyle}>{label}</TrackedLink>
                                    : <Link key={href} href={href} prefetch={false} className={linkClass} style={linkStyle}>{label}</Link>)}
                            </div>
                        </nav>

                        <nav aria-label={en ? "Learn" : "まなぶ"} className="flex flex-col">
                            <p className={headingClass} style={headingStyle}>{en ? "Learn" : "まなぶ"}</p>
                            <div className={`${columnsClass} md:grid-cols-1`}>
                                {/* 2列で1本だけ余る最後の行は2列ぶんの幅を使う（2026-11-10 判断）。320px で列の幅（128px）に
                                    「今日の日の出・日の入り」が入らず「り」だけ次の行に落ちていた（実測の画面写真）。PC は1列なので外す */}
                                {learnLinks.map(({ href, label }, i) => (
                                    <Link key={href} href={href} prefetch={false}
                                          className={`${linkClass} ${learnLinks.length % 2 === 1 && i === learnLinks.length - 1 ? "col-span-2 md:col-span-1" : ""}`}
                                          style={linkStyle}>{label}</Link>
                                ))}
                            </div>
                        </nav>
                    </div>
                </div>

                {/* 最後の1行: © と規約。狭い幅（320px）では規約が次の段へ折れる */}
                <div className="mt-10 flex flex-wrap items-center gap-x-5 border-t border-line pt-2">
                    <p className="m-0 text-[13px] leading-[18px] text-text-3">© Journey Photo</p>
                    <nav aria-label={en ? "Legal" : "規約"} className="flex flex-wrap items-center gap-x-5">
                        {legalLinks.map(({ href, label }) => (
                            <Link key={href} href={href} prefetch={false} className={linkClass} style={linkStyle}>{label}</Link>
                        ))}
                    </nav>
                </div>
            </div>
        </footer>
    );
}
