"use client";

// app/components/HomeEntryBand.tsx
//
// **ホームの入口の帯**（2026-11-09 owner「任せる」・デザイナーの提案書 4b の(a)）。
// 上段の札・アプリの札の下、切り替え（おすすめ／フォロー中／新着）の上に、文字リンクを1行。
// 検索から来た人（ホームの人は約17%）が「ここは何のサイトか・次にどこへ行けるか」を最初の画面で見つけられるように。
//
// - **写真の並びは動かさない・短くしない**（最初の HTML の写真リンク52本を保つ）。ホームの上部の並び
//   （輪・札・タブ・写真）は iOS と同じまま、帯だけ Web 用に足す。
// - **最初の HTML の文字リンク**（`next/link`）。ボタンにしない。先読みしない。
// - 4つ目は出し分ける: 未ログイン＝「ログイン」・ログイン中＝「行きたい場所」（`ROUTES.SAVED_SPOTS`・既に持っている入口。
//   ログイン済みの人に「ログイン」は不要で、「マイページ」は下のタブに在る。アプリの案内は直上の札が持つので重ねない）。
//   **判定中は4つ目を出さない**（ログイン済みの人に一瞬「ログイン」が見えないように・`HeaderNav` と同じ）。
// - 形: 押せるチップ（`chipStyles`）。高さ 44px・字 13px（本文系の最小 12 以上）。写真の無い黒地なので真鍮の輪。
// - 数える: `nav_click`（area=home_entry・dest=spots/map/search/login/saved。「県から探す」の節は dest=area で区別）。

import React from "react";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import type { NavDest } from "../../lib/utils/analytics";
import { CHIP_OFF, CHIP_SIZE, CHIP_ROW } from "./chipStyles";
import TrackedLink from "./TrackedLink";

export default function HomeEntryBand({ className = "" }: { className?: string }) {
    const { isAuthenticated, loading } = useAuth();
    const { locale } = useLocale();
    const en = locale === "en";
    const items: Array<{ href: string; label: string; dest: NavDest }> = [
        { href: ROUTES.SPOTS, label: en ? "Photo spots" : "撮影スポット", dest: "spots" },
        { href: ROUTES.MAP, label: en ? "Map" : "地図", dest: "map" },
        { href: ROUTES.SEARCH, label: en ? "Search" : "探す", dest: "search" },
    ];
    if (!loading) {
        items.push(isAuthenticated
            ? { href: ROUTES.SAVED_SPOTS, label: en ? "Want to go" : "行きたい場所", dest: "saved" }
            : { href: ROUTES.LOGIN, label: en ? "Log in" : "ログイン", dest: "login" });
    }
    return (
        <nav aria-label={en ? "Explore the site" : "サイトの入口"} data-testid="home-entry-band" className={className}>
            <ul className={CHIP_ROW} style={{ listStyle: "none" }}>
                {items.map((it) => (
                    <li key={it.href}>
                        <TrackedLink
                            href={it.href}
                            navArea="home_entry"
                            navDest={it.dest}
                            className={`inline-flex items-center rounded-full ${CHIP_OFF} transition-colors`}
                            style={{ ...CHIP_SIZE, minHeight: "44px", touchAction: "manipulation" }}
                        >
                            {it.label}
                        </TrackedLink>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
