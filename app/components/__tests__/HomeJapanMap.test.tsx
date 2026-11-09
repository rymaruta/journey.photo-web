import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, fireEvent, screen, cleanup, waitFor, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import HomeJapanMap from "../HomeJapanMap";
import HomeSpotEntry from "../HomeSpotEntry";
import { homeSpotEntryData, homeMapTopSpots, HOME_MAP_TOP_N } from "../../../lib/data/homeSpotEntry";
import { spotAreas, spotIndexItemsForArea } from "../../../lib/data/spotLink";
import { PREFECTURES } from "../../../lib/data/prefectures";
import { MAP_H, MAP_W, OKINAWA_FRAME } from "../../../lib/data/prefectureShapes";
import { viewFor, type RegionName } from "../../../lib/utils/japanMapView";
import { readMapReturn, saveMapReturn } from "../../../lib/utils/mapReturn";
import { ROUTES } from "../../../lib/routes";

// 計測の呼び出しを見る・当たりの計算を壊せるようにする（安全策のテスト）
const trackMock = vi.hoisted(() => vi.fn());
const brokenHit = vi.hoisted(() => ({ on: false }));
vi.mock("../../../lib/utils/analytics", async (orig) => ({ ...(await orig<typeof import("../../../lib/utils/analytics")>()), track: trackMock }));
vi.mock("../../../lib/utils/japanMapHit", async (orig) => {
    const m = await orig<typeof import("../../../lib/utils/japanMapHit")>();
    return {
        ...m,
        hitAt: (...a: Parameters<typeof m.hitAt>) => { if (brokenHit.on) throw new Error("boom"); return m.hitAt(...a); },
        pickHit: (...a: Parameters<typeof m.pickHit>) => { if (brokenHit.on) throw new Error("boom"); return m.pickHit(...a); },
    };
});

/**
 * 2026-11-09: ホームの日本地図（`HomeJapanMap`・案C「地方 → 県・長押し/横寄りでなぞる・離して選択」の作り直し・仕様の正本はデザイナーの提案書 v4）。
 * 47県が本物のリンク・件数は頁側と一致・静的 HTML に href が出る・禁止語なし・SVG が太らない・置き場（タブより上）・操作（地方チップ・タップ・なぞり・一覧・キーボード・URL と戻る）。
 * なぞり判定の状態機械は `lib/utils/__tests__/traceGesture.test.ts`、当たり判定は `japanMapHit.test.ts`、実ブラウザ（本物のタッチ入力）は `scripts/e2e-smoke.mjs`。
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

describe("日本地図: CSS（なぞり・当たり・縦スクロール）", () => {
    const css = read("app/globals.css");
    const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    it("縦スクロールは奪わない: 地図は touch-action: pan-y（横寄りの動きだけ JS が受ける）。常に pan-y で、none にしない", () => {
        expect(rule(".jm-wrap")).toMatch(/touch-action:\s*pan-y/);
        expect(rule(".jm")).toMatch(/touch-action:\s*pan-y/);
        expect(css).not.toMatch(/\.jm-wrap[^{]*\{[^}]*touch-action:\s*none/);
    });
    it("長押しで選択・メニュー・拡大鏡が出ない（user-select・-webkit-touch-callout）", () => {
        expect(rule(".jm-wrap")).toMatch(/user-select:\s*none/);
        expect(rule(".jm-wrap")).toMatch(/-webkit-touch-callout:\s*none/);
    });
    it("県の面は自前の当たり判定で取る: リンクの形は当たりを持たない（pointer-events: none）・見た目の形も当たらない", () => {
        expect(css).toMatch(/\.jm a, \.jm a \* \{[^}]*pointer-events:\s*none/);
        expect(css).not.toMatch(/\.jm-halo/);
    });
    it("🔴 縁の太さは画面の px で一定: 県の形は <path> を直に置き（<use> の写しには vector-effect が効かず、関東の拡大で触れた県の白 2px が約 10px になった・2026-11-09 実測）、CSS で non-scaling-stroke", () => {
        expect(css).toMatch(/\.jm-sh, \.jm-ring \{ vector-effect: non-scaling-stroke; \}/);
        expect(html.match(/<path [^>]*class="jm-sh /g)).toHaveLength(47);
        // 県のリンクの当たりの箱は <rect>（<use> で形を写すと、写しが jm-sh の塗りを持って上から描き直し、触れた・選んだ県の色を隠した・2026-11-09 実測）
        expect(html).not.toContain("<use ");
        expect(html.match(/<rect class="jm-hit"/g)).toHaveLength(47);
    });
    it("指の輪 54px・札は高さ 56px・幅 112px 以上・固定欄 36px・地方チップは 44px", () => {
        expect(rule(".jm-finger, .jm-prog")).toMatch(/width:\s*54px;\s*height:\s*54px/);
        expect(rule(".jm-tip")).toMatch(/min-width:\s*112px;\s*height:\s*56px/);
        expect(rule(".jm-bar")).toMatch(/height:\s*36px/);
        expect(rule(".jm-rchip")).toMatch(/min-height:\s*44px;\s*min-width:\s*44px/);
    });
    it("動きを減らす設定では、地図の色の変化の動き・長押しの輪の一周を止める", () => {
        expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.jm-sh, \.jm-frame \{ transition: none; \} \.jm-prog\.go circle \{ animation-duration: 1ms/);
    });
});

describe("日本地図: 県名（全国は地方名・拡大した地方は県の中に 14px）", () => {
    it("静的 HTML（全国の画面）に地方名 8 つと「沖縄県」が出る・県名（46）は拡大するまで出さない・引き出し線は無い", () => {
        for (const r of ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州"]) expect(html).toContain(`data-r="${r}">${r}</text>`);
        expect(html).toContain('data-r="沖縄">沖縄県</text>');
        expect(html).not.toContain("jm-lead");
        expect(html).not.toContain('class="jm-name"');
    });

    it("字は読み上げに出さない（県のリンクの名前が読まれる）: 名前の層は aria-hidden", () => {
        expect(html).toMatch(/<g aria-hidden="true" class="jm-names"/);
    });

    it("拡大した地方では、その地方の県の名前が県の中に 14px で出る（縦書きは 1 字ずつ）", async () => {
        const { container } = mountFresh();
        fireEvent.click(screen.getByRole("button", { name: "関東" }));
        const labels = [...container.querySelectorAll("g[data-label]")];
        expect(labels.map((g) => g.getAttribute("data-label")).sort()).toEqual(["chiba", "gunma", "ibaraki", "kanagawa", "saitama", "tochigi", "tokyo"]);
        for (const g of labels) {
            const t = [...g.querySelectorAll("text.jm-name")].map((x) => x.textContent).join("");
            const slug = g.getAttribute("data-label")!;
            expect(NAME.get(slug)!.startsWith(t), slug).toBe(true);
        }
        const css = read("app/globals.css");
        expect(css).toMatch(/\.jm-name\s*\{[^}]*font-size:\s*var\(--jm-fs/);
        expect(container.querySelector("g.jm-names")!.getAttribute("style")).toMatch(/--jm-fs:\s*[\d.]+px/);
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

describe("日本地図: CSS（下の帯＝常設の枠 164px・再生バー・広い画面）", () => {
    const css = read("app/globals.css");
    it("スマホは地図の下に貼り付く常設の枠（高さ 164px・押し出さない）。下のタブと再生バー（--mini-player-h）のぶん上がる", () => {
        expect(css).toMatch(/@media \(max-width: 767\.98px\) \{\s*\.jm-sheet \{[^}]*position:\s*sticky;\s*bottom:\s*calc\(var\(--bottom-bar-h, 84px\) \+ var\(--mini-player-h, 0px\) \+ 8px\)[^}]*height:\s*164px;\s*overflow:\s*hidden/);
    });
    it("押す所は 44px 以上: 閉じる 44×44・スポットの行 48px", () => {
        expect(css).toMatch(/\.jm-close\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
        expect(css).toMatch(/\.jm-spot\s*\{[^}]*min-height:\s*48px/);
    });
    it("押せる状態の見えない部品（地方チップ・一覧チップ・閉じる）は、焦点の輪が真鍮 2px", () => {
        expect(css).toMatch(/\.jm-rchip:focus-visible, \.jm-tlink:focus-visible \{ outline: 2px solid var\(--color-accent\)/);
    });
});

/* ───────── 操作（DOM） ───────── */

// 地図の幅は 358px（390px 画面の左右 16px）。DOM に寸法が無いので、svg の寸法を差し込む
const W = 358;
const TOP = 100;
const mockRect = () => {
    const svg = document.querySelector("svg.jm") as SVGSVGElement;
    const h = (W * MAP_H) / MAP_W;
    svg.getBoundingClientRect = () => ({ left: 0, top: TOP, width: W, height: h, right: W, bottom: TOP + h, x: 0, y: TOP, toJSON() { return {}; } }) as DOMRect;
};
/** 地図の座標（viewBox の単位）→ 画面の px。いまの画面（全国・地方）の viewBox で換算 */
const px = (ux: number, uy: number): [number, number] => {
    const stage = screen.getByTestId("home-japan-map-wrap").getAttribute("data-stage");
    const v = viewFor(stage === "all" ? null : (stage as RegionName));
    const k = W / v.w;
    return [(ux - v.x) * k, TOP + (uy - v.y) * k];
};
const wrapEl = () => screen.getByTestId("home-japan-map-wrap");
const stageOf = () => wrapEl().getAttribute("data-stage");
const panelEl = () => screen.getByTestId("home-japan-map-panel");
const isOpen = () => panelEl().getAttribute("data-open") === "true";
const tipEl = () => screen.getByTestId("home-japan-map-tip");
const tipText = () => (tipEl().hidden ? null : tipEl().textContent);
const link = (slug: string) => document.querySelector<SVGAElement>(`a[data-s="${slug}"]`)!;
const mountFresh = () => {
    cleanup();
    const r = render(<HomeJapanMap areas={data.areas} tops={tops} />);
    mockRect();
    return r;
};
const ptr = (type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", x: number, y: number, o: { id?: number; kind?: string } = {}) =>
    fireEvent[type](wrapEl(), { pointerId: o.id ?? 1, pointerType: o.kind ?? "touch", clientX: x, clientY: y, button: 0, isPrimary: true });
const settle = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const tap = async (x: number, y: number) => {
    ptr("pointerDown", x, y); await settle(60); ptr("pointerUp", x, y);
    fireEvent.click(wrapEl(), { clientX: x, clientY: y, detail: 1 });
};
const FLAG = JSON.stringify({ shown: 2, traced: true, visits: 5 });

describe("日本地図: 操作（地方チップ・タップ・なぞり・一覧）", () => {
    beforeEach(() => {
        cleanup();
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        window.history.replaceState(null, "", "/");
        sessionStorage.clear();
        localStorage.setItem("jm-hint", FLAG);
        trackMock.mockClear();
        brokenHit.on = false;
        window.matchMedia = ((q: string) => ({ matches: /reduce/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    });
    afterEach(() => { vi.useRealTimers(); });

    it("起動: 全国・地方チップは「全国」＋ 9 つ（実ボタン）・全国が選択中・枠は「県を選ぶ」・一覧への近道がある", () => {
        mountFresh();
        const chips = [...screen.getByTestId("home-japan-map-chips").querySelectorAll("button")];
        expect(chips.map((c) => c.textContent)).toEqual(["全国", "北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州", "沖縄"]);
        expect(chips[0].getAttribute("aria-pressed")).toBe("true");
        expect(stageOf()).toBe("all");
        expect(isOpen()).toBe(false);
        expect(panelEl().textContent).toContain("県を選ぶ");
        expect(screen.getAllByText(/県の一覧から選ぶ/).length).toBeGreaterThan(0);
    });

    it("地方チップ: 関東を押すと拡大して開く（履歴は積まない・URL は変わらない）。読み上げに「関東を拡大。7県」。全国で戻る", async () => {
        mountFresh();
        const n0 = window.history.length;
        fireEvent.click(screen.getByRole("button", { name: "関東" }));
        expect(stageOf()).toBe("関東");
        expect(screen.getByTestId("home-japan-map-status").textContent).toBe("関東を拡大。7県。");
        expect(window.history.length).toBe(n0);
        expect(window.location.hash).toBe("");
        expect(isOpen()).toBe(false);
        expect(screen.getByRole("button", { name: "関東" }).getAttribute("aria-pressed")).toBe("true");
        expect(panelEl().textContent).toContain("関東の県");
        // 拡大した地方の外の県は沈む
        expect(document.querySelectorAll("path.jm-dim").length).toBe(40);
        fireEvent.click(screen.getByRole("button", { name: "全国" }));
        expect(stageOf()).toBe("all");
        expect(document.querySelectorAll("path.jm-dim").length).toBe(0);
    });

    it("北海道・沖縄のチップは拡大せず、直接その県を選ぶ（帯が開く）", () => {
        mountFresh();
        fireEvent.click(screen.getByRole("button", { name: "北海道" }));
        expect(stageOf()).toBe("all");
        expect(isOpen()).toBe(true);
        expect(panelEl().textContent).toContain("北海道");
        fireEvent.click(screen.getByRole("button", { name: "沖縄" }));
        expect(panelEl().textContent).toContain("沖縄県");
        expect(window.location.hash).toBe("#pref=okinawa");
    });

    it("タップ（click で確定）: 全国で関東の上をひと押し → 関東が拡大（県は選ばない）。続けて東京の上をひと押し → 東京を選ぶ", async () => {
        mountFresh();
        await tap(...px(240, 252));
        expect(stageOf()).toBe("関東");
        expect(isOpen()).toBe(false);
        await settle(500); // 直前の確定から 400ms 空ける（二重の click を弾く窓）
        await tap(...px(228.5, 255));
        expect(isOpen()).toBe(true);
        expect(panelEl().textContent).toContain("東京都");
        expect(window.location.hash).toBe("#pref=tokyo");
    });

    it("🔴 pointerup では確定しない（慣性スクロールを指で止めただけで地方が開かない）: 押して離すだけで click が来なければ何も起きない", async () => {
        mountFresh();
        const [x, y] = px(240, 252);
        ptr("pointerDown", x, y); await settle(60); ptr("pointerUp", x, y);
        await settle(600);
        expect(stageOf()).toBe("all");
        // その後に click が来れば（タップ候補が 500ms 以内なら）開く。500ms を過ぎた click は使わない
        fireEvent.click(wrapEl(), { clientX: x, clientY: y, detail: 1 });
        expect(stageOf()).toBe("all");
    });

    it("海をタップ: 遠い海は何も起きない・開いた帯は閉じる", async () => {
        mountFresh();
        await tap(...px(40, 100));
        expect(stageOf()).toBe("all");
        expect(isOpen()).toBe(false);
        fireEvent.click(screen.getByRole("button", { name: "北海道" }));
        expect(isOpen()).toBe(true);
        await settle(500);
        await tap(...px(40, 100));
        expect(isOpen()).toBe(false);
    });

    it("沖縄の枠の中をタップすると沖縄を選ぶ（拡大しない）", async () => {
        mountFresh();
        await tap(...px(OKINAWA_FRAME[0] + OKINAWA_FRAME[2] / 2, OKINAWA_FRAME[1] + OKINAWA_FRAME[3] / 2));
        expect(stageOf()).toBe("all");
        expect(panelEl().textContent).toContain("沖縄県");
    });

    describe("なぞり", () => {
        it("長押し: 249ms ではまだ・250ms でなぞり開始。札は地方名と県数。離すと地方が開く（県は選ばない）", async () => {
            mountFresh();
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y);
            await settle(249);
            expect(wrapEl().className).not.toContain("jm-tracing");
            expect(tipText()).toBeNull();
            await settle(1);
            expect(wrapEl().className).toContain("jm-tracing");
            expect(tipText()).toBe("関東7県");
            expect(screen.getByTestId("home-japan-map-bar").textContent).toContain("関東");
            ptr("pointerUp", x, y);
            expect(stageOf()).toBe("関東");
            expect(isOpen()).toBe(false);
            expect(tipText()).toBeNull();
            expect(wrapEl().className).not.toContain("jm-tracing");
        });

        it("全国のなぞりの札は地方名（北海道・沖縄だけ県名）", async () => {
            mountFresh();
            const [x, y] = px(290, 60);
            ptr("pointerDown", x, y);
            await settle(260);
            expect(tipText()).toContain("北海道");
            ptr("pointerUp", x, y);
            expect(isOpen()).toBe(true);
        });

        it("横寄りに 8pt 超動かすと、長押しを待たずになぞり開始。縦寄りは始まらない（スクロールに任せる）", async () => {
            mountFresh();
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y); ptr("pointerMove", x + 12, y + 2);
            expect(wrapEl().className).toContain("jm-tracing");
            ptr("pointerUp", x + 12, y + 2);
            cleanup();
            mountFresh();
            ptr("pointerDown", x, y); ptr("pointerMove", x + 2, y + 12);
            expect(wrapEl().className).not.toContain("jm-tracing");
            ptr("pointerCancel", x + 2, y + 12); // ブラウザがスクロールを始めた
            await settle(1000);
            expect(wrapEl().className).not.toContain("jm-tracing");
            expect(stageOf()).toBe("all");
        });

        it("縦寄りなのに 120ms 経っても pointercancel が来ないときは、なぞり開始", async () => {
            mountFresh();
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y); ptr("pointerMove", x + 2, y + 12);
            await settle(119);
            expect(wrapEl().className).not.toContain("jm-tracing");
            await settle(1);
            expect(wrapEl().className).toContain("jm-tracing");
        });

        it("拡大した地方の中で、横になぞって離す: 画面に見えていた県を選ぶ（札の県＝選ばれる県）", async () => {
            mountFresh();
            fireEvent.click(screen.getByRole("button", { name: "関東" }));
            const [x, y] = px(222, 262);
            ptr("pointerDown", x, y);
            ptr("pointerMove", x + 20, y);
            const shown = tipText()!;
            expect(shown).toMatch(/県|都|府/);
            ptr("pointerMove", x + 60, y);
            const shown2 = tipText()!;
            ptr("pointerUp", x + 60, y);
            expect(isOpen()).toBe(true);
            const sel = panelEl().querySelector("h3")!.textContent!;
            expect(shown2.startsWith(sel)).toBe(true);
            expect(window.location.hash).toMatch(/^#pref=/);
        });

        it("地図の外へ出ると札が「離すと取り消し」に変わり、そこで離すと取り消し（選択は変わらない）", async () => {
            mountFresh();
            fireEvent.click(screen.getByRole("button", { name: "北海道" }));
            const hash0 = window.location.hash;
            await settle(500);
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y);
            await settle(260);
            ptr("pointerMove", x, TOP - 40); // 地図の上の外
            expect(tipText()).toContain("離すと取り消し");
            expect(tipEl().className).toContain("jm-cancel");
            ptr("pointerUp", x, TOP - 40);
            expect(stageOf()).toBe("all");
            expect(window.location.hash).toBe(hash0);
            expect(tipText()).toBeNull();
        });

        it("2 本目の指でなぞりを取り消す（選択は変わらない）", async () => {
            mountFresh();
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y);
            await settle(260);
            expect(wrapEl().className).toContain("jm-tracing");
            ptr("pointerDown", x + 80, y + 80, { id: 2 });
            expect(wrapEl().className).not.toContain("jm-tracing");
            ptr("pointerUp", x + 80, y + 80, { id: 2 });
            ptr("pointerUp", x, y);
            expect(stageOf()).toBe("all");
        });

        it("pointercancel（通話・システム操作）で取り消し", async () => {
            mountFresh();
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y);
            await settle(260);
            ptr("pointerCancel", x, y);
            expect(wrapEl().className).not.toContain("jm-tracing");
            expect(stageOf()).toBe("all");
        });

        it("なぞり中だけ touchmove の既定動作（スクロール）を止める。なぞっていないときは止めない", async () => {
            mountFresh();
            const move = () => { const e = new Event("touchmove", { bubbles: true, cancelable: true }); wrapEl().dispatchEvent(e); return e.defaultPrevented; };
            expect(move()).toBe(false);
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y);
            await settle(260);
            expect(move()).toBe(true);
            ptr("pointerUp", x, y);
            expect(move()).toBe(false);
        });

        it("マウスは押さなくても名前の札が出る（輪は出ない）・押してなぞるのは同じ", async () => {
            mountFresh();
            const [x, y] = px(240, 252);
            ptr("pointerMove", x, y, { kind: "mouse" });
            expect(tipText()).toBe("関東7県");
            expect(wrapEl().className).not.toContain("jm-tracing");
            fireEvent.pointerLeave(wrapEl(), { pointerType: "mouse" });
            expect(tipText()).toBeNull();
        });

        it("初見の一言「長押ししてなぞる」: 初めての端末には常設で出る・なぞったら消えて、以後の来訪でも出さない", async () => {
            localStorage.removeItem("jm-hint");
            mountFresh();
            expect(screen.getByTestId("home-japan-map-hint").textContent).toBe("長押ししてなぞる");
            const [x, y] = px(240, 252);
            ptr("pointerDown", x, y);
            await settle(260);
            expect(screen.queryByTestId("home-japan-map-hint")).toBeNull();
            ptr("pointerUp", x, y);
            expect(JSON.parse(localStorage.getItem("jm-hint")!).traced).toBe(true);
            mountFresh();
            expect(screen.queryByTestId("home-japan-map-hint")).toBeNull();
        });
    });

    describe("初見の手がかり（輪が地方をなぞる動き）", () => {
        const withObserver = (ratio: number) => {
            class IO {
                constructor(private cb: (es: { intersectionRatio: number }[]) => void) {}
                observe() { this.cb([{ intersectionRatio: ratio }]); }
                disconnect() {}
                unobserve() {}
            }
            vi.stubGlobal("IntersectionObserver", IO);
        };
        const reduced = (on: boolean) => {
            window.matchMedia = ((q: string) => ({ matches: on && /reduce/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
        };
        const ghostOn = () => { const f = document.querySelector(".jm-finger.jm-ghost"); return !!f && !(f as HTMLElement).hidden; };
        afterEach(() => { vi.unstubAllGlobals(); });

        it("初回: 地図が 60% 以上見えて 1.2 秒動かさないと輪が出る（真鍮の輪＝本物の操作と見分ける）。端末の旗は 1 回ぶん進む。触れた瞬間に消える", async () => {
            localStorage.removeItem("jm-hint");
            withObserver(1);
            reduced(false);
            mountFresh();
            await settle(1100);
            expect(ghostOn()).toBe(false);
            await settle(200);
            expect(ghostOn()).toBe(true);
            expect(JSON.parse(localStorage.getItem("jm-hint")!).shown).toBe(1);
            ptr("pointerDown", ...px(240, 252));
            expect(ghostOn()).toBe(false);
        });

        it("見えている割合が 60% に満たないと出さない・2 回出したあと（旗 shown=2）は出さない", async () => {
            localStorage.removeItem("jm-hint");
            withObserver(0.4);
            reduced(false);
            mountFresh();
            await settle(2000);
            expect(ghostOn()).toBe(false);
            cleanup();
            localStorage.setItem("jm-hint", JSON.stringify({ shown: 2, traced: false, visits: 9 }));
            withObserver(1);
            reduced(false);
            mountFresh();
            await settle(2000);
            expect(ghostOn()).toBe(false);
        });

        it("動きを減らす設定（prefers-reduced-motion）では輪を動かさない（常設の一言だけ）", async () => {
            localStorage.removeItem("jm-hint");
            withObserver(1);
            reduced(false);
            reduced(true);
            mountFresh();
            await settle(3000);
            expect(ghostOn()).toBe(false);
            expect(screen.getByTestId("home-japan-map-hint").textContent).toBe("長押ししてなぞる");
        });
    });

    describe("安全策: なぞり・当たりの計算で例外が出ても、タップと一覧チップで県へ行ける", () => {
        it("当たりの計算が壊れたまま画面をタップ → 県の一覧を開き、案内を読み上げる。一覧チップで県を選べる", async () => {
            const err = vi.spyOn(console, "error").mockImplementation(() => {});
            mountFresh();
            brokenHit.on = true;
            await tap(...px(240, 252));
            expect(screen.getAllByRole("button", { name: /県の一覧から選ぶ/ })[0].getAttribute("aria-expanded")).toBe("true");
            expect(screen.getByTestId("home-japan-map-status").textContent).toContain("県の一覧から選べます");
            fireEvent.click(screen.getByRole("button", { name: "神奈川県、" + data.areas.find((a) => a[0] === "kanagawa")![1] + "件" }));
            expect(isOpen()).toBe(true);
            expect(panelEl().textContent).toContain("神奈川県");
            err.mockRestore();
        });

        it("なぞり開始で例外が出ても、次のタップ（click）は受ける（壊れたあとは click をそのままタップとして扱う）", async () => {
            const err = vi.spyOn(console, "error").mockImplementation(() => {});
            mountFresh();
            const [x, y] = px(240, 252);
            brokenHit.on = true;
            ptr("pointerDown", x, y);
            await settle(260); // 長押しの begin の中の pickHit が投げる
            ptr("pointerUp", x, y);
            expect(wrapEl().className).not.toContain("jm-tracing");
            brokenHit.on = false;
            await settle(600);
            fireEvent.click(wrapEl(), { clientX: x, clientY: y, detail: 1 });
            expect(stageOf()).toBe("関東");
            err.mockRestore();
        });
    });

    describe("一覧チップ（地図の外・全県）", () => {
        it("開くと地方ごとに全県が並ぶ（ボタン 47・名前と件数を読み上げる）。押すと、その県の地方へ拡大して県を選ぶ", () => {
            mountFresh();
            fireEvent.click(screen.getAllByRole("button", { name: /県の一覧から選ぶ/ })[0]);
            const list = screen.getByTestId("home-japan-map-list");
            expect(list.querySelectorAll("button[data-pick]")).toHaveLength(47);
            expect(list.querySelectorAll('[role="group"]')).toHaveLength(9);
            const kana = list.querySelector<HTMLButtonElement>('button[data-pick="kanagawa"]')!;
            expect(kana.getAttribute("aria-label")).toMatch(/^神奈川県、\d+件$/);
            fireEvent.click(kana);
            expect(stageOf()).toBe("関東");
            expect(isOpen()).toBe(true);
            expect(kana.getAttribute("aria-pressed")).toBe("true");
        });

        it("触れる・焦点を当てると、地図の県が強調される（連動）", () => {
            mountFresh();
            fireEvent.click(screen.getAllByRole("button", { name: /県の一覧から選ぶ/ })[0]);
            const b = document.querySelector<HTMLButtonElement>('button[data-pick="osaka"]')!;
            fireEvent.mouseEnter(b);
            expect(document.querySelectorAll("path.jm-hov")).toHaveLength(1);
            fireEvent.blur(b);
            fireEvent.focus(b);
            expect(document.querySelectorAll("path.jm-hov")).toHaveLength(1);
            fireEvent.blur(b);
            expect(document.querySelectorAll("path.jm-hov")).toHaveLength(0);
        });
    });

    describe("キーボード", () => {
        it("全国: 地図の枠に Tab で入り、矢印で地方どうしを移り（読み上げ）、Enter で拡大。拡大した地方では県のリンクへ移り、矢印で隣の県・Enter で県を選ぶ・Esc で 帯 → 全国", () => {
            mountFresh();
            const wrap = wrapEl();
            expect(wrap.getAttribute("tabindex")).toBe("0");
            expect(document.querySelectorAll('a[data-s][tabindex="0"]')).toHaveLength(0); // 全国は県のリンクに止まらない
            wrap.focus();
            fireEvent.keyDown(wrap, { key: "ArrowRight" });
            expect(screen.getByTestId("home-japan-map-status").textContent).toMatch(/関東|東北|中部/);
            for (let i = 0; i < 4; i++) fireEvent.keyDown(wrap, { key: "ArrowLeft" });
            fireEvent.keyDown(wrap, { key: "ArrowUp" });
            expect(document.querySelectorAll("path.jm-hovr, path.jm-hov").length).toBeGreaterThan(0);
            // 関東へ移して Enter
            fireEvent.click(screen.getByRole("button", { name: "関東" })); // 近道（キー操作の確定と同じ goRegion）
            fireEvent.click(screen.getByRole("button", { name: "全国" }));
            fireEvent.keyDown(wrap, { key: "Enter" });
            // 拡大した地方: 止まり先は 1 か所
            fireEvent.click(screen.getByRole("button", { name: "関東" }));
            expect(document.querySelectorAll('a[data-s][tabindex="0"]')).toHaveLength(1);
            const stop = document.querySelector<SVGAElement>('a[data-s][tabindex="0"]')!;
            stop.focus();
            fireEvent.keyDown(stop, { key: "ArrowRight" });
            fireEvent.click(link("tochigi"), { detail: 0 });
            expect(isOpen()).toBe(true);
            expect(window.location.hash).toBe("#pref=tochigi");
            expect(document.activeElement).toBe(panelEl()); // 開いたのがキーボードなら焦点は帯へ
            fireEvent.keyDown(panelEl(), { key: "Escape" });
            expect(isOpen()).toBe(false);
            expect(stageOf()).toBe("関東"); // 1 回目の Esc は帯だけ
            fireEvent.keyDown(wrap, { key: "Escape" });
            expect(stageOf()).toBe("all");
        });

        it("県のリンクは本物の <a href>。修飾キーつき・中ボタンは頁へ行く（帯は開かない）・ふつうの click は頁を移動せず帯を開く", () => {
            mountFresh();
            const a = link("osaka");
            expect(a.getAttribute("href")).toBe(ROUTES.SPOT_AREA("osaka"));
            const ev = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 });
            a.dispatchEvent(ev);
            expect(isOpen()).toBe(false);
            expect(trackMock).toHaveBeenCalledWith("nav_click", { area: "home_entry", dest: "map_pref" });
            fireEvent.click(a, { detail: 1 });
            expect(isOpen()).toBe(true);
        });
    });

    describe("計測と読み上げ", () => {
        it("map_pref_select は県を選んだときだけ（閉じる・同じ県の選び直し・地方の拡大は数えない）。map_sheet_open は閉じた状態から開いたときだけ", () => {
            mountFresh();
            const calls = () => trackMock.mock.calls.filter((c) => c[0] === "nav_click").map((c) => (c[1] as { dest: string }).dest);
            fireEvent.click(screen.getByRole("button", { name: "関東" }));
            expect(calls()).toEqual([]);
            fireEvent.click(link("tokyo"), { detail: 1 });
            expect(calls()).toEqual(["map_pref_select", "map_sheet_open"]);
            fireEvent.click(link("tokyo"), { detail: 1 }); // 同じ県をもう一度: 変化なし
            expect(calls()).toEqual(["map_pref_select", "map_sheet_open"]);
            fireEvent.click(link("chiba"), { detail: 1 });
            expect(calls()).toEqual(["map_pref_select", "map_sheet_open", "map_pref_select"]);
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            expect(calls()).toEqual(["map_pref_select", "map_sheet_open", "map_pref_select"]);
        });

        it("県を選ぶと「神奈川県を選びました。撮影スポット N件。」を読み上げ、表示する件数と同じ N", () => {
            mountFresh();
            fireEvent.click(link("kanagawa"), { detail: 1 });
            const n = data.areas.find((a) => a[0] === "kanagawa")![1];
            expect(screen.getByTestId("home-japan-map-status").textContent).toBe(`神奈川県を選びました。撮影スポット ${n}件。`);
            expect(panelEl().textContent).toContain(`撮影スポット ${n}件`);
        });
    });

    describe("近くの県のボタン", () => {
        it("押すと県が切り替わり、焦点は帯の中に残る（body へ落ちない）", () => {
            mountFresh();
            fireEvent.click(link("kanagawa"), { detail: 1 });
            const near = panelEl().querySelector<HTMLButtonElement>(".jm-chip")!;
            near.focus();
            const name = near.textContent!;
            fireEvent.click(near);
            expect(panelEl().querySelector("h3")!.textContent).toBe(name);
            expect(document.activeElement).not.toBe(document.body);
            expect(panelEl().contains(document.activeElement)).toBe(true);
        });
    });

    describe("URL（#pref=…）と戻る", () => {
        const pushedState = () => window.history.state as Record<string, unknown> | null;

        it("開くと #pref=<slug> が付き履歴が 1 件増える・切り替えは差し替え（増えない）・閉じると戻して消える。閉じたあと、戻る操作が空振りしない（先頭の履歴に戻っている）", async () => {
            vi.useRealTimers();
            window.history.replaceState({ top: true }, "", "/?tab=a");
            mountFresh();
            const n0 = window.history.length;
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(window.location.hash).toBe("#pref=osaka");
            expect(window.history.length).toBe(n0 + 1);
            expect(pushedState()?.jmSearch).toBe("?tab=a");
            fireEvent.click(link("kyoto"), { detail: 1 });
            expect(window.history.length).toBe(n0 + 1);
            const back = vi.spyOn(window.history, "back");
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            expect(back).toHaveBeenCalledTimes(1);
            await waitFor(() => expect(isOpen()).toBe(false));
            await waitFor(() => expect(window.location.hash).toBe(""));
            // 積んだ分が消えて、開く前の履歴（印なし）の上にいる＝次の「戻る」は頁の外へ出る（同じ頁で空振りしない）
            expect(window.location.search).toBe("?tab=a");
            expect(pushedState()?.jmPref).toBeUndefined();
            expect(pushedState()?.top).toBe(true);
            back.mockRestore();
        });

        it("🔴 開いたまま別のタブへ替えて（search が変わって）✕ で閉じるとき、back() せず差し替えでハッシュだけ外す（タブが元に戻らない）", async () => {
            vi.useRealTimers();
            window.history.replaceState(null, "", "/?tab=a");
            mountFresh();
            fireEvent.click(link("osaka"), { detail: 1 });
            // タブの切り替え（Next のルーターが search を差し替える）。印は持ち越される
            window.history.replaceState({ ...(window.history.state as object) }, "", "/?tab=b#pref=osaka");
            const back = vi.spyOn(window.history, "back");
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            expect(back).not.toHaveBeenCalled();
            expect(window.location.search).toBe("?tab=b");
            expect(window.location.hash).toBe("");
            await waitFor(() => expect(isOpen()).toBe(false));
            back.mockRestore();
        });

        it("URL から開いた県（自分が積んでいない）を閉じるときも back() しない（履歴を積み直さず ハッシュだけ外す）", async () => {
            vi.useRealTimers();
            window.history.replaceState(null, "", "/#pref=kagawa");
            mountFresh();
            await waitFor(() => expect(isOpen()).toBe(true));
            expect(panelEl().textContent).toContain("香川県");
            expect(stageOf()).toBe("四国"); // 共有リンクで開いたら、その県の地方へ自動で拡大
            const n0 = window.history.length;
            const back = vi.spyOn(window.history, "back");
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            expect(back).not.toHaveBeenCalled();
            await waitFor(() => expect(isOpen()).toBe(false));
            expect(window.location.hash).toBe("");
            expect(window.history.length).toBe(n0);
            back.mockRestore();
        });

        it("ブラウザの戻る（popstate）で帯が閉じ、進むで同じ県が開く（地方も合わせる）", async () => {
            vi.useRealTimers();
            mountFresh();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(stageOf()).toBe("近畿");
            window.history.back();
            await waitFor(() => expect(isOpen()).toBe(false));
            window.history.forward();
            await waitFor(() => expect(isOpen()).toBe(true));
            expect(panelEl().textContent).toContain("大阪府");
            expect(stageOf()).toBe("近畿");
        });

        it("🔴 bfcache で戻った（pageshow の persisted）とき、ハッシュと食い違っていたら合わせる。persisted でない pageshow では動かさない", async () => {
            vi.useRealTimers();
            mountFresh();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(isOpen()).toBe(true);
            // 画面（帯が開いている）と URL（ハッシュなし）が食い違った状態にする。replaceState が popstate / hashchange を飛ばす環境
            // （happy-dom）でも、部品に届く前に止めて、pageshow だけで合わせさせる
            const mute = (e: Event) => e.stopImmediatePropagation();
            window.addEventListener("popstate", mute, true);
            window.addEventListener("hashchange", mute, true);
            window.history.replaceState(window.history.state, "", "/");
            await new Promise((r) => setTimeout(r, 20));
            window.removeEventListener("popstate", mute, true);
            window.removeEventListener("hashchange", mute, true);
            expect(isOpen()).toBe(true);
            const nopersist = Object.assign(new Event("pageshow"), { persisted: false });
            window.dispatchEvent(nopersist);
            await new Promise((r) => setTimeout(r, 30));
            expect(isOpen()).toBe(true);
            window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
            await waitFor(() => expect(isOpen()).toBe(false));
            // 逆向き: 閉じた画面で URL にハッシュが付いて戻ってきたら、開く
            window.addEventListener("popstate", mute, true);
            window.addEventListener("hashchange", mute, true);
            window.history.replaceState(window.history.state, "", "/#pref=kagawa");
            await new Promise((r) => setTimeout(r, 20));
            window.removeEventListener("popstate", mute, true);
            window.removeEventListener("hashchange", mute, true);
            expect(isOpen()).toBe(false);
            window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
            await waitFor(() => expect(isOpen()).toBe(true));
            expect(panelEl().textContent).toContain("香川県");
        });

        it("履歴の state に Next の内部の印を持ち越す（戻ったとき Next の popstate が再読込に落ちない）", () => {
            window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["x"] }, "", "/");
            mountFresh();
            fireEvent.click(link("osaka"), { detail: 1 });
            expect(pushedState()?.__NA).toBe(true);
            expect(pushedState()?.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(["x"]);
        });

        it("知らない県・形の違う値の #pref は無視（全国・閉じたまま）", async () => {
            vi.useRealTimers();
            window.history.replaceState(null, "", "/#pref=atlantis");
            mountFresh();
            await new Promise((r) => setTimeout(r, 20));
            expect(isOpen()).toBe(false);
            expect(stageOf()).toBe("all");
        });

        it("地方の拡大は履歴を積まない（チップ・タップ・なぞり）", async () => {
            mountFresh();
            const n0 = window.history.length;
            fireEvent.click(screen.getByRole("button", { name: "東北" }));
            await settle(500);
            fireEvent.click(screen.getByRole("button", { name: "全国" }));
            await tap(...px(240, 252));
            expect(stageOf()).toBe("関東");
            expect(window.history.length).toBe(n0);
            expect(window.location.hash).toBe("");
        });
    });

    describe("地図へ戻る（位置と県の覚え）", () => {
        it("「すべて見る」「スポット」を押す直前に、県とスクロール位置を覚える（頁を離れる前）", () => {
            mountFresh();
            Object.defineProperty(window, "scrollY", { value: 398, configurable: true });
            fireEvent.click(link("kanagawa"), { detail: 1 });
            fireEvent.click(screen.getByTestId("home-japan-map-open"), { detail: 1 });
            expect(readMapReturn()).toEqual(expect.objectContaining({ pref: "kanagawa", y: 398 }));
            sessionStorage.clear();
            const spot = screen.getByTestId("home-japan-map-spots").querySelector("a")!;
            fireEvent.click(spot, { detail: 1 });
            expect(readMapReturn()).toEqual(expect.objectContaining({ pref: "kanagawa", y: 398 }));
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
        });

        it("覚えのある県の #pref で開くと、位置がずれていれば覚えの位置へ寄せる。触れたあとは動かさない", async () => {
            vi.useRealTimers();
            saveMapReturn("kanagawa", 398);
            window.history.replaceState(null, "", "/#pref=kanagawa");
            const spy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
            mountFresh();
            await waitFor(() => expect(spy).toHaveBeenCalledWith({ top: 398, behavior: "auto" }));
            spy.mockClear();
            cleanup();
            Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
            mountFresh();
            await new Promise((r) => setTimeout(r, 450));
            expect(spy).not.toHaveBeenCalled();
            cleanup();
            Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
            mountFresh();
            fireEvent.wheel(window);
            await new Promise((r) => setTimeout(r, 450));
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("閉じると覚えを消す（閉じたあとに戻ってきても開き直さない）", () => {
            mountFresh();
            fireEvent.click(link("kanagawa"), { detail: 1 });
            saveMapReturn("kanagawa", 10);
            fireEvent.click(screen.getByTestId("home-japan-map-close"));
            expect(readMapReturn()).toBeNull();
        });
    });

    it("件数の濃淡は初期オフ。チェックで色の段と凡例が出る", () => {
        mountFresh();
        expect(document.querySelector(".jm-dens")).toBeNull();
        fireEvent.click(screen.getByRole("checkbox", { name: /件数の濃淡/ }));
        expect(document.querySelector(".jm-dens")).not.toBeNull();
        expect(screen.getByTestId("home-japan-map-legend")).toBeInTheDocument();
        expect(document.querySelectorAll("path.jm-b0, path.jm-b1, path.jm-b2, path.jm-b3").length).toBe(47);
    });

    it("帯: 0 件の県は「まだ登録がありません」と近くの県を出し、「すべて見る」を出さない", () => {
        cleanup();
        const areas = data.areas.map((a) => (a[0] === "tottori" ? ([a[0], 0] as const) : a));
        render(<HomeJapanMap areas={areas as typeof data.areas} tops={{ ...tops, tottori: [] }} />);
        mockRect();
        fireEvent.click(link("tottori"), { detail: 1 });
        expect(panelEl().textContent).toContain("まだ登録がありません");
        expect(screen.queryByTestId("home-japan-map-open")).toBeNull();
        expect(panelEl().querySelectorAll(".jm-chip").length).toBe(3);
    });

    it("禁止語（撮りどき・この場所・注目スポット・捨て）を、開いた帯・チップ・読み上げにも出さない", () => {
        mountFresh();
        fireEvent.click(link("kanagawa"), { detail: 1 });
        fireEvent.click(screen.getAllByRole("button", { name: /県の一覧から選ぶ/ })[0]);
        const section = screen.getByTestId("home-japan-map");
        const text = section.textContent + [...section.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(" ");
        for (const w of ["撮りどき", "この場所", "注目スポット", "捨て"]) expect(text, w).not.toContain(w);
        expect(section.textContent).not.toContain("PHOTO SPOTS");
        expect(section.textContent).toContain("日本地図");
    });
});
