import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

/**
 * 2026-11-20: 県のリンクで Enter（キーボード・読み上げの click）を押すと、帯は開くのに、
 * **裏で `<Link>` の移動（県の頁へ）も始まっていて、取り寄せが終わると頁ごと移っていた**。
 * 本番の Deploy Site（run 44815049595 の1回目）の smoke が、この移動に追い越されて落ちた。
 *
 * jsdom には Next の app router が無く、本物の `<Link>` は移動しない（`if (!router) return`）ので、
 * `next/link` を「`onClick` を呼んでから `defaultPrevented` を見て移動する」本物の約束どおりの偽物に替えて確かめる
 * （next/dist/client/app-dir/link.js の `onClick`→`linkClicked`）
 */
const navigate = vi.hoisted(() => vi.fn());
vi.mock("next/link", () => ({
    default: React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }>(
        function FakeLink({ href, onClick, prefetch: _p, children, ...rest }, ref) {
            void _p;
            return (
                <a
                    ref={ref}
                    href={href}
                    {...rest}
                    onClick={(e) => {
                        onClick?.(e);
                        if (e.defaultPrevented) return;
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // 修飾キーはブラウザに任せる（本物と同じ）
                        e.preventDefault();
                        navigate(href);
                    }}
                >
                    {children}
                </a>
            );
        },
    ),
}));
vi.mock("../../../lib/utils/analytics", async (orig) => ({ ...(await orig<typeof import("../../../lib/utils/analytics")>()), track: vi.fn() }));

const { default: HomeJapanMap } = await import("../HomeJapanMap");
const { homeSpotEntryData, homeMapTopSpots } = await import("../../../lib/data/homeSpotEntry");

const data = homeSpotEntryData();
const tops = homeMapTopSpots();
const link = (slug: string) => document.querySelector<SVGAElement>(`a[data-s="${slug}"]`)!;

beforeEach(() => {
    navigate.mockReset();
    window.history.replaceState(null, "", "/");
});

describe("日本地図: 県のリンクの click は頁を移らない（帯を開くだけ）", () => {
    it("Enter（detail 0）で帯が開き、県の頁への移動は始まらない", () => {
        render(<HomeJapanMap areas={data.areas} tops={tops} />);
        fireEvent.click(screen.getByRole("button", { name: "関東" }));
        fireEvent.click(link("tochigi"), { detail: 0 });
        expect(screen.queryByTestId("home-japan-map-panel")).not.toBeNull();
        expect(window.location.hash).toBe("#pref=tochigi");
        expect(navigate).not.toHaveBeenCalled();
    });

    it("マウスの click（detail 1）でも移動は始まらない", () => {
        render(<HomeJapanMap areas={data.areas} tops={tops} />);
        fireEvent.click(screen.getByRole("button", { name: "関東" }));
        fireEvent.click(link("kanagawa"), { detail: 1 });
        expect(screen.queryByTestId("home-japan-map-panel")).not.toBeNull();
        expect(navigate).not.toHaveBeenCalled();
    });

    it("修飾キーつきは本物のリンクのまま（帯は開かない・ブラウザが新しいタブで開く）", () => {
        render(<HomeJapanMap areas={data.areas} tops={tops} />);
        fireEvent.click(screen.getByRole("button", { name: "関東" }));
        const ev = fireEvent.click(link("tochigi"), { detail: 0, metaKey: true });
        expect(ev).toBe(true); // 既定の動き（リンクを開く）を止めていない
        expect(screen.queryByTestId("home-japan-map-panel")).toBeNull();
    });
});
