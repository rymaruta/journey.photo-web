import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// **読み上げでページを辿れるか。** Chromium で主要9画面の見出しと
// ランドマークを実測して出た2件を固定する（測定は `scripts/audit-landmarks.mjs`）:
//
// 1. **ホームだけ h1 が0件だった**（390px 幅）。タイトルは `hidden sm:flex` の
//    中にあり、狭い画面では `display:none` ＝読み上げの木からも消える。
//    ホームはこのサイトの入口で、検索から来た人が最初に開く画面。
// 2. **無名の `<nav>` が全ページに2つ**（ヘッダーとフッター）。同じ種類の
//    ランドマークが複数あるとき、名前が無いと「ナビゲーション」が2回読まれる
//    だけで、どちらへ行けばよいか分からない。
//
// jsdom は CSS を評価しない（`sm:hidden` が効かない）ので、**どの幅で見えるか**
// はブラウザで測る。ここでは「置いてあるか・消えていないか」を描画して見る。

const authState = vi.hoisted(() => ({ current: { isAuthenticated: false, userId: null as string | null, loading: false } }));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { navigation: {}, category: { all: "すべて", names: {} }, site: { title: "作品紹介", subtitle: "旅の一言" } } }),
}));
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ loaded: true, photos: [] }) }));
vi.mock("../data/photos.json", () => ({ default: [] }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
}));
import ToastProvider from "../components/ToastProvider";

/** クラス名を「語」として見る。`includes("sr-only")` は `not-sr-only` にも当たる */
const hasClass = (el: Element | null, name: string) =>
    ` ${el?.className ?? ""} `.includes(` ${name} `);

describe("ランドマークに名前が付いている", () => {
    it.each([
        ["フッター", async () => (await import("../components/Footer")).default],
        ["ヘッダー", async () => (await import("../components/HeaderNav")).default],
    ])("%s のナビに名前がある（もう一方と区別できる）", async (_name, load) => {
        const Component = await load();
        const { container } = render(<ToastProvider><Component /></ToastProvider>);
        const navs = [...container.querySelectorAll("nav")];
        expect(navs.length, "ナビが1つも無い").toBeGreaterThan(0);
        for (const nav of navs) {
            expect(nav.getAttribute("aria-label") || nav.getAttribute("aria-labelledby"),
                `名前の無いランドマーク: ${nav.className}`).toBeTruthy();
        }
    });

    it("2つのナビの名前が違う（同じ名前だと区別にならない）", async () => {
        const Footer = (await import("../components/Footer")).default;
        const HeaderNav = (await import("../components/HeaderNav")).default;
        const f = render(<ToastProvider><Footer /></ToastProvider>).container.querySelector("nav")?.getAttribute("aria-label");
        const h = render(<ToastProvider><HeaderNav /></ToastProvider>).container.querySelector("nav")?.getAttribute("aria-label");
        expect(f).toBeTruthy();
        expect(h).toBeTruthy();
        expect(f).not.toBe(h);
    });
});

describe("ホームに見出しがある", () => {
    it("h1 は HTML に1つだけ・スマホでもパソコンでも見える（sr-only・hidden にしない）・明朝", async () => {
        const GalleryPageClient = (await import("../GalleryPageClient")).default;
        const { container } = render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        // jsdom は CSS を見ない。**HTML に在る数**を数える（検索は HTML を読むので、
        // 幅ごとに片方を隠していても2つ在れば2つに見える・2026-10-09）
        const h1s = container.querySelectorAll("h1");
        expect(h1s.length, "h1 が1つではない（HTML に見出しが2つ在る）").toBe(1);
        const h1 = h1s[0];
        expect(h1.textContent?.trim(), "名前の無い見出し（読み上げても何も分からない）").toBeTruthy();

        // 2026-11-09（owner 承認・9人のレビュー）: スマホでも画面に出す。**画面の外（sr-only）に戻すとここで落ちる**
        expect(hasClass(h1, "sr-only"), "スマホで見出しが画面の外（見えない）").toBe(false);
        expect(hasClass(h1, "sm:not-sr-only"), "sr-only を前提にした指定が残っている").toBe(false);
        expect(hasClass(h1, "hidden"), "見出し自体が隠されている").toBe(false);
        for (let el = h1.parentElement; el && el !== container; el = el.parentElement) {
            expect(hasClass(el, "hidden"), `見出しの包みが消える: ${el.className}`).toBe(false);
            expect(hasClass(el, "sr-only"), `見出しの包みが画面の外: ${el.className}`).toBe(false);
        }
        expect(hasClass(h1, "font-serif"), "見出しは明朝（板 02）").toBe(true);
        // 見出しの階層: h1 の次の見出しは h2 以下（h1 → h3 と飛ばない）
        const levels = Array.from(container.querySelectorAll("h1,h2,h3,h4")).map((e) => Number(e.tagName[1]));
        for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `見出しの階層が飛ぶ: ${levels.join(",")}`).toBeLessThanOrEqual(1);
    });

    it("一言（サイトの看板）はスマホでも見せる（hidden の包みに入れない）", async () => {
        const GalleryPageClient = (await import("../GalleryPageClient")).default;
        const { container } = render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const sub = container.querySelector("#site-subtitle");
        expect(sub, "一言が描かれていない").toBeTruthy();
        expect(sub!.textContent?.trim(), "一言が空").toBeTruthy();
        for (let el: Element | null = sub as Element; el && el !== container; el = el.parentElement) {
            expect(hasClass(el, "hidden"), `スマホで一言が消える: ${el.className}`).toBe(false);
            expect(hasClass(el, "sr-only"), `スマホで一言が画面の外: ${el.className}`).toBe(false);
        }
    });
});
