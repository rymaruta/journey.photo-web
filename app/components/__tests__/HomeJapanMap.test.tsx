import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import HomeJapanMap from "../HomeJapanMap";
import HomeSpotEntry from "../HomeSpotEntry";
import { homeSpotEntryData } from "../../../lib/data/homeSpotEntry";
import { spotAreas, spotIndexItemsForArea } from "../../../lib/data/spotLink";
import { PREFECTURES } from "../../../lib/data/prefectures";
import { ROUTES } from "../../../lib/routes";

/**
 * 2026-11-09: ホームの日本地図（`HomeJapanMap`・デザイナーの提案書 案D+A）。
 * 47県が本物のリンク・件数は頁側と一致・静的 HTML に href が出る・禁止語なし・SVG が太らない・置き場（タブより上）・操作。
 */
const data = homeSpotEntryData();
const html = renderToStaticMarkup(<HomeJapanMap areas={data.areas} />);
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
    it("SVG 全体は 40,000 バイト・gzip 12,000 バイト以下（提案書の目標 約37KB・gzip 約10.7KB）", () => {
        const svg = html.match(/<svg[\s\S]*<\/svg>/)![0];
        expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(40_000);
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
        expect(page).toContain("entryMap={<HomeJapanMap areas={homeSpotEntryData().areas} />}");
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
    it("地図の幅は画面の 6 割の高さまで（スマホで縦長が画面を埋めない）", () => {
        expect(css).toMatch(/\.jm-wrap\s*\{[^}]*60svh/);
    });
    it("拡大のボタンは左上（沖縄の枠は右下）・44px", () => {
        expect(css).toMatch(/\.jm-zc\s*\{[^}]*left:\s*8px;\s*top:\s*8px/);
        expect(css).toMatch(/\.jm-zb\s*\{\s*width:\s*44px;\s*height:\s*44px/);
    });
});

describe("日本地図: 操作（DOM）", () => {
    const mount = () => {
        cleanup();
        return render(<HomeJapanMap areas={data.areas} />);
    };
    const link = (slug: string) => document.querySelector<SVGAElement>(`a[data-s="${slug}"]`)!;
    const panel = () => screen.getByTestId("home-japan-map-panel");

    it("起動後は止まり先が1か所（北海道だけ tabindex 0・ほかは -1）", () => {
        mount();
        expect(document.querySelectorAll('a[data-s][tabindex="0"]')).toHaveLength(1);
        expect(link("hokkaido").getAttribute("tabindex")).toBe("0");
        expect(document.querySelectorAll('a[data-s][tabindex="-1"]')).toHaveLength(46);
    });

    it("小さな県を押すと札（名前・件数・近くの県3つ・見るリンク）が出て、移動しない", () => {
        mount();
        const ok = fireEvent.click(link("osaka"), { detail: 1 });
        expect(ok).toBe(false); // preventDefault＝リンクの移動を止めた
        expect(panel().textContent).toContain("大阪府");
        expect(panel().textContent).toContain(`撮影スポット ${new Map(data.areas).get("osaka")}件`);
        expect(screen.getByTestId("home-japan-map-open").getAttribute("href")).toBe("/spots/area/osaka");
        expect(panel().querySelectorAll("button")).toHaveLength(3);
        // 近くの県を押すと札がその県に替わる
        fireEvent.click(panel().querySelectorAll("button")[0]);
        expect(panel().textContent).not.toContain("大阪府の撮影スポットを見る");
    });

    it("44px 以上の県（北海道）は札を出さずそのまま移動に任せる／キーボードの Enter（detail 0）は小さな県でも移動", () => {
        mount();
        fireEvent.click(link("hokkaido"), { detail: 1 });
        expect(panel().textContent).toContain("県を選ぶと");
        fireEvent.click(link("osaka"), { detail: 0 });
        expect(panel().textContent).toContain("県を選ぶと");
        // Ctrl+クリック（新しいタブ）も札を出さない
        fireEvent.click(link("osaka"), { detail: 1, ctrlKey: true });
        expect(panel().textContent).toContain("県を選ぶと");
    });

    it("矢印キーで隣の県へ焦点が動く・Esc で札が閉じる", () => {
        mount();
        link("hokkaido").focus();
        fireEvent.keyDown(link("hokkaido"), { key: "ArrowDown" });
        expect(document.activeElement?.getAttribute("data-s")).toBe("aomori");
        fireEvent.click(link("osaka"), { detail: 1 });
        expect(panel().textContent).toContain("大阪府");
        fireEvent.keyDown(link("osaka"), { key: "Escape" });
        expect(panel().textContent).toContain("県を選ぶと");
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

    describe("計測 nav_click（area=home_entry・dest=map_pref）", () => {
        const sent = () => (window as unknown as { gtag: ReturnType<typeof vi.fn> }).gtag.mock.calls.filter((c) => c[1] === "nav_click");
        beforeEach(() => {
            (window as unknown as { gtag: unknown }).gtag = vi.fn();
            sessionStorage.clear();
        });

        it("移動する押し方（大きな県・Enter・Ctrl+クリック）だけ数え、札を出すだけの押下は数えない。県名・URL は送らない", () => {
            mount();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(sent()).toHaveLength(0);
            fireEvent.click(link("hokkaido"), { detail: 1 });
            fireEvent.click(link("osaka"), { detail: 0 });
            fireEvent.click(link("osaka"), { detail: 1, ctrlKey: true });
            expect(sent()).toHaveLength(3);
            for (const c of sent()) {
                expect(c[2]).toEqual(expect.objectContaining({ area: "home_entry", dest: "map_pref" }));
                expect(JSON.stringify(c[2])).not.toMatch(/osaka|hokkaido|spots/);
            }
        });

        it("札の「見る」も数える", () => {
            mount();
            fireEvent.click(link("osaka"), { detail: 1 });
            fireEvent.click(screen.getByTestId("home-japan-map-open"), { detail: 1 });
            expect(sent()).toHaveLength(1);
        });

        it("拡大・濃淡・近くの県は数えない", () => {
            mount();
            fireEvent.click(screen.getByLabelText("拡大"));
            fireEvent.click(screen.getByLabelText("件数の濃淡を付ける"));
            fireEvent.click(link("osaka"), { detail: 1 });
            fireEvent.click(panel().querySelectorAll("button")[0]);
            expect(sent()).toHaveLength(0);
        });
    });
});
