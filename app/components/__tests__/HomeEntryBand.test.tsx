import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ホームの入口の帯（2026-11-09 owner「任せる」・提案書 4b の(a)）。
 * 撮影スポット・地図・探す + 未ログインは「ログイン」・ログイン中は「行きたい場所」。
 * 写真の並びは動かさない（ホームの並び: 輪 → 札 → アプリの札 → 帯 → 切り替え）。
 */
const auth = vi.hoisted(() => ({ isAuthenticated: false, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import HomeEntryBand from "../HomeEntryBand";

const gtag = vi.fn();
beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
    auth.isAuthenticated = false;
    auth.loading = false;
});
const links = () => within(screen.getByTestId("home-entry-band")).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);

describe("ホームの入口の帯", () => {
    it("未ログイン: 撮影スポット・地図・探す・ログイン（文字リンク・この並び）", () => {
        render(<HomeEntryBand />);
        expect(links()).toEqual([["撮影スポット", "/spots"], ["地図", "/map"], ["探す", "/search"], ["ログイン", "/login"]]);
    });

    it("ログイン中は「ログイン」を出さず「行きたい場所」", () => {
        auth.isAuthenticated = true;
        render(<HomeEntryBand />);
        expect(links()).toEqual([["撮影スポット", "/spots"], ["地図", "/map"], ["探す", "/search"], ["行きたい場所", "/saved-spots"]]);
    });

    it("判定中は4つ目を出さない（ログイン済みの人に一瞬「ログイン」が見えない）", () => {
        auth.loading = true;
        render(<HomeEntryBand />);
        expect(links().map((l) => l[0])).toEqual(["撮影スポット", "地図", "探す"]);
    });

    it("どれも高さ 44px 以上・字 12px 以上", () => {
        render(<HomeEntryBand />);
        for (const a of within(screen.getByTestId("home-entry-band")).getAllByRole("link")) {
            const st = (a as HTMLElement).style;
            expect(parseInt(st.minHeight)).toBeGreaterThanOrEqual(44);
            expect(parseInt(st.fontSize)).toBeGreaterThanOrEqual(12);
        }
    });

    it("押すと nav_click（area=home_entry・dest。「県から探す」の節の dest=area と区別できる）", () => {
        render(<HomeEntryBand />);
        const nav = screen.getByTestId("home-entry-band");
        nav.addEventListener("click", (e) => e.preventDefault());
        for (const name of ["撮影スポット", "地図", "探す", "ログイン"]) fireEvent.click(screen.getByRole("link", { name }));
        expect(gtag.mock.calls.filter((c) => c[1] === "nav_click").map((c) => c[2])).toEqual([
            expect.objectContaining({ area: "home_entry", dest: "spots" }),
            expect.objectContaining({ area: "home_entry", dest: "map" }),
            expect.objectContaining({ area: "home_entry", dest: "search" }),
            expect.objectContaining({ area: "home_entry", dest: "login" }),
        ]);
    });

    it("禁止語（撮りどき・この場所・注目スポット）を使わない", () => {
        render(<HomeEntryBand />);
        for (const w of ["撮りどき", "この場所", "注目スポット"]) expect(screen.getByTestId("home-entry-band").textContent).not.toContain(w);
    });

    it("ホームの並びの中: アプリの札の下・切り替え（tablist）の上。写真の並び（HomeMosaic）は動かさない", () => {
        const src = readFileSync(resolve(__dirname, "../../GalleryPageClient.tsx"), "utf8");
        const iCard = src.indexOf('<AppInstallCard placement="home"');
        const iBand = src.indexOf("<HomeEntryBand");
        const iTabs = src.indexOf('role="tablist"');
        expect(iCard).toBeGreaterThan(0);
        expect(iBand).toBeGreaterThan(iCard);
        expect(iTabs).toBeGreaterThan(iBand);
    });
});

describe("ホームの「県から探す」の節", () => {
    it("リンクは nav_click（area=home_entry・dest=area）を数える", async () => {
        const { default: HomeSpotEntry } = await import("../HomeSpotEntry");
        const { container } = render(<HomeSpotEntry data={{ areas: [["hokkaido", 3]], continents: [] } as never} />);
        const a = container.querySelector("a.home-spot-link") as HTMLAnchorElement;
        expect(a).not.toBeNull();
        a.addEventListener("click", (e) => e.preventDefault());
        fireEvent.click(a);
        expect(gtag.mock.calls.filter((c) => c[1] === "nav_click").map((c) => c[2])).toEqual([
            expect.objectContaining({ area: "home_entry", dest: "area" }),
        ]);
    });
});
