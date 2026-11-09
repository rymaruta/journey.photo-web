import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * 撮影スポット詳細には説明文の下に自分のアプリの札がある（`SpotNext`）ので、フッターの札は出さない
 * （同じ札が1頁に2枚並ばない・2026-11-09）。ほかの頁は今まで通り。
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

    it("それ以外の頁では出す（ホーム・一覧・県・季節・予約語の頁）", () => {
        for (const p of ["/", "/spots", "/spots/area/hokkaido", "/spots/season/spring", "/spots/momiji", "/spots/sakura", "/learn", null]) {
            path.current = p;
            const { unmount } = render(<Footer />);
            expect(screen.queryByTestId("app-install-card"), String(p)).not.toBeNull();
            unmount();
        }
    });

    it("撮影スポットの組を押すと nav_click（area=footer・dest）", () => {
        path.current = "/";
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
});
