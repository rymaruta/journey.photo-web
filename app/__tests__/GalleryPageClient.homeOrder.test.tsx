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
vi.mock("../components/HomeTopCards", () => ({ default: () => <section data-testid="home-top-cards" />, QuizCard: () => <a data-testid="search-quiz-entry" /> }));
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
const photosRef = vi.hoisted(() => ({ list: [] as unknown[], loaded: true, failed: false, retry: (() => {}) as () => void }));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ photos: photosRef.list, loaded: photosRef.loaded, failed: photosRef.failed, retry: photosRef.retry }),
}));

const SEASONAL = {
    season: "autumn" as const, href: "/spots/season/autumn", total: 12,
    spots: [{ slug: "kurobe", name: "黒部峡谷", src: "/spots/kurobe.jpg", region: "富山", alt: "黒部峡谷", credit: null }],
};

const GalleryPageClient = (await import("../GalleryPageClient")).default;
const { SEASON_SHELF_AFTER, HOME_PANEL_MIN_HEIGHT } = await import("../GalleryPageClient");

const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const cardIds = (el: Element) => Array.from(el.querySelectorAll("[data-card]")).map((c) => c.getAttribute("data-card"));

beforeEach(() => {
    photosRef.list = PHOTOS;
    photosRef.loaded = true;
    photosRef.failed = false;
    photosRef.retry = () => {};
    localeState.locale = "ja";
    window.history.replaceState({}, "", "/");
});

describe("ホームの並び（iOS と同じ）", () => {
    it("輪の列 → 上の札 → 切り替え → 中身 の順", async () => {
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        // 輪の列は遅れて読む（`next/dynamic`）
        const stories = await screen.findByTestId("stories-bar");
        const cards = screen.getByTestId("home-top-cards");
        const tabs = screen.getByRole("tablist");
        const panel = screen.getByRole("tabpanel");
        expect(follows(stories, cards), "輪の列が上の札より上に無い").toBe(true);
        expect(follows(cards, tabs), "上の札が切り替えより上に無い").toBe(true);
        expect(follows(tabs, panel), "切り替えが中身より上に無い").toBe(true);
    });

    it("価値の一文（見出し）が最上部: 輪・上の札・アプリの札より上（2026-11-09・9人のレビュー）", async () => {
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        const h1 = screen.getByRole("heading", { level: 1 });
        const stories = await screen.findByTestId("stories-bar");
        const cards = screen.getByTestId("home-top-cards");
        const app = screen.getByTestId("app-install-card");
        expect(follows(h1, stories), "見出しが輪の列より下").toBe(true);
        expect(follows(h1, cards), "見出しが上の札より下").toBe(true);
        expect(follows(cards, app), "アプリの札が上の札より上").toBe(true);
    });

    it("ホームのアプリの札は小さい形（compact）・入口の帯は無い（2026-11-12・すぐ下の日本地図と重なる）", () => {
        render(<GalleryPageClient seasonalSpots={SEASONAL} />);
        const app = screen.getByTestId("app-install-card");
        expect(app.className.split(/\s+/), "ホームのアプリの札が大きい形").toContain("p-3");
        expect(screen.queryByTestId("home-entry-band"), "入口の帯が戻った").toBeNull();
    });

    it("「さがす」の面には輪の列を出さない", async () => {
        render(<GalleryPageClient surface="search" />);
        // 遅れて読む部品が届くのを待ってから「無い」を見る（ホームの面を同じ形で描いて届くことを確かめる）
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByTestId("stories-bar")).toBeNull();
    });

    it("切り替えは見出しの下に留まる行に入っている（`position: sticky`・見出しの高さの下）", () => {
        render(<GalleryPageClient />);
        const row = screen.getByTestId("home-feed-row");
        expect(row).toContainElement(screen.getByRole("tablist"));
        const cls = row.className.split(/\s+/);
        expect(cls).toEqual(expect.arrayContaining(["sticky", "top-[var(--header-h)]", "bg-bg"]));
    });

    // 柱が見出しの下 16 に留まると、上の 29px が留まった行（45）の裏に隠れた（1280×900 の実測）
    it("PC の右の柱は、留まった切り替えの行の下に留まる", () => {
        render(<GalleryPageClient />);
        fireEvent.click(screen.getByRole("tab", { name: "新着" }));
        const cls = screen.getByTestId("home-rail").className.split(/\s+/);
        expect(cls).toContain("lg:top-[calc(var(--header-h)_+_45px_+_16px)]");
        expect(cls).toContain("lg:max-h-[calc(100vh_-_var(--header-h)_-_45px_-_var(--bottom-bar-h,84px)_-_32px)]");
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

/**
 * 「おすすめ」「新着」で写真が0枚のときの形（iOS の `GalleryView`: 読み込み中は `JPLoadingState(kind: .grid)`、
 * 失敗は `ErrorBanner`、0件は `feedEmptyState`）。手元の控えも空のときだけここに来る
 */
describe("写真が0枚のときの形（iOS と同じ）", () => {
    beforeEach(() => { photosRef.list = []; });

    for (const tab of ["おすすめ", "新着"]) {
        it(`${tab}: 一覧が届く前は灰の骨組み（文字だけの「読み込み中…」にしない・0件と言わない）`, async () => {
            photosRef.loaded = false;
            render(<GalleryPageClient />);
            fireEvent.click(screen.getByRole("tab", { name: tab }));
            expect(screen.getByTestId("home-loading")).toHaveAttribute("role", "status");
            expect(await screen.findByTestId("home-loading-bones")).toBeInTheDocument();
            expect(screen.queryByTestId("gallery-empty")).toBeNull();
        });

        it(`${tab}: 読めなかったら三角と「読み込めませんでした」と「もう一度試す」`, () => {
            photosRef.loaded = false;
            photosRef.failed = true;
            const retry = vi.fn();
            photosRef.retry = retry;
            render(<GalleryPageClient />);
            fireEvent.click(screen.getByRole("tab", { name: tab }));
            expect(screen.getByTestId("home-error")).toHaveTextContent("読み込めませんでした");
            expect(screen.queryByTestId("gallery-empty")).toBeNull();
            fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
            expect(retry).toHaveBeenCalledTimes(1);
        });

        it(`${tab}: 0件は「該当する写真がありません。」と主ボタン「撮影地を地図で探す」`, () => {
            render(<GalleryPageClient />);
            fireEvent.click(screen.getByRole("tab", { name: tab }));
            expect(screen.getByTestId("gallery-empty")).toHaveTextContent("該当する写真がありません。");
            const action = screen.getByRole("link", { name: "撮影地を地図で探す" });
            expect(action.getAttribute("href")).toBe("/map");
            expect(action.className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-accent-fill", "text-ink"]));
        });
    }
});
