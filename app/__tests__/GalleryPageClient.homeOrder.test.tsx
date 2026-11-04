import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ja } from "../i18n/labels";

/**
 * **ホームの並びを iOS に合わせる**（2026-11-04・iOS `Features/Gallery/GalleryView.swift` の `feed`）。
 *
 *     ストーリーの輪（`StoriesRow`）→ 上の札（`HomeTopCardView`）→ 切り替え（下へ送ると上に留まる・#417 ⑧）
 *     → 中身。いまの季節の撮影スポットの段は「おすすめ」の中だけ、写真 5 枚の後ろ（#417 ④）
 *
 * 以前の Web は「切り替え → 上の札 → 季節の段 → 中身」で、輪の列はマイページにだけあった。
 */
const localeState = vi.hoisted(() => ({ locale: "ja" as "ja" | "en" }));
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: localeState.locale, labels: { ...ja, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("../components/HomeTopCards", () => ({ default: () => <section data-testid="home-top-cards" /> }));
vi.mock("../components/TimelineFeed", () => ({ default: () => <div data-testid="timeline-feed" /> }));
// 輪の列の中身（読み込み・投稿）は `StoriesBar` 自身のテストが見る。ここは置き場所だけ
vi.mock("../components/stories/StoriesBar", () => ({ default: () => <div data-testid="stories-bar" /> }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// 写真の並びは「どの写真を、どの並びに入れたか」だけ見る（組み方は `HomeMosaic.test.tsx`）
vi.mock("../components/HomeMosaic", () => ({
    default: (p: { photos: { id: string }[]; priorityCount?: number }) => (
        <ol data-testid="mosaic" data-priority={p.priorityCount}>{p.photos.map((ph) => <li key={ph.id} data-card={ph.id} />)}</ol>
    ),
}));

const PHOTOS = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`, src: `https://cdn/${i}.jpg`, title: `写真${i + 1}`, category: "landscape", tags: [],
    createdAt: `2026-01-${String(20 - i).padStart(2, "0")}`,
}));
const photosRef = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: photosRef.list, loaded: true, failed: false }) }));

const SEASONAL = {
    season: "autumn" as const, href: "/spots/season/autumn", total: 12,
    spots: [{ slug: "kurobe", name: "黒部峡谷", src: "/spots/kurobe.jpg" }],
};

const GalleryPageClient = (await import("../GalleryPageClient")).default;
const { SEASON_SHELF_AFTER, HOME_PANEL_MIN_HEIGHT } = await import("../GalleryPageClient");

const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const cardIds = (el: Element) => Array.from(el.querySelectorAll("[data-card]")).map((c) => c.getAttribute("data-card"));

beforeEach(() => {
    photosRef.list = PHOTOS;
    localeState.locale = "ja";
    window.history.replaceState({}, "", "/");
});

describe("ホームの並び（iOS と同じ）", () => {
    it("輪の列 → 上の札 → 切り替え → 中身 の順", () => {
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        const stories = screen.getByTestId("stories-bar");
        const cards = screen.getByTestId("home-top-cards");
        const tabs = screen.getByRole("tablist");
        const panel = screen.getByRole("tabpanel");
        expect(follows(stories, cards), "輪の列が上の札より上に無い").toBe(true);
        expect(follows(cards, tabs), "上の札が切り替えより上に無い").toBe(true);
        expect(follows(tabs, panel), "切り替えが中身より上に無い").toBe(true);
    });

    it("「さがす」の面には輪の列を出さない", () => {
        render(<GalleryPageClient surface="search" />);
        expect(screen.queryByTestId("stories-bar")).toBeNull();
    });

    it("切り替えは見出しの下に留まる行に入っている（`position: sticky`・見出しの高さの下）", () => {
        render(<GalleryPageClient />);
        const row = screen.getByTestId("home-feed-row");
        expect(row).toContainElement(screen.getByRole("tablist"));
        const cls = row.className.split(/\s+/);
        expect(cls).toEqual(expect.arrayContaining(["sticky", "top-[var(--header-h)]", "bg-bg"]));
    });

    it("英語の名前は iOS と同じ「Latest」", () => {
        localeState.locale = "en";
        render(<GalleryPageClient />);
        expect(screen.getByRole("tab", { name: "Latest" })).toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: "New" })).toBeNull();
    });

    it("タブの面は「見えている高さ − 見出し − 切り替えの行」より縮まない", () => {
        render(<GalleryPageClient />);
        expect(HOME_PANEL_MIN_HEIGHT).toBe("calc(100dvh - var(--header-h) - 57px)");
        expect((screen.getByRole("tabpanel") as HTMLElement).style.minHeight).toBe(HOME_PANEL_MIN_HEIGHT);
    });
});

describe("いまの季節の撮影スポットの段（iOS #417 ④）", () => {
    it("「おすすめ」では写真 5 枚の後ろ・6 枚目の前に出る", () => {
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        fireEvent.click(screen.getByRole("tab", { name: "おすすめ" }));
        expect(SEASON_SHELF_AFTER).toBe(5);
        const shelf = screen.getByTestId("home-season-spots");
        const [lead, rest] = screen.getAllByTestId("mosaic");
        expect(cardIds(lead)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
        expect(cardIds(rest)).toEqual(["p6", "p7", "p8"]);
        expect(follows(lead, shelf) && follows(shelf, rest), "段が 5 枚と 6 枚目の間に無い").toBe(true);
        // 先に読むのは前の並びの頭だけ（後ろの並びは画面の下）
        expect(rest.getAttribute("data-priority")).toBe("0");
        expect(lead.getAttribute("data-priority")).toBe("3");
    });

    it("「新着」「フォロー中」には出さない（どのタブでも上の札の直下に出していた）", () => {
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        fireEvent.click(screen.getByRole("tab", { name: "新着" }));
        expect(screen.queryByTestId("home-season-spots")).toBeNull();
        expect(screen.getAllByTestId("mosaic")).toHaveLength(1);
        fireEvent.click(screen.getByRole("tab", { name: "フォロー中" }));
        expect(screen.queryByTestId("home-season-spots")).toBeNull();
    });

    it("写真が 5 枚以下なら段は写真の後ろ（後ろの並びは作らない）", () => {
        photosRef.list = PHOTOS.slice(0, 3);
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        fireEvent.click(screen.getByRole("tab", { name: "おすすめ" }));
        expect(screen.getAllByTestId("mosaic")).toHaveLength(1);
        expect(follows(screen.getByTestId("mosaic"), screen.getByTestId("home-season-spots"))).toBe(true);
    });

    it("写真が 0 枚の日は段を出さない（空の知らせのすぐ下に作例を並べない）", () => {
        photosRef.list = [];
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        fireEvent.click(screen.getByRole("tab", { name: "おすすめ" }));
        expect(screen.queryByTestId("home-season-spots")).toBeNull();
    });
});

describe("タブを替えたときの送りの位置（iOS の「深く送ってから替えたら、新しい一覧は頭から」）", () => {
    let scrollTo: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        scrollTo = vi.fn();
        vi.stubGlobal("scrollTo", scrollTo);
        Object.defineProperty(window, "scrollY", { configurable: true, value: 2500 });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
        vi.restoreAllMocks();
    });

    /** 行の元の位置の目印を、見えている上端からの位置 `top` に置く（留まる位置は 0＝見出しの高さの代わり） */
    function placeMark(top: number) {
        const mark = screen.getByTestId("home-feed-row-mark");
        vi.spyOn(mark, "getBoundingClientRect").mockReturnValue({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) });
        fireEvent.scroll(window);
    }

    it("行が留まっていたら、替えたあと行を上端へ戻す", async () => {
        render(<GalleryPageClient />);
        placeMark(-2168);
        await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
        expect(screen.getByTestId("home-feed-row").getAttribute("data-stuck")).toBe("true");
        fireEvent.click(screen.getByRole("tab", { name: "おすすめ" }));
        // 目印の頁の中の位置（-2168 + 2500 = 332）− 留まる位置（0）
        expect(scrollTo).toHaveBeenCalledWith(0, 332);
    });

    it("まだ送っていなければ（行が留まっていない）そのまま", async () => {
        render(<GalleryPageClient />);
        placeMark(332);
        await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
        expect(screen.getByTestId("home-feed-row").getAttribute("data-stuck")).toBe("false");
        fireEvent.click(screen.getByRole("tab", { name: "おすすめ" }));
        expect(scrollTo).not.toHaveBeenCalled();
    });
});
