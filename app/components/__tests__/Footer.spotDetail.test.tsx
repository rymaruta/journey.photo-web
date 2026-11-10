import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

/**
 * 撮影スポット詳細には説明文の下に（`SpotNext`）、ホームには上段の札の下に自分のアプリの札があるので、
 * フッターの札は出さない（同じ札が1頁に2枚並ばない・2026-11-09・ホームは 2026-11-10 札 #515）。
 * ほかの頁は 11-09 承認の小さい形（`compact`）。
 * フッターの撮影スポットの組は nav_click（area=footer）を数える。
 */
const path = vi.hoisted(() => ({ current: "/" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import Footer from "../Footer";

const gtag = vi.fn();
beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});

describe("フッターのアプリの札", () => {
    it("撮影スポット詳細（/spots/<slug>）では出さない", () => {
        for (const p of ["/spots/goryokaku", "/spots/goryokaku/"]) {
            path.current = p;
            const { unmount } = render(<Footer />);
            expect(screen.queryByTestId("app-install-card"), p).toBeNull();
            unmount();
        }
    });

    // 2026-11-10 札 #515: ホームは本文（上段の札の下）に自分の札（placement=home）がある
    it("ホーム（/）では出さない", () => {
        path.current = "/";
        render(<Footer />);
        expect(screen.queryByTestId("app-install-card")).toBeNull();
    });

    it("それ以外の頁では出す（一覧・県・季節・予約語の頁・教科書・規約）。形は 11-09 承認の小さい形", () => {
        for (const p of ["/spots", "/spots/area/hokkaido", "/spots/season/spring", "/spots/momiji", "/spots/sakura", "/learn", "/terms", "/search", null]) {
            path.current = p;
            const { unmount } = render(<Footer />);
            const card = screen.queryByTestId("app-install-card");
            expect(card, String(p)).not.toBeNull();
            expect(card!.getAttribute("data-placement"), String(p)).toBe("banner");
            // 小さい形の印: 中の余白 p-3（電話の幅）・ボタンの名前は aria-label
            expect(card!.className.split(/\s+/), String(p)).toContain("p-3");
            expect(within(card!).getByRole("link", { name: "App Storeで入手" })).toBeTruthy();
            unmount();
        }
    });

    it("撮影スポットの行き先を押すと nav_click（area=footer・dest）", () => {
        path.current = "/terms";
        render(<Footer />);
        const group = screen.getByTestId("footer-spot-links");
        const stop = (e: Event) => e.preventDefault();
        group.addEventListener("click", stop);
        fireEvent.click(screen.getByRole("link", { name: "桜の撮影スポット" }));
        fireEvent.click(screen.getByRole("link", { name: "海外の撮影スポット" }));
        fireEvent.click(screen.getByRole("link", { name: "撮影スポットの一覧" }));
        expect(gtag.mock.calls.filter((c) => c[1] === "nav_click").map((c) => c[2])).toEqual([
            expect.objectContaining({ area: "footer", dest: "topic" }),
            expect.objectContaining({ area: "footer", dest: "area" }),
            expect.objectContaining({ area: "footer", dest: "spots" }),
        ]);
    });

    it("撮影スポットの9本は全部 nav_click を送る。地図とまなぶの組は以前どおり数えない", () => {
        path.current = "/terms";
        render(<Footer />);
        const stop = (e: Event) => e.preventDefault();
        document.addEventListener("click", stop);
        const spots = ["撮影スポットの一覧", "桜の撮影スポット", "紅葉の撮影スポット", "雪景色の撮影スポット", "海外の撮影スポット",
            "春の撮影スポット", "夏の撮影スポット", "秋の撮影スポット", "冬の撮影スポット"];
        for (const name of spots) fireEvent.click(screen.getByRole("link", { name }));
        expect(gtag.mock.calls.filter((c) => c[1] === "nav_click")).toHaveLength(spots.length);
        gtag.mockReset();
        for (const name of ["撮影地マップ", "写真とカメラの教科書", "構図ガイド", "今日の日の出・日の入り"]) fireEvent.click(screen.getByRole("link", { name }));
        expect(gtag.mock.calls.filter((c) => c[1] === "nav_click")).toHaveLength(0);
        document.removeEventListener("click", stop);
    });
});
