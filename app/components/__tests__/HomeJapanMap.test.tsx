import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import HomeJapanMap from "../HomeJapanMap";
import HomeSpotEntry from "../HomeSpotEntry";
import { homeSpotEntryData, homeMapTopSpots, HOME_MAP_TOP_N } from "../../../lib/data/homeSpotEntry";
import { spotAreas, spotIndexItemsForArea } from "../../../lib/data/spotLink";
import { PREFECTURES } from "../../../lib/data/prefectures";
import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "../../../lib/data/prefectureShapes";
import { LABEL_DESIGN_PX, PREFECTURE_LABELS } from "../../../lib/data/prefectureLabels";
import { inShape } from "../../../lib/utils/__tests__/shapeGeometry";
import { readMapReturn, saveMapReturn } from "../../../lib/utils/mapReturn";
import { ROUTES } from "../../../lib/routes";

/**
 * 2026-11-09: ホームの日本地図（`HomeJapanMap`・デザイナーの提案書 案D+A）。
 * 47県が本物のリンク・件数は頁側と一致・静的 HTML に href が出る・禁止語なし・SVG が太らない・置き場（タブより上）・操作。
 */
const data = homeSpotEntryData();
const tops = homeMapTopSpots();
const html = renderToStaticMarkup(<HomeJapanMap areas={data.areas} tops={tops} />);
const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const NAME = new Map(PREFECTURES.map((p) => [p.slug, p.name]));

const links = [...html.matchAll(/<a ([^>]*data-s="([a-z]+)"[^>]*)>/g)].map((m) => ({ attrs: m[1], slug: m[2] }));

describe("日本地図: 47県のリンクは頁側と一致", () => {
    it("県ごとに本物の <a href>・行き先は県の頁・47本・重複なし・文字の一覧（HomeSpotEntry）と同じ集合", () => {
        expect(links).toHaveLength(47);
        const hrefs = links.map((l) => l.attrs.match(/href="([^"]+)"/)?.[1]);
        expect(new Set(hrefs).size).toBe(47);
        const listHtml = renderToStaticMarkup(<HomeSpotEntry data={data} />);
        const listAreaHrefs = [...listHtml.matchAll(/href="(\/spots\/area\/[a-z]+)"/g)].map((m) => m[1]);
        expect([...hrefs].sort()).toEqual([...listAreaHrefs].sort());
        expect([...hrefs].sort()).toEqual(spotAreas().filter((a) => a.region !== null).map((a) => ROUTES.SPOT_AREA(a.slug)).sort());
    });

    it("読み上げの名前は「神奈川県の撮影スポット、N件」で、N は県の頁が並べる件数", () => {
        for (const [slug, n] of data.areas) {
            const l = links.find((x) => x.slug === slug)!;
            expect(l.attrs, slug).toContain(`aria-label="${NAME.get(slug)}の撮影スポット、${n}件"`);
            expect(n, slug).toBe(spotIndexItemsForArea(slug).length);
        }
    }, 120_000);

    it("静的 HTML（JS なし）では 47 本とも tabindex 無し＝ふつうに Tab で届くリンク", () => {
        for (const l of links) expect(l.attrs).not.toContain("tabindex");
    });

    it("先頭に「地図を飛ばして文字の一覧へ」・地図の下に「すべての県を文字で見る」・どちらも文字の一覧（HomeSpotEntry の nav）へ", () => {
        expect(html).toContain("地図を飛ばして文字の一覧へ");
        expect(html).toContain("すべての県を文字で見る");
        const listHtml = renderToStaticMarkup(<HomeSpotEntry data={data} />);
        expect(listHtml).toContain('id="home-spot-entry-list"');
        expect(html.match(/href="#home-spot-entry-list"/g)).toHaveLength(2);
        expect(html.indexOf("地図を飛ばして")).toBeLessThan(html.indexOf("<svg"));
        expect(html.indexOf("すべての県を文字で見る")).toBeGreaterThan(html.indexOf("</svg>"));
    });

    it("禁止語（撮りどき・この場所・注目スポット）を画面にも読み上げにも出さない", () => {
        const text = html.replace(/<[^>]+>/g, " ") + (html.match(/aria-label="[^"]*"/g) ?? []).join(" ");
        for (const w of ["撮りどき", "この場所", "注目スポット", "捨て"]) expect(text, w).not.toContain(w);
    });
});

describe("日本地図: HTML が太らない", () => {
    it("SVG 全体は 44,000 バイト・gzip 12,000 バイト以下（県名を足す前は約37KB・gzip 約10.7KB。県名で約 +5KB・gzip +0.6KB・実測 42.2KB / 11.3KB）", () => {
        const svg = html.match(/<svg[\s\S]*<\/svg>/)![0];
        expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(44_000);
        expect(gzipSync(svg).length).toBeLessThanOrEqual(12_000);
    });

    it("県の形は defs に1回だけ（<use> で使い回す・パスの二重書きが無い）", () => {
        expect(html.match(/<path /g)).toHaveLength(47);
        expect((html.match(/<use /g) ?? []).length).toBeLessThan(47 * 3 + 5);
    });
});

describe("日本地図: 置き場（写真のタブより上）と文字の一覧の保持", () => {
    const gallery = read("app/GalleryPageClient.tsx");
    const page = read("app/page.tsx");

    it("GalleryPageClient: 地図はアプリの案内の下・写真のタブ（StickyTabRow）より上に出る", () => {
        const at = gallery.indexOf('surface === "home" && entryMap');
        expect(at).toBeGreaterThan(gallery.indexOf('<AppInstallCard placement="home"'));
        expect(at).toBeLessThan(gallery.indexOf("<StickyTabRow"));
        expect(at).toBeLessThan(gallery.indexOf('role="tablist"'));
    });

    it("page.tsx: 地図は1か所だけ組み込み、文字リンクの一覧（HomeSpotEntry）は今の位置（GalleryPageClient の後）に残る", () => {
        expect(page.match(/<HomeJapanMap /g)).toHaveLength(1);
        expect(page).toContain("entryMap={<HomeJapanMap areas={homeSpotEntryData().areas} tops={homeMapTopSpots()} />}");
        expect(page.indexOf("<HomeSpotEntry data={homeSpotEntryData()} />")).toBeGreaterThan(page.indexOf("<GalleryPageClient"));
    });

    it("検索には search 面（surface=search）に地図を出さない: 出すのは home だけ", () => {
        expect(gallery).toContain('surface === "home" && entryMap');
    });
});

describe("日本地図: CSS（当たりと縦スクロール）", () => {
    const css = read("app/globals.css");
    it("当たりは塗りだけ（pointer-events: fill）。all だと細い県の中を隣が奪う（Chromium で東京都の 28%）", () => {
        expect(css).toMatch(/\.jm-hit\s*\{[^}]*pointer-events:\s*fill/);
        expect(css).toMatch(/rect\.jm-hit\s*\{\s*pointer-events:\s*all/);
    });
    it("縁の当たり（halo）は 10px の見えない太い線", () => {
        expect(css).toMatch(/\.jm-halo\s*\{[^}]*stroke:\s*transparent;\s*stroke-width:\s*10px/);
    });
    it("縦スクロールを奪わない: 拡大前は touch-action: pan-y・拡大中だけ none", () => {
        expect(css).toMatch(/\.jm-wrap\s*\{[^}]*touch-action:\s*pan-y/);
        expect(css).toMatch(/\.jm-wrap\.jm-zoomed\s*\{\s*touch-action:\s*none/);
    });
    it("地図の幅は画面の 7 割の高さまで（スマホで縦長が画面を埋めない・県名が読める幅は残す）", () => {
        expect(css).toMatch(/\.jm-wrap\s*\{[^}]*72svh/);
    });
    it("拡大のボタンは左上（沖縄の枠は右下）・44px", () => {
        expect(css).toMatch(/\.jm-zc\s*\{[^}]*left:\s*8px;\s*top:\s*8px/);
        expect(css).toMatch(/\.jm-zb\s*\{\s*width:\s*44px;\s*height:\s*44px/);
    });
});

describe("日本地図: 県名（常に載る・12px 以上・重ならない）", () => {
    const names = [...html.matchAll(/<text class="jm-name"[^>]*>([^<]*)<\/text>/g)];
    const shortName = (slug: string) => (slug === "hokkaido" ? "北海道" : NAME.get(slug)!.replace(/[県府都]$/, ""));

    it("沖縄以外の46県すべてに名前があり、字は県名（県・府・都を除く）と一致する（北海道だけ全部）", () => {
        const labelled = PREFECTURE_LABELS.map((l) => l[0]).sort();
        expect(labelled).toEqual(PREFECTURE_SHAPES.map((x) => x[0]).filter((x) => x !== "okinawa").sort());
        for (const l of PREFECTURE_LABELS) expect(l[1], l[0]).toBe(shortName(l[0]));
    });

    it("静的 HTML に県名が出る（縦書きは1字ずつ）・字の大きさは画面で 12px 以上（拡大前は 12px）", () => {
        const chars = PREFECTURE_LABELS.reduce((n, l) => n + (l[2] === "h" ? 1 : [...l[1]].length), 0);
        expect(names).toHaveLength(chars);
        // 字の大きさは名前の層の `--jm-fs`（1単位 = 1px の拡大前は 12px）。CSS の `.jm-name` がそれを読む
        expect(html).toMatch(/class="jm-names" style="--jm-fs:12px;--jm-sw:3px"/);
        expect(read("app/globals.css")).toMatch(/\.jm-name\s*\{[^}]*font-size:\s*var\(--jm-fs, 12px\)/);
        const text = names.map((m) => m[1]).join("");
        for (const l of PREFECTURE_LABELS) for (const c of l[1]) expect(text, l[0]).toContain(c);
    });

    it("字は読み上げに出さない（県のリンクの名前が読まれる）: 県名の層は aria-hidden", () => {
        const container = document.createElement("div");
        container.innerHTML = html;
        const layer = container.querySelector('g[data-label="hokkaido"]')!.parentElement!;
        expect(layer.getAttribute("aria-hidden")).toBe("true");
        expect(html).not.toMatch(/<text class="jm-name"[^>]*aria-label/);
    });

    it("設計の縮尺（0.9px/単位・字 12px）で、字どうしが重ならず、地図の外・沖縄の枠にかからない", () => {
        const fs = 12 / LABEL_DESIGN_PX;
        const rects = PREFECTURE_LABELS.map((l) => {
            const n = [...l[1]].length;
            const w = (l[2] === "h" ? n * fs : fs * 1.12) / 2, h = (l[2] === "h" ? fs * 1.12 : n * fs) / 2;
            return { slug: l[0], x0: l[3] - w, y0: l[4] - h, x1: l[3] + w, y1: l[4] + h };
        });
        const [fx, fy, fw, fh] = OKINAWA_FRAME;
        for (const r of rects) {
            expect(r.x0, r.slug).toBeGreaterThanOrEqual(0);
            expect(r.y0, r.slug).toBeGreaterThanOrEqual(0);
            expect(r.x1, r.slug).toBeLessThanOrEqual(MAP_W);
            expect(r.y1, r.slug).toBeLessThanOrEqual(MAP_H);
            expect(r.x0 < fx + fw && fx < r.x1 && r.y0 < fy + fh && fy < r.y1, `${r.slug} が沖縄の枠にかかる`).toBe(false);
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1, `${a.slug} と ${b.slug} の字が重なる`).toBe(false);
        }
    });

    it("県の中に置いた字は自分の県に四分の一以上かかる。海へ出した字は県にほとんどかからず、引き出し線の先は自分の県の中", () => {
        const fs = 12 / LABEL_DESIGN_PX;
        let outside = 0;
        for (const l of PREFECTURE_LABELS) {
            const n = [...l[1]].length;
            const w = (l[2] === "h" ? n * fs : fs * 1.12) / 2, h = (l[2] === "h" ? fs * 1.12 : n * fs) / 2;
            let mine = 0, other = 0, total = 0;
            for (let x = l[3] - w; x <= l[3] + w; x += 1.5) for (let y = l[4] - h; y <= l[4] + h; y += 1.5) {
                total++;
                if (inShape(l[0], [x, y])) mine++;
                else if (PREFECTURE_SHAPES.some((q) => q[0] !== l[0] && inShape(q[0], [x, y]))) other++;
            }
            // どの字も、ほかの県の上に半分以上は載らない（縁取りで読めるが、どの県の字か紛れる）
            expect(other / total, `${l[0]} の字が別の県の上に載りすぎる`).toBeLessThanOrEqual(0.55);
            if (l[5] === null || l[6] === null) {
                expect(mine / total, `${l[0]} の字が自分の県にかからない`).toBeGreaterThanOrEqual(0.25);
            } else {
                outside++;
                expect(mine / total, `${l[0]} は海に出す字なのに県の上に載りすぎる`).toBeLessThan(0.25);
                expect(inShape(l[0], [l[5], l[6]]), `${l[0]} の引き出し線の先が県の外`).toBe(true);
            }
        }
        // 小さな県（関東・近畿・瀬戸内）が実際に引き出されている（全部が県の上に載っていない）
        expect(outside).toBeGreaterThanOrEqual(15);
    });

    it("字は白・黒の縁取り（地の色によらず読める）・クリックを奪わない", () => {
        const css = read("app/globals.css");
        expect(css).toMatch(/\.jm-name\s*\{[^}]*fill:\s*#fff;[^}]*paint-order:\s*stroke;\s*stroke:\s*#000/);
        expect(css).toMatch(/\.jm-name\s*\{[^}]*pointer-events:\s*none/);
    });

    it("海へ出した字は県のリンクの当たりにもなる（JS が効いたあと・県の形の当たり以外に rect が1つ増える）。JS 前の HTML には出さない", () => {
        const stat = document.createElement("div");
        stat.innerHTML = html;
        expect(stat.querySelectorAll("a[data-s] rect.jm-hit")).toHaveLength(1); // 沖縄の枠だけ
        cleanup();
        render(<HomeJapanMap areas={data.areas} tops={tops} />);
        for (const l of PREFECTURE_LABELS) {
            const a = document.querySelector(`a[data-s="${l[0]}"]`)!;
            expect(a.querySelectorAll("rect.jm-hit").length, l[0]).toBe(l[5] !== null ? 1 : 0);
        }
    });
});

describe("日本地図: 県ごとの上位の数件（静的データ）", () => {
    it(`国内の全県に 1〜${HOME_MAP_TOP_N} 件・その県のスポットだけ・名前と市区町村だけ`, () => {
        for (const [slug, n] of data.areas) {
            const t = tops[slug];
            expect(t, slug).toBeDefined();
            expect(t.length, slug).toBe(Math.min(n, HOME_MAP_TOP_N));
            const inArea = new Set(spotIndexItemsForArea(slug).map((x) => x.slug));
            for (const row of t) {
                expect(row, slug).toHaveLength(3);
                expect(inArea.has(row[0]), `${slug}: ${row[0]}`).toBe(true);
            }
            expect(new Set(t.map((r) => r[0])).size, slug).toBe(t.length);
        }
    }, 120_000);

    it("並びは「公開済み → 代表写真あり → 台帳の並び」。公開済みがあるのに下書きが先頭に来ない", () => {
        for (const [slug] of data.areas) {
            const items = spotIndexItemsForArea(slug);
            const rank = (x: (typeof items)[number]) => (x.stage === "published" ? 0 : 2) + (x.cover ? 0 : 1);
            const best = Math.min(...items.map(rank));
            const first = items.find((x) => x.slug === tops[slug][0][0])!;
            expect(rank(first), slug).toBe(best);
        }
    }, 120_000);

    it("ホームに足すバイトは小さい（47県ぶんで 16,000 バイト以下）", () => {
        expect(Buffer.byteLength(JSON.stringify(tops))).toBeLessThanOrEqual(16_000);
    });

    it("静的 HTML には一覧を出さない（閉じた状態・県を押すまで何も出ない）", () => {
        expect(html).not.toContain('data-testid="home-japan-map-spots"');
        expect(html).toContain('data-open="false"');
    });
});

describe("日本地図: CSS（一覧のシート）", () => {
    const css = read("app/globals.css");
    it("スマホは地図の下に貼り付く（sticky・下のタブの上）・閉じているあいだは出さない", () => {
        expect(css).toMatch(/@media \(max-width: 639\.98px\) \{\s*\.jm-sheet \{[^}]*position:\s*sticky;\s*bottom:\s*calc\(var\(--bottom-bar-h, 84px\) \+ 8px\)/);
        expect(css).toMatch(/\.jm-sheet\[data-open="false"\]\s*\{\s*display:\s*none/);
    });
    it("画面からはみ出さない: 高さは画面の半分まで・中は縦にスクロール", () => {
        expect(css).toMatch(/\.jm-sheet \{[^}]*max-height:\s*50svh;\s*overflow-y:\s*auto/);
    });
    it("押す所は 44px 以上: 閉じる 44×44・スポットの行 48px・すべて見る 52px", () => {
        expect(css).toMatch(/\.jm-close\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
        expect(css).toMatch(/\.jm-spot\s*\{[^}]*min-height:\s*48px/);
        expect(css).toMatch(/\.jm-open\s*\{[^}]*min-height:\s*52px/);
    });
    it("動きを減らす設定ではシートの動きを止める", () => {
        expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.jm-sheet \{ animation: none/);
    });
});

describe("日本地図: 操作（DOM）", () => {
    const mount = () => {
        cleanup();
        return render(<HomeJapanMap areas={data.areas} tops={tops} />);
    };
    const link = (slug: string) => document.querySelector<SVGAElement>(`a[data-s="${slug}"]`)!;
    const panel = () => screen.getByTestId("home-japan-map-panel");
    const isOpen = () => panel().getAttribute("data-open") === "true";
    const histLen = () => window.history.length;
    beforeEach(() => {
        cleanup();
        window.history.replaceState(null, "", "/");
    });

    it("起動後は止まり先が1か所（北海道だけ tabindex 0・ほかは -1）", () => {
        mount();
        expect(document.querySelectorAll('a[data-s][tabindex="0"]')).toHaveLength(1);
        expect(link("hokkaido").getAttribute("tabindex")).toBe("0");
        expect(document.querySelectorAll('a[data-s][tabindex="-1"]')).toHaveLength(46);
    });

    it("県を押すと頁を移動せず、その場に県名・件数・上位のスポット・「すべて見る」が出る（大きな県も小さな県も同じ）", () => {
        mount();
        expect(isOpen()).toBe(false);
        for (const slug of ["osaka", "hokkaido"]) {
            const ok = fireEvent.click(link(slug), { detail: 1 });
            expect(ok, slug).toBe(false); // preventDefault＝リンクの移動を止めた
            expect(isOpen(), slug).toBe(true);
            expect(panel().textContent).toContain(NAME.get(slug)!);
            expect(panel().textContent).toContain(`撮影スポット ${new Map(data.areas).get(slug)}件`);
            const rows = screen.getByTestId("home-japan-map-spots").querySelectorAll("a");
            expect(rows).toHaveLength(tops[slug].length);
            tops[slug].forEach((t, i) => {
                expect(rows[i].getAttribute("href")).toBe(`/spots/${t[0]}`);
                expect(rows[i].textContent).toContain(t[1]);
            });
            expect(screen.getByTestId("home-japan-map-open").getAttribute("href")).toBe(`/spots/area/${slug}`);
            expect(screen.getByTestId("home-japan-map-open").textContent).toContain(`${NAME.get(slug)}の撮影スポットをすべて見る`);
            fireEvent.click(link(slug), { detail: 1 }); // 閉じる
        }
    });

    it("選んだ県は aria-expanded=true（ほかは false）・地図の県に強調の class。読み上げの名前は変えない", () => {
        mount();
        fireEvent.click(link("osaka"), { detail: 1 });
        expect(link("osaka").getAttribute("aria-expanded")).toBe("true");
        expect(document.querySelectorAll('a[data-s][aria-expanded="true"]')).toHaveLength(1);
        expect(document.querySelectorAll("use.jm-sel")).toHaveLength(1);
        expect(document.querySelector('g[data-label="osaka"]')!.getAttribute("class")).toContain("jm-lab-sel");
        expect(link("osaka").getAttribute("aria-label")).toBe(`大阪府の撮影スポット、${new Map(data.areas).get("osaka")}件`);
    });

    it("別の県を押すとその場で切り替わる・同じ県をもう一度押すと閉じる", () => {
        mount();
        fireEvent.click(link("osaka"), { detail: 1 });
        fireEvent.click(link("kyoto"), { detail: 1 });
        expect(isOpen()).toBe(true);
        expect(panel().textContent).toContain("京都府");
        expect(panel().textContent).not.toContain("大阪府の撮影スポットをすべて");
        fireEvent.click(link("kyoto"), { detail: 1 });
        expect(isOpen()).toBe(false);
        expect(document.querySelectorAll("use.jm-sel")).toHaveLength(0);
    });

    it("閉じるボタン・Esc で閉じ、焦点は県のリンクへ戻る。閉じているときの Esc は何もしない", () => {
        mount();
        fireEvent.click(link("osaka"), { detail: 1 });
        fireEvent.click(screen.getByTestId("home-japan-map-close"));
        expect(isOpen()).toBe(false);
        expect(document.activeElement).toBe(link("osaka"));
        fireEvent.click(link("kyoto"), { detail: 1 });
        fireEvent.keyDown(link("kyoto"), { key: "Escape" });
        expect(isOpen()).toBe(false);
        fireEvent.keyDown(link("kyoto"), { key: "Escape" });
        expect(isOpen()).toBe(false);
    });

    it("キーボード: Enter（detail 0）で一覧が開き焦点が一覧へ移る・Esc で閉じて県へ戻る。矢印は開かずに焦点だけ動く", () => {
        mount();
        link("hokkaido").focus();
        fireEvent.keyDown(link("hokkaido"), { key: "ArrowDown" });
        expect(document.activeElement?.getAttribute("data-s")).toBe("aomori");
        expect(isOpen()).toBe(false); // 焦点が動いただけでは開かない
        fireEvent.click(link("aomori"), { detail: 0 });
        expect(isOpen()).toBe(true);
        expect(document.activeElement).toBe(panel());
        fireEvent.keyDown(panel(), { key: "Escape" });
        expect(isOpen()).toBe(false);
        expect(document.activeElement).toBe(link("aomori"));
    });

    it("新しいタブ・修飾キーつきのクリックは本物のリンクとして県の頁へ（一覧は開かない）", () => {
        mount();
        const ok = fireEvent.click(link("osaka"), { detail: 1, ctrlKey: true });
        expect(ok).toBe(true);
        expect(isOpen()).toBe(false);
        expect(link("osaka").getAttribute("href")).toBe("/spots/area/osaka");
    });

    it("近くの県のボタンで県が切り替わる", () => {
        mount();
        fireEvent.click(link("osaka"), { detail: 1 });
        const btns = panel().querySelectorAll(".jm-near button");
        expect(btns).toHaveLength(3);
        fireEvent.click(btns[0]);
        expect(panel().textContent).not.toContain("大阪府の撮影スポットをすべて見る");
        expect(isOpen()).toBe(true);
    });

    it("海のタップ（県の縁の太い当たり）でもその県の一覧が開く", () => {
        mount();
        const halo = document.querySelector<SVGElement>('use.jm-halo[data-s="kagawa"]')!;
        fireEvent.click(halo, { detail: 1 });
        expect(panel().textContent).toContain("香川県");
    });

    describe("URL（#pref=…）と戻る", () => {
        it("開くと #pref=<slug> が付き履歴が1件増える・切り替えは差し替え（増えない）・閉じると戻して消える", async () => {
            mount();
            const n0 = histLen();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(window.location.hash).toBe("#pref=osaka");
            expect(histLen()).toBe(n0 + 1);
            fireEvent.click(link("kyoto"), { detail: 1 });
            expect(window.location.hash).toBe("#pref=kyoto");
            expect(histLen()).toBe(n0 + 1);
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            await waitFor(() => expect(isOpen()).toBe(false));
            expect(window.location.hash).toBe("");
        });

        it("ブラウザの戻る（popstate）で一覧が閉じ、進むで同じ県が開く", async () => {
            mount();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(isOpen()).toBe(true);
            window.history.back();
            await waitFor(() => expect(isOpen()).toBe(false));
            expect(window.location.hash).toBe("");
            window.history.forward();
            await waitFor(() => expect(isOpen()).toBe(true));
            expect(panel().textContent).toContain("大阪府");
        });

        it("#pref=<slug> で開いた頁は、その県の一覧が開いた状態で始まる（一覧の頁から戻ったとき・共有）", async () => {
            window.history.replaceState(null, "", "/#pref=kagawa");
            mount();
            await waitFor(() => expect(isOpen()).toBe(true));
            expect(panel().textContent).toContain("香川県");
            expect(link("kagawa").getAttribute("aria-expanded")).toBe("true");
            // URL から開いたものを閉じても、履歴は積み直さず ハッシュだけ外す
            const n0 = histLen();
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            await waitFor(() => expect(isOpen()).toBe(false));
            expect(window.location.hash).toBe("");
            expect(histLen()).toBe(n0);
        });

        it("知らない県・形の違う値の #pref は無視（閉じたまま）", async () => {
            window.history.replaceState(null, "", "/#pref=atlantis");
            mount();
            await new Promise((r) => setTimeout(r, 20));
            expect(isOpen()).toBe(false);
        });

        it("履歴の state に Next の内部の印を持ち越す（戻ったとき Next の popstate が再読込に落ちない）", () => {
            window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["x"] }, "", "/");
            mount();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(window.history.state.__NA).toBe(true);
            expect(window.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(["x"]);
        });
    });

    describe("地図へ戻る（位置と県の覚え）", () => {
        beforeEach(() => { sessionStorage.clear(); });

        it("「すべて見る」「スポット」を押す直前に、県とスクロール位置を覚える（頁を離れる前）", () => {
            mount();
            Object.defineProperty(window, "scrollY", { value: 398, configurable: true });
            fireEvent.click(link("kanagawa"), { detail: 1 });
            fireEvent.click(screen.getByTestId("home-japan-map-open"), { detail: 1 });
            expect(readMapReturn()).toEqual(expect.objectContaining({ pref: "kanagawa", y: 398 }));
            sessionStorage.clear();
            fireEvent.click(screen.getByTestId("home-japan-map-spots").querySelector("a")!, { detail: 1 });
            expect(readMapReturn()).toEqual(expect.objectContaining({ pref: "kanagawa", y: 398 }));
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
        });

        it("覚えのある県の #pref で開くと、位置がずれていれば覚えの位置へ寄せる。触れたあとは動かさない", async () => {
            saveMapReturn("kanagawa", 398);
            window.history.replaceState(null, "", "/#pref=kanagawa");
            const spy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
            mount();
            await waitFor(() => expect(spy).toHaveBeenCalledWith({ top: 398, behavior: "auto" }));
            spy.mockClear();
            // すでにその位置（ブラウザの復元が効いた）なら動かさない
            cleanup();
            Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
            mount();
            await new Promise((r) => setTimeout(r, 450));
            expect(spy).not.toHaveBeenCalled();
            // 触れたら以後は寄せない
            cleanup();
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
            mount();
            fireEvent.wheel(window);
            await new Promise((r) => setTimeout(r, 450));
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
        });

        it("別の県の覚えは使わない。覚えが無い #pref（共有リンク）は、先頭にいるとき地図の頭へ寄せる", async () => {
            saveMapReturn("osaka", 999);
            window.history.replaceState(null, "", "/#pref=kanagawa");
            const spy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
            mount();
            await waitFor(() => expect(spy).toHaveBeenCalled());
            expect(spy).not.toHaveBeenCalledWith({ top: 999, behavior: "auto" });
            spy.mockRestore();
        });

        it("閉じると覚えを消す（閉じたあとに戻ってきても開き直さない）", () => {
            mount();
            fireEvent.click(link("kanagawa"), { detail: 1 });
            saveMapReturn("kanagawa", 10);
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            expect(readMapReturn()).toBeNull();
        });

        it("bfcache で戻った（pageshow の persisted）とき、ハッシュと食い違っていたら合わせる", async () => {
            mount();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(isOpen()).toBe(true);
            window.history.replaceState(null, "", "/");
            window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
            await waitFor(() => expect(isOpen()).toBe(false));
        });
    });

    it("拡大: ＋で viewBox が狭まり、全体で戻る・上限と下限でボタンが無効", () => {
        mount();
        const svg = document.querySelector("svg.jm")!;
        expect(svg.getAttribute("viewBox")).toMatch(/^0\.0 0\.0 360\.0 /);
        const inB = screen.getByLabelText("拡大") as HTMLButtonElement;
        const outB = screen.getByLabelText("縮小") as HTMLButtonElement;
        const resetB = screen.getByLabelText("全体に戻す") as HTMLButtonElement;
        expect(outB.disabled).toBe(true);
        expect(resetB.disabled).toBe(true);
        fireEvent.click(inB);
        expect(Number(svg.getAttribute("viewBox")!.split(" ")[2])).toBeCloseTo(225, 0);
        expect(document.querySelector(".jm-wrap")!.className).toContain("jm-zoomed");
        for (let i = 0; i < 5; i++) fireEvent.click(inB);
        expect(Number(svg.getAttribute("viewBox")!.split(" ")[2])).toBeCloseTo(90, 0);
        expect(inB.disabled).toBe(true);
        fireEvent.click(resetB);
        expect(svg.getAttribute("viewBox")).toMatch(/^0\.0 0\.0 360\.0 /);
        expect(document.querySelector(".jm-wrap")!.className).not.toContain("jm-zoomed");
    });

    it("拡大しても県名の字は画面で 12px のまま（単位で割る）・県名は拡大中も全部出る", () => {
        mount();
        const size = () => parseFloat(document.querySelector<SVGGElement>("g.jm-names")!.style.getPropertyValue("--jm-fs"));
        expect(size()).toBeCloseTo(12, 5);
        fireEvent.click(screen.getByLabelText("拡大"));
        expect(size()).toBeCloseTo(12 / 1.6, 5); // 1 単位 = 1.6 倍の px。単位で 12/1.6 ＝ 画面で 12px
        expect(document.querySelectorAll("g[data-label]")).toHaveLength(46);
    });

    it("拡大のボタンは左上の置き場（DOM では地図の後ろ・Tab で地図の次）", () => {
        mount();
        const svg = document.querySelector("svg.jm")!;
        const zc = document.querySelector(".jm-zc")!;
        expect(svg.compareDocumentPosition(zc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("件数の濃淡は初期オフ。チェックで色の段と凡例が出る", () => {
        mount();
        const cb = screen.getByLabelText("件数の濃淡を付ける") as HTMLInputElement;
        expect(cb.checked).toBe(false);
        expect(document.querySelector(".jm-dens")).toBeNull();
        expect(screen.queryByTestId("home-japan-map-legend")).toBeNull();
        fireEvent.click(cb);
        expect(document.querySelector(".jm-dens")).not.toBeNull();
        expect(document.querySelectorAll('use[class*="jm-b"]').length).toBe(47);
        expect(screen.getByTestId("home-japan-map-legend").querySelectorAll("span")).toHaveLength(4);
    });

    describe("計測 nav_click（area=home_entry）", () => {
        const sent = () => (window as unknown as { gtag: ReturnType<typeof vi.fn> }).gtag.mock.calls.filter((c) => c[1] === "nav_click").map((c) => { const { area, dest } = c[2] as Record<string, string>; return { area, dest }; });
        beforeEach(() => {
            (window as unknown as { gtag: unknown }).gtag = vi.fn();
            sessionStorage.clear();
        });

        it("県を押した（map_pref_select）と一覧を開いた（map_sheet_open）: 最初の1回は両方・切り替えは select だけ・閉じる押下も select", () => {
            mount();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(sent().map((c) => c.dest)).toEqual(["map_pref_select", "map_sheet_open"]);
            fireEvent.click(link("kyoto"), { detail: 1 });
            expect(sent().map((c) => c.dest)).toEqual(["map_pref_select", "map_sheet_open", "map_pref_select"]);
            fireEvent.click(link("kyoto"), { detail: 1 }); // 閉じる
            expect(sent()).toHaveLength(4);
            fireEvent.click(link("kyoto"), { detail: 1 }); // 開き直す
            expect(sent().map((c) => c.dest).slice(4)).toEqual(["map_pref_select", "map_sheet_open"]);
            for (const c of sent()) {
                expect(c.area).toBe("home_entry");
                expect(JSON.stringify(c)).not.toMatch(/osaka|kyoto|spots/);
            }
        });

        it("「すべて見る」は map_pref・一覧のスポットは map_spot。県名・slug・URL は送らない", () => {
            mount();
            fireEvent.click(link("osaka"), { detail: 1 });
            const base = sent().length;
            fireEvent.click(screen.getByTestId("home-japan-map-open"), { detail: 1 });
            fireEvent.click(screen.getByTestId("home-japan-map-spots").querySelector("a")!, { detail: 1 });
            expect(sent().slice(base)).toEqual([
                { area: "home_entry", dest: "map_pref" },
                { area: "home_entry", dest: "map_spot" },
            ]);
        });

        it("新しいタブ・修飾キーつきで県の頁へ行く押し方は map_pref（一覧は開かない・select も数えない）", () => {
            mount();
            fireEvent.click(link("osaka"), { detail: 1, ctrlKey: true });
            expect(sent()).toEqual([{ area: "home_entry", dest: "map_pref" }]);
        });

        it("拡大・濃淡・閉じるボタン・Esc は数えない", () => {
            mount();
            fireEvent.click(screen.getByLabelText("拡大"));
            fireEvent.click(screen.getByLabelText("件数の濃淡を付ける"));
            fireEvent.click(link("osaka"), { detail: 1 });
            const base = sent().length;
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            fireEvent.click(link("kyoto"), { detail: 1 });
            fireEvent.keyDown(link("kyoto"), { key: "Escape" });
            // 数えるのは kyoto を押した1回（閉じてから開いたので select と open）だけ。閉じるボタンと Esc は数えない
            expect(sent().slice(base).map((c) => c.dest)).toEqual(["map_pref_select", "map_sheet_open"]);
        });
    });
});
