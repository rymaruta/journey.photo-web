import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import HomeSpotEntry from "../../../app/components/HomeSpotEntry";
import { homeSpotEntryData, CONTINENTS, OTHER_CONTINENT_NAME } from "../homeSpotEntry";
import { COUNTRY_SHARD_KEYS } from "../spotFeedShards";
import { spotAreas, spotIndexItemsForArea } from "../spotLink";
import { countryTopics, countryView, topicSpots, MIN_INDEXABLE_COUNTRY } from "../spotTopics";
import { PREFECTURES, prefectureByName } from "../prefectures";
import { ROUTES } from "../../routes";

/**
 * 2026-11-09: ホームの「観光スポットを県から探す」（`app/components/HomeSpotEntry.tsx`・SEO の入口・案A）。
 * 県・国への文字リンクを**書き出しの HTML に最初から出す**。ホーム → 県（国）→ スポットの2クリックで全スポットに届く。
 * 台帳を読むので node 環境で流す（`renderToStaticMarkup` は書き出しと同じ描き方）
 */
const data = homeSpotEntryData();
const html = renderToStaticMarkup(<HomeSpotEntry data={data} />);
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const text = html.replace(/<[^>]+>/g, " ");

describe("ホームの県から探す: リンクの集合", () => {
    it("リンクは、全県（0件を除く）＋頁が建つ全国と過不足なく一致する", () => {
        const expected = [
            ...spotAreas().filter((a) => a.region !== null).map((a) => ROUTES.SPOT_AREA(a.slug)),
            ...countryTopics().map((c) => ROUTES.SPOT_COUNTRY(c.code)),
        ];
        expect([...hrefs].sort()).toEqual([...expected].sort());
        expect(new Set(hrefs).size).toBe(hrefs.length); // 重複なし
        // 国内47都道府県（台帳に全県ある）・海外は頁の建つ国すべて
        expect(data.areas).toHaveLength(PREFECTURES.length);
        expect(hrefs.filter((h) => h.startsWith("/spots/area/overseas/"))).toHaveLength(countryTopics().length);
    });

    it("リンクの文字は「神奈川県の観光スポット」のように全部書く（件数は別の span）", () => {
        const labels = [...html.matchAll(/<a [^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
        expect(labels).toHaveLength(hrefs.length);
        for (const l of labels) expect(l).toMatch(/^.+の観光スポット \d+件$/);
        expect(labels).toContain("神奈川県の観光スポット 46件".replace("46", String(spotAreas().find((a) => a.slug === "kanagawa")!.count)));
    });

    it("最初から HTML に出る（折りたたまない・隠さない）", () => {
        // 眉ラベルの飾り（aria-hidden）は別。リンクを包む要素が隠れていないこと
        expect(html).not.toMatch(/<details|<summary|display:\s*none|(^|[\s"])hidden([\s"=]|$)|\bsr-only\b/);
        expect(html).not.toMatch(/aria-hidden="true"[^>]*>(<[^>]+>)*<a /);
        expect(html).toContain("href=\"/spots/area/kanagawa\"");
        expect(html).toContain("神奈川県の");
    });
});

describe("ホームの県から探す: 件数は行き先の頁と同じ", () => {
    it("県: リンクの件数 = 県の頁が並べるスポットの数（`spotIndexItemsForArea`）", () => {
        for (const [slug, n] of data.areas) {
            expect(n, slug).toBe(spotIndexItemsForArea(slug).length);
        }
    }, 120_000);

    it("国: リンクの件数 = 国の頁が並べるカードの数・導入文の「N件」", () => {
        for (const c of data.continents.flatMap((k) => k.countries)) {
            const [code, , n] = c;
            const view = countryView(code)!;
            expect(view.cards.length, code).toBe(n);
            expect(view.intro, code).toContain(`${n}件`);
        }
    }, 120_000);

    it("画面に出る件数の文字は data の件数と一致する", () => {
        const nums = new Map(data.areas);
        for (const p of PREFECTURES) {
            const m = html.match(new RegExp(`href="${ROUTES.SPOT_AREA(p.slug)}"[^>]*>.*?(\\d+)件</span>`));
            expect(Number(m?.[1]), p.slug).toBe(nums.get(p.slug));
        }
    });
});

describe("ホームの県から探す: 2クリックで全スポットに届く", () => {
    it("ホームの HTML のリンク先の頁が、公開の全スポットを並べている（県の頁／国の頁）", () => {
        const linkedAreas = new Set(hrefs.filter((h) => h.startsWith("/spots/area/") && !h.includes("/overseas/")).map((h) => h.split("/")[3]));
        const linkedCountries = new Set(hrefs.filter((h) => h.includes("/overseas/")).map((h) => h.split("/")[4]));
        const onArea = new Map<string, Set<string>>();
        for (const slug of linkedAreas) onArea.set(slug, new Set(spotIndexItemsForArea(slug).map((i) => i.slug)));
        const onCountry = new Map<string, Set<string>>();
        for (const code of linkedCountries) onCountry.set(code, new Set(countryView(code)!.cards.map((c) => c.slug)));

        const unreachable: string[] = [];
        for (const s of topicSpots()) {
            if (s.region?.country === "日本") {
                const area = prefectureByName(s.region?.prefecture)?.slug;
                if (!area || !onArea.get(area)?.has(s.slug)) unreachable.push(s.slug);
            } else {
                const code = COUNTRY_SHARD_KEYS[s.region?.country ?? ""];
                if (!code || !onCountry.get(code)?.has(s.slug)) unreachable.push(s.slug);
            }
        }
        expect(unreachable).toEqual([]);
    }, 120_000);

    it("🔴 1件だけの国（頁は noindex）もホームからリンクする——検索に出るハブから届かない唯一の入口", () => {
        const single = countryTopics().filter((c) => c.spots.length < MIN_INDEXABLE_COUNTRY);
        // 2026-11-09 時点: バチカン市国・ジンバブエ・モンゴルの各1件（`st-peters-basilica`・`victoria-falls`・`erdene-zuu-monastery`）
        for (const c of single) expect(hrefs, c.name).toContain(ROUTES.SPOT_COUNTRY(c.code));
    });
});

describe("ホームの県から探す: 大陸の分け表", () => {
    it("台帳が持つ国コードは全部、どれかの大陸にある（表に無い国が出たら落ちる）", () => {
        const placed = CONTINENTS.flatMap((k) => k.codes);
        expect(new Set(placed).size, "同じ国が2つの大陸に入っていない").toBe(placed.length);
        for (const [name, code] of Object.entries(COUNTRY_SHARD_KEYS)) expect(placed, name).toContain(code);
    });

    it("「その他の国・地域」は空（出たら大陸の表に足す）", () => {
        expect(data.continents.map((c) => c.name)).not.toContain(OTHER_CONTINENT_NAME);
    });

    it("国は大陸の中で件数の多い順（頁側の並びのまま）", () => {
        for (const k of data.continents) {
            const ns = k.countries.map((c) => c[2]);
            expect(ns).toEqual([...ns].sort((a, b) => b - a));
        }
    });
});

describe("ホームの県から探す: 作り・見た目の決まり", () => {
    it("名前つきの nav・節の見出し・地方ごとの見出し", () => {
        expect(html).toContain('<nav aria-labelledby="home-spot-entry-h"');
        expect(html).toContain('<section aria-labelledby="home-spot-entry-h"');
        expect(html).toMatch(/<h2 id="home-spot-entry-h"[^>]*>観光スポットを県から探す<\/h2>/);
        const h3 = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((m) => m[1]);
        expect(h3).toEqual([`国内（${data.areas.length}都道府県）`, `海外（${countryTopics().length}か国）`]);
        const h4 = [...html.matchAll(/<h4[^>]*>(.*?)<\/h4>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
        expect(h4.slice(0, 3)).toEqual(["北海道1道", "東北6都道府県", "関東7都道府県"]);
        expect(h4).toContain("ヨーロッパ" + `${data.continents[0].countries.length}か国`);
    });

    /** `globals.css` の `@utility <name> { ... }` の中身（入れ子の `@media` を含む） */
    const css = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");
    const utility = (name: string) => {
        const start = css.indexOf(`@utility ${name} {`);
        expect(start, `${name} が globals.css に在る`).toBeGreaterThan(-1);
        let depth = 0;
        for (let i = css.indexOf("{", start); i < css.length; i++) {
            if (css[i] === "{") depth++;
            if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
        }
        throw new Error(`${name} の閉じ括弧が無い`);
    };

    it("リンクは高さ 44 以上・真鍮の内側 2px の輪・白8%の下線・色だけに頼らない（件数と線）", () => {
        const anchors = [...html.matchAll(/<a [^>]*class="([^"]*)"/g)].map((m) => m[1]);
        expect(anchors).toHaveLength(hrefs.length);
        for (const c of anchors) expect(c).toBe("home-spot-link");
        const link = utility("home-spot-link");
        expect(link).toContain("min-height: 44px");
        expect(link).toContain("outline: 2px solid var(--color-accent)");
        expect(link).toContain("outline-offset: -2px");
        expect(link).toContain("border-bottom: 1px solid var(--color-line)");
        // 触ったときの変化（色だけでなく地も）
        expect(link).toMatch(/&:hover \{[^}]*color: #fff;[^}]*background-color: rgb\(255 255 255 \/ 0\.05\)/);
        // 件数は右端（sm 以上）。名前は 2 行に割る（電話）
        expect(link).toMatch(/@media \(min-width: 640px\) \{[^}]*justify-content: space-between/);
    });

    it("字は 12px 以上（名前 13・「観光スポット」12→13・件数 12）", () => {
        for (const n of ["home-spot-name", "home-spot-noun", "home-spot-count"]) {
            const sizes = [...utility(n).matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
            expect(sizes.length, n).toBeGreaterThan(0);
            for (const px of sizes) expect(px, n).toBeGreaterThanOrEqual(12);
        }
        expect(html).not.toMatch(/font-size:\s*1[01]px|text-\[1[01]px\]/);
    });

    it("400px で横にはみ出さない作り: 電話は 3 列・長い名前は折り返す・固定幅なし", () => {
        expect(html).toContain("grid-cols-3");
        expect(utility("home-spot-link")).toContain("overflow-wrap: anywhere");
        expect(html).not.toMatch(/(^|[\s"])w-\[\d+px\]|min-w-\[\d+px\]|whitespace-nowrap/);
        // 3 列の各列が 0 まで縮められる（長い名前で列が広がって行からはみ出さない）
        expect(html).toContain("grid-cols-3");
    });

    it("禁止語を画面に出さない（撮りどき・この場所・注目スポット・捨てる）", () => {
        for (const w of ["撮りどき", "この場所", "注目スポット", "捨てる"]) expect(text, w).not.toContain(w);
    });

    it("台帳（SPOTS）をクライアントへ渡さない: 部品は台帳の経路を値で import しない", () => {
        const src = readFileSync(join(__dirname, "../../../app/components/HomeSpotEntry.tsx"), "utf8");
        expect(src.startsWith('"use client"')).toBe(true);
        expect(src).not.toMatch(/^import(?!\s+type)[^;]*lib\/data\/(spots|spotLink|spotTopics|homeSpotEntry)"/m);
    });
});

describe("ホームの県から探す: ホームへの置き場", () => {
    it("`app/page.tsx` で、写真の並び（GalleryPageClient）の後ろ・同じ Page の中に置く", () => {
        const src = readFileSync(join(__dirname, "../../../app/page.tsx"), "utf8");
        const gallery = src.indexOf("<GalleryPageClient");
        const entry = src.indexOf("<HomeSpotEntry data={homeSpotEntryData()}");
        expect(gallery).toBeGreaterThan(-1);
        expect(entry).toBeGreaterThan(gallery);
    });
});
