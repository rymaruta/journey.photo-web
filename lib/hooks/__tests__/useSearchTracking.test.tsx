import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearchTracking, SEARCH_SETTLE_MS } from "../useSearchTracking";

// サイト内検索の計測（2026-11-04）: 打ち終えて1回・語は送らず長さと件数だけ
const gtag = vi.fn();
const searches = () => gtag.mock.calls.filter((c) => c[1] === "search").map((c) => c[2]);

beforeEach(() => {
    vi.useFakeTimers();
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});
afterEach(() => vi.useRealTimers());

describe("useSearchTracking", () => {
    it("打ち終えて一定時間たったら1回。語そのものは送らない", () => {
        const { rerender } = renderHook(({ q, n }) => useSearchTracking(q, n), { initialProps: { q: "", n: 30 } });
        for (const q of ["沖", "沖縄", "沖縄の海"]) {
            rerender({ q, n: 5 });
            act(() => { vi.advanceTimersByTime(300); });
        }
        expect(searches()).toEqual([]);   // 打っている途中は数えない
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS); });
        expect(searches()).toEqual([expect.objectContaining({ search_term_length: 4, result_count: 5 })]);
        const sent = JSON.stringify(gtag.mock.calls);
        expect(sent).not.toContain("沖縄");
        expect(sent).not.toContain("search_term\"");
    });

    it("件数は打ち終えた時点の最新の値", () => {
        const { rerender } = renderHook(({ q, n }) => useSearchTracking(q, n), { initialProps: { q: "tokyo", n: 100 } });
        rerender({ q: "tokyo", n: 7 });
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS); });
        expect(searches()).toEqual([expect.objectContaining({ result_count: 7 })]);
    });

    it("1文字・空・空白だけは数えない", () => {
        const { rerender } = renderHook(({ q }) => useSearchTracking(q, 0), { initialProps: { q: "a" } });
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS * 2); });
        rerender({ q: "   " });
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS * 2); });
        expect(searches()).toEqual([]);
    });

    it("同じ語が続くあいだは二度数えない。語を変えたら数える", () => {
        const { rerender } = renderHook(({ q }) => useSearchTracking(q, 3), { initialProps: { q: "kyoto" } });
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS); });
        rerender({ q: "kyoto " });   // 前後の空白だけの違い
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS); });
        expect(searches()).toHaveLength(1);
        rerender({ q: "osaka" });
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS); });
        expect(searches()).toHaveLength(2);
    });

    it("離れたら（アンマウント）未送信の分は送らない", () => {
        const { unmount } = renderHook(() => useSearchTracking("kyoto", 3));
        unmount();
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS * 2); });
        expect(searches()).toEqual([]);
    });
});
