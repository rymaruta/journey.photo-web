import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SEARCH_SETTLE_MS } from "../../lib/hooks/useSearchTracking";

/**
 * サイト内検索の GA4 `search`（2026-11-04）が画面に結ばれていること。
 * 語は送らず、長さと件数（写真の並びの件数）だけ。ユーザー検索（/users/search）は別の画面で対象外
 */
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" }, search: { placeholder: "写真を検索" }, sort: { label: "並べ替え", options: { new: "新しい順", old: "古い順", popular: "人気順" } } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("../search/SpotSearchResults", () => ({ default: () => null }));
vi.mock("../search/DiscoverSections", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "富士山", category: "travel", date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "富士の夜", category: "food", date: "2026-01-02", createdAt: "2026-01-02" },
    { id: "p3", src: "https://cdn/c.jpg", title: "京都", category: "food", date: "2026-01-03", createdAt: "2026-01-03" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));
vi.mock("../data/photos.json", () => ({ default: [] }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

const gtag = vi.fn();
const searches = () => gtag.mock.calls.filter((c) => c[1] === "search").map((c) => c[2]);
beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.history.replaceState({}, "", "/search");
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});
afterEach(() => vi.useRealTimers());

describe("検索欄 → search の計測", () => {
    it("打ち終えたら1回。語は送らず、長さと件数", () => {
        render(<GalleryPageClient surface="search" />);
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "富士" } });
        expect(searches()).toEqual([]);
        // 検索欄自身の間引き（`FilterBar` の debounce）のあと、打ち終えの待ち
        act(() => { vi.advanceTimersByTime(1000); });
        act(() => { vi.advanceTimersByTime(SEARCH_SETTLE_MS + 50); });
        expect(searches()).toEqual([expect.objectContaining({ search_term_length: 2, result_count: 2 })]);
        expect(JSON.stringify(gtag.mock.calls)).not.toContain("富士");
    });
});
