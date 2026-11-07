"use client";

import type React from "react";
import Link from "next/link";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import { OVERSEAS_SLUG } from "../../lib/data/prefectures";
import AppInstallCard from "./AppInstallCard";

export default function Footer() {
    const { locale, labels } = useLocale();
    const navLabels = labels.navigation || {};
    const links = [
        { href: ROUTES.HOME, label: navLabels.works || (locale === "en" ? "Works" : "作品") },
        { href: ROUTES.MAP, label: navLabels.map || (locale === "en" ? "Map" : "撮影地マップ") },
        { href: ROUTES.SPOTS, label: locale === "en" ? "Photo spots" : "撮影スポット" },
        { href: ROUTES.LEARN, label: locale === "en" ? "Photography guides" : "写真とカメラの教科書" },
        // 構図ガイド（2026-11-05）: ホーム・ヘッダー・フッターのどこからも直接は行けなかった（教科書の頁の中だけ）
        { href: ROUTES.COMPOSITION, label: locale === "en" ? "Composition guide" : "構図ガイド" },
        { href: ROUTES.FAVORITES, label: navLabels.favorites || (locale === "en" ? "Liked Photos" : "いいねした写真") },
        { href: ROUTES.SAVES, label: navLabels.saves || (locale === "en" ? "Saved Photos" : "保存した写真") },
        { href: ROUTES.SAVED_SPOTS, label: locale === "en" ? "Want to go" : "行きたい場所" },
    ];
    // 規約。サイトのリンクとは別の組にして、3つの縦の組の左端をそろえる
    const legalLinks = [
        { href: ROUTES.TERMS, label: locale === "en" ? "Terms" : "利用規約" },
        { href: ROUTES.PRIVACY, label: locale === "en" ? "Privacy" : "プライバシーポリシー" },
    ];

    // 撮影スポットの切り口への入口（2026-11-05 owner「WEB版をもっと認知してもらいたい」）。
    // 3,000 件を超える撮影スポットと、その「○選」の頁へ、どの頁の下からも1クリックで入れる。
    // 検索エンジンの巡回の入口にもなる（ヘッダーのメニューはボタンでリンクではない）
    const spotLinks = [
        { href: ROUTES.SPOT_SAKURA(), label: locale === "en" ? "Cherry blossoms" : "桜の撮影スポット" },
        { href: ROUTES.SPOT_MOMIJI(), label: locale === "en" ? "Autumn foliage" : "紅葉の撮影スポット" },
        { href: ROUTES.SPOT_SNOW(), label: locale === "en" ? "Snow scenery" : "雪景色の撮影スポット" },
        { href: ROUTES.SPOT_SEASON("spring"), label: locale === "en" ? "Spring" : "春の撮影スポット" },
        { href: ROUTES.SPOT_SEASON("summer"), label: locale === "en" ? "Summer" : "夏の撮影スポット" },
        { href: ROUTES.SPOT_SEASON("autumn"), label: locale === "en" ? "Autumn" : "秋の撮影スポット" },
        { href: ROUTES.SPOT_SEASON("winter"), label: locale === "en" ? "Winter" : "冬の撮影スポット" },
        { href: ROUTES.SPOT_AREA(OVERSEAS_SLUG), label: locale === "en" ? "Outside Japan" : "海外の撮影スポット" },
        { href: ROUTES.SPOTS, label: locale === "en" ? "All photo spots" : "撮影スポットの一覧" },
    ];
    const linkClass = "inline-flex min-h-[44px] items-center justify-start text-left text-text-2 transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
    const linkStyle: React.CSSProperties = { fontSize: "13px", lineHeight: "18px", touchAction: "manipulation" };
    const headingClass = "m-0 mb-1 font-semibold text-text-3";
    const headingStyle: React.CSSProperties = { fontSize: "12px", lineHeight: "16px", letterSpacing: "0.06em" };

    return (
        <footer className="border-t border-line bg-bg" style={{ paddingBottom: "var(--page-bar-h, 0px)" }}>
            {/* **左揃え**（2026-11-06 owner「フッターの左揃えなどの整列感大事にして」）。
                以前は全部が中央揃えで、行ごとに左端がばらついていた。いまは
                ご案内の札 → ブランド（左）｜リンクの3つの組（右）。3つの組は見出しと各リンクの左端が縦にそろい、
                電話の幅は1列に積んで、どの行も同じ左端から始まる */}
            <div className="mx-auto max-w-5xl px-6 py-10 text-left md:px-8 md:py-12">
                <AppInstallCard placement="banner" />

                <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12">
                    <div className="flex flex-col items-start gap-3">
                        <div className="inline-flex items-center gap-3">
                            {/* ヘッダー・アプリアイコンと共通の公式アパーチャロゴ */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/logo-aperture.png" alt="" aria-hidden="true" width={40} height={40} decoding="async" className="h-9 w-9 flex-shrink-0" />
                            <p className="m-0 font-wordmark text-[26px] font-semibold tracking-tight text-white">Journey Photo</p>
                        </div>
                        <p className="m-0 text-[15px] leading-[22px] text-text-2">
                            {locale === "en" ? "Moments that move someone's next journey." : "旅の一瞬を、誰かの次の旅へ。"}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6">
                        <nav aria-label={locale === "en" ? "Footer" : "フッター"} className="flex flex-col items-start">
                            <p className={headingClass} style={headingStyle}>{locale === "en" ? "Site" : "サイト"}</p>
                            {links.map(({ href, label }) => (
                                <Link key={href} href={href} prefetch={false} className={linkClass} style={linkStyle}>{label}</Link>
                            ))}
                        </nav>

                        <nav
                            aria-label={locale === "en" ? "Find photo spots" : "撮影スポットをさがす"}
                            className="flex flex-col items-start"
                            data-testid="footer-spot-links"
                        >
                            <p className={headingClass} style={headingStyle}>{locale === "en" ? "Photo spots" : "撮影スポット"}</p>
                            {spotLinks.map(({ href, label }) => (
                                <Link key={href} href={href} prefetch={false} className={linkClass} style={linkStyle}>{label}</Link>
                            ))}
                        </nav>

                        <nav aria-label={locale === "en" ? "Legal" : "規約"} className="flex flex-col items-start">
                            <p className={headingClass} style={headingStyle}>{locale === "en" ? "Legal" : "規約"}</p>
                            {legalLinks.map(({ href, label }) => (
                                <Link key={href} href={href} prefetch={false} className={linkClass} style={linkStyle}>{label}</Link>
                            ))}
                        </nav>
                    </div>
                </div>

                <div className="mt-10 border-t border-line pt-6">
                    <p className="m-0 text-[13px] leading-[18px] text-text-3">© Journey Photo</p>
                </div>
            </div>
        </footer>
    );
}
