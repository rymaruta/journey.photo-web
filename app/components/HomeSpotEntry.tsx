"use client";

// app/components/HomeSpotEntry.tsx
//
// **ホームの「撮影スポットを県から探す」の節**（2026-11-09・owner「任せる」・SEO の入口・案A）。
// 提案書（デザイナー・モック）: ホームの写真の並びの下・フッターの上に、国内の県と海外の国への
// 文字リンクを**最初から HTML に出す**（折りたたまない）。ホーム → 県（国）→ スポットの2クリックで全スポットに届く。
// ホームの上部（輪・札・タブ・写真）は変えない。
//
// 🔴 **クライアント部品にしているのは軽くするため**（`SpotTopicLists.tsx` と同じ判断）。サーバー部品で並べると
// RSC ペイロードに要素の木（クラス名ごと）が1本ずつ入り、HTML が二重に太る。ここで受け取るのは
// **県のスラッグ・件数と国の2文字・名前・件数だけ**（`lib/data/homeSpotEntry.ts` がビルド時に作る）。
// 県の名前・地方は `PREFECTURES`（台帳を読まない表）から引く。書き出しの HTML にリンクはそのまま出る。
//
// 文言は日本語だけ: 表示は日本語のみで（`LocaleProvider`）、英語版（`/en`）は無い。頁名そのものが日本語の検索語。
//
// 見た目（板「黒塗りの真鍮」・提案書のトークン）: 黒地。節の見出しは `SectionHead`（真鍮の眉＋明朝 22）。
// 地方・大陸の小見出しは 12・600・text-3（フッターの見出しと同じ）。リンクは text-2・13、触ると白。
// 件数は 12 の text-3。行は白8%の線で区切り、高さ 44 以上（行全体が当たり）。
// フォーカスの輪は真鍮の内側 2px。リンクと分かる手がかりは「行の形・右の件数・触ったときの変化」で、色だけに頼らない。
// 電話は 3 列（札は 2 行: 「神奈川県の」／「撮影スポット 46件」）、sm 以上は 1 行で 3 列・右端に件数、lg は左に地方名を置く。4 列にするのは xl（1280）から（1024 の 4 列だと長い国名が折り返した・Chromium で実測）。

import React from "react";
import Link from "next/link";
import type { HomeSpotEntryData } from "@/lib/data/homeSpotEntry";
import { PREFECTURES, REGIONS } from "@/lib/data/prefectures";
import { ROUTES } from "@/lib/routes";
import SectionHead from "./SectionHead";

const HEADING_ID = "home-spot-entry-h";

/** 1本のリンク: 「<名前>の撮影スポット」と件数。名前と「の撮影スポット」は途切れさせない（検索語の形） */
function Row({ href, name, count }: { href: string; name: string; count: number }) {
    return (
        <li>
            <Link href={href} prefetch={false} className="home-spot-link">
                {/* 電話は「名前の」と「撮影スポット 件数」の2行・sm 以上は1行で件数は右端（`globals.css` の `home-spot-*`） */}
                <span className="home-spot-text">
                    <span className="home-spot-name">{name}の</span>
                    <span className="home-spot-noun">撮影スポット</span>
                </span>
                {" "}
                <span className="home-spot-count">{count}件</span>
            </Link>
        </li>
    );
}

/** 地方・大陸ごとのひとまとまり。lg は左に見出し・右にリンク */
function Group({ name, sub, children }: { name: string; sub: string; children: React.ReactNode }) {
    return (
        <div className="lg:grid lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-x-6 lg:items-start" data-testid="home-spot-group">
            <h4 className="m-0 mt-[18px] mb-0.5 lg:mt-3.5 lg:mb-0 font-semibold text-text-3" style={{ fontSize: "12px", lineHeight: "16px", letterSpacing: "0.06em" }}>
                {name}
                <span className="ml-2 font-normal lg:block lg:ml-0 lg:mt-0.5">{sub}</span>
            </h4>
            <ul className="list-none m-0 p-0 grid grid-cols-3 gap-x-2 sm:gap-x-4 xl:grid-cols-4">{children}</ul>
        </div>
    );
}

const SUBHEAD_STYLE: React.CSSProperties = { fontSize: "15px", lineHeight: "20px" };

export default function HomeSpotEntry({ data }: { data: HomeSpotEntryData }) {
    const areaCount = new Map(data.areas);
    const countries = data.continents.reduce((n, c) => n + c.countries.length, 0);
    // 地方ごと（北から南）。0件の県は `data.areas` に無いので出ない・空の地方も作らない
    const regions = REGIONS.map((r) => ({
        name: r,
        items: PREFECTURES.filter((p) => p.region === r && areaCount.has(p.slug)),
    })).filter((g) => g.items.length > 0);
    return (
        <section aria-labelledby={HEADING_ID} className="mx-auto w-full max-w-5xl lg:max-w-6xl px-4 sm:px-6 md:px-8 pt-8 pb-10 text-white" data-testid="home-spot-entry">
            <SectionHead id={HEADING_ID} eyebrow="PHOTO SPOTS" title="撮影スポットを県から探す" className="mb-0" testId="home-spot-entry-head" />
            <p className="m-0 mt-2 text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>
                県や国を選ぶと、その撮影スポットが一覧で見られます。右の数字は掲載している件数です。
            </p>
            {/* id はホームの日本地図（`HomeJapanMap`）の「地図を飛ばして文字の一覧へ」「すべての県を文字で見る」の行き先 */}
            <nav aria-labelledby={HEADING_ID} id="home-spot-entry-list" className="scroll-mt-20">
                <h3 className="m-0 mt-7 pt-4 border-t border-line font-semibold text-white" style={SUBHEAD_STYLE}>国内（{data.areas.length}都道府県）</h3>
                {regions.map((g) => (
                    <Group key={g.name} name={g.name} sub={g.name === "北海道" ? "1道" : `${g.items.length}都道府県`}>
                        {g.items.map((p) => <Row key={p.slug} href={ROUTES.SPOT_AREA(p.slug)} name={p.name} count={areaCount.get(p.slug) ?? 0} />)}
                    </Group>
                ))}

                <h3 className="m-0 mt-7 pt-4 border-t border-line font-semibold text-white" style={SUBHEAD_STYLE}>海外（{countries}か国）</h3>
                {data.continents.map((c) => (
                    <Group key={c.name} name={c.name} sub={`${c.countries.length}か国`}>
                        {c.countries.map(([code, name, n]) => <Row key={code} href={ROUTES.SPOT_COUNTRY(code)} name={name} count={n} />)}
                    </Group>
                ))}
            </nav>
        </section>
    );
}
