import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **ホームの上段のめくる札**（`HomeTopCards`・2026-10-31 束 1 H2・iOS の `HomeTopCardView`）。
// 今週のお題 → 今日の一問 → 撮影スポット の札を、ホームの3つのタブのどれでも同じ位置（タブの直下）に
// 1列で出し、「さがす」の面には出さない。以前は文字だけの帯 3 本（`QuizEntry`・`SpotsEntry`・`ThemeEntry`）
const mockUserFetch = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, userId: "me" as string | null, loading: false },
}));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
// 既定文言に落ちたことが見えるよう、本物に近い形で出す
vi.mock("../components/GalleryGrid", () => ({
    default: ({ photos }: { photos: unknown[] }) =>
        photos.length === 0 ? <div>該当する写真がありません。</div> : <div>grid</div>,
}));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// 既定は**1枚も無い環境**（新しい環境・公開が全部消えた）。
// テストごとに差し替えられるよう、authState と同じ形にする
const photosState = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ loaded: true, photos: photosState.current }),
}));
vi.mock("../data/photos.json", () => ({ default: [] }));

import ToastProvider from "../components/ToastProvider";
const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(async () => {
    authState.current = { isAuthenticated: false, userId: null, loading: false };
    window.history.replaceState({}, "", "/");
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
    photosState.current = [];
    // 今日の一問のファイル（`/app/data/quiz/<日>.json`）は無い日にする（外へ取りに行かない）
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

const cards = () => screen.getByTestId("home-top-cards");
const order = () => [...cards().querySelectorAll("li")].map((li) =>
    (li.querySelector("[data-testid=home-theme-card],[data-testid=home-quiz-entry],[data-testid=home-spots-entry]") as HTMLElement).dataset.testid);

describe("ホームの上段の札", () => {
    it("タブの直下に札の並び（今週のお題 → 今日の一問 → 撮影スポット）", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await screen.findByTestId("home-top-cards");
        expect(screen.getByRole("tablist").nextElementSibling).toBe(cards());
        expect(order()).toEqual(["home-theme-card", "home-quiz-entry", "home-spots-entry"]);
    });

    it("札の形は iOS と同じ（背 116・角 16・地 surface・白8% の縁・明朝 18 の題・眉は真鍮）", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const quiz = await screen.findByTestId("home-quiz-entry");
        // 背はどれも 116（iOS #422・2行に伸びて並びの背が 156 にならない）
        for (const c of ["h-[116px]", "rounded-2xl", "bg-surface", "ring-line"]) expect(quiz.className.split(/\s+/)).toContain(c);
        // 「以上 116」ではなく「116」（min-h だと2行に伸びて並びの背が上がる）
        expect(screen.getByTestId("home-theme-card").className.split(/\s+/)).toContain("h-[116px]");
        expect(quiz.className).not.toContain("min-h-[116px]");
        const title = quiz.querySelector(".font-serif") as HTMLElement;
        expect(title.style.fontSize).toBe("18px");
        expect(title.className, "題は1行").toContain("truncate");
        expect(quiz.querySelector(".eyebrow")!.className).toContain("text-accent");
    });

    it("PC は 3 枚を並べ、電話は横にめくる（PC の幅の決まり W4）", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const ul = (await screen.findByTestId("home-top-cards")).querySelector("ul")!;
        expect(ul.className).toContain("overflow-x-auto");
        expect(ul.className).toContain("lg:grid-cols-3");
        expect(ul.style.scrollSnapType).toBe("x mandatory");
        // 読み上げ用の字（sr-only・絶対配置）が並びの切り取りの外へ出て頁を横に広げない
        expect(ul.className.split(/\s+/)).toContain("relative");
    });

    it("「さがす」の面には出さない", async () => {
        render(<ToastProvider><GalleryPageClient surface="search" /></ToastProvider>);
        await waitFor(() => expect(screen.queryByRole("tablist")).toBeNull());
        expect(screen.queryByTestId("home-top-cards")).toBeNull();
    });
});

describe("ホームの今日の一問の札", () => {
    it("行き先は /q・先読みしない", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const entry = await screen.findByTestId("home-quiz-entry");
        expect(entry.getAttribute("href")).toBe("/q");
        expect(entry.textContent).toContain("この写真はどこ？");
        expect(entry.textContent).toContain("今日の一問");
    });
});

describe("ホームの撮影スポットの札", () => {
    it("行き先は /spots", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const entry = await screen.findByTestId("home-spots-entry");
        expect(entry.getAttribute("href")).toBe("/spots");
        expect(entry.textContent).toContain("撮影スポット");
    });

    it("どのタブでも出る（タブを切り替えても位置が動かない）", async () => {
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        for (const tab of screen.getAllByRole("tab")) {
            fireEvent.click(tab);
            await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
            expect(screen.getByTestId("home-spots-entry")).toBeTruthy();
        }
    });
});

// アプリの「今週のお題」（`WeeklyThemeCard`・札 journey.photo-ios#537 案2）: 眉の右に #タグ・題・一言・「参加する →」でタグ入りの投稿画面へ
describe("ホームの今週のお題の札", () => {
    it("「参加する」はお題のタグを入れた投稿画面へ", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const entry = await screen.findByTestId("home-theme-entry");
        const { weeklyThemeFor } = await import("@/lib/utils/weeklyTheme");
        const tag = weeklyThemeFor().tag;
        await waitFor(() => expect(entry.getAttribute("href")).toBe(`/user/upload?tag=${encodeURIComponent(tag)}`));
        expect(entry.textContent).toContain("参加する");
        // 題の右の小さいボタン（見た目 36・当たりは上下 4 ずつ広げて 44）
        expect(entry.style.minHeight).toBe("36px");
        expect(entry.className).toContain("before:-inset-y-[4px]");
        const title = screen.getByTestId("home-theme-card").querySelector(".font-serif")!;
        expect(title.parentElement!.contains(entry), "参加するは題の右（同じ行）").toBe(true);
        const card = screen.getByTestId("home-theme-card");
        expect(card.textContent).toContain(`#${tag}`);
        expect(card.textContent).toContain("今週のお題");
        // 今週の参加が無い週は一言のまま（みんなの参加の行は出さない）
        expect(screen.queryByTestId("home-theme-participants")).toBeNull();
        expect(entry.getAttribute("data-prefetch") ?? "").not.toBe("true");
    });
});

describe("今日の一問の札の写真と出典（その日のファイルが取れたとき）", () => {
    it("写真を左に置き、作者とライセンスを出す。答えた日は「答えました」", async () => {
        const { todayIn } = await import("@/lib/utils/sunTimes");
        const ymd = todayIn("Asia/Tokyo")!;
        const quiz = {
            date: ymd,
            photo: { url: "https://upload.wikimedia.org/a.jpg", author: "Taro", license: "CC BY 4.0", pageUrl: "https://commons.wikimedia.org/x" },
            choices: ["a", "b", "c", "d"].map((id) => ({ spotId: id, slug: id, name: id, region: { prefecture: "東京都" } })),
            answer: "a",
        };
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => quiz })));
        window.localStorage.setItem(`journey-photo:quiz:${ymd}`, "a");
        try {
            render(<ToastProvider><GalleryPageClient /></ToastProvider>);
            const entry = await screen.findByTestId("home-quiz-entry");
            await waitFor(() => expect(entry.querySelector("img")?.getAttribute("src")).toBe("https://upload.wikimedia.org/a.jpg"));
            expect(entry.textContent).toContain("写真: Taro / CC BY 4.0");
            // 出典は1行で、**真ん中を省く**（作者を切り、ライセンス名は切らない）
            const credit = screen.getByTestId("top-card-credit");
            expect(credit.firstElementChild!.className).toContain("truncate");
            expect(credit.lastElementChild!.textContent).toBe(" / CC BY 4.0");
            expect(credit.lastElementChild!.className).toContain("flex-shrink-0");
            expect(entry.textContent).toContain("答えました");
        } finally {
            window.localStorage.removeItem(`journey-photo:quiz:${ymd}`);
        }
    });
});

describe("今週のお題の参加済み・みんなの参加（iOS の `WeeklyTheme.hasJoined`・`participants`）", () => {
    it("今週お題のタグで投稿した人には、押せない「参加済み」を出す", async () => {
        const { weeklyThemeFor } = await import("@/lib/utils/weeklyTheme");
        const tag = weeklyThemeFor().tag;
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        photosState.current = [{ id: "m1", src: "https://cdn/m.jpg", userId: "me", tags: [tag], createdAt: new Date().toISOString(), date: "2026-10-31" }];
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const joined = await screen.findByTestId("home-theme-joined");
        expect(joined.textContent).toContain("参加済み");
        expect(joined.tagName, "押せない印").toBe("SPAN");
        expect(screen.queryByTestId("home-theme-entry")).toBeNull();
    });

    it("先週の投稿・ほかのタグでは参加済みにしない", async () => {
        const { weeklyThemeFor, hasJoinedTheme } = await import("@/lib/utils/weeklyTheme");
        const { tagKey } = await import("@/lib/utils/collections");
        const theme = weeklyThemeFor();
        const lastWeek = new Date(Date.now() - 8 * 86_400_000).toISOString();
        expect(hasJoinedTheme(theme, [{ tags: [theme.tag], createdAt: lastWeek }], tagKey)).toBe(false);
        expect(hasJoinedTheme(theme, [{ tags: ["別のタグ"], createdAt: new Date().toISOString() }], tagKey)).toBe(false);
        expect(hasJoinedTheme(theme, [{ tags: [theme.tag], createdAt: new Date().toISOString() }], tagKey)).toBe(true);
    });

    it("今週ほかの人がお題で載せたら、一言の行を「みんなの参加」の行に替える（押すとお題のタグで絞ったさがす）", async () => {
        const { weeklyThemeFor } = await import("@/lib/utils/weeklyTheme");
        const tag = weeklyThemeFor().tag;
        photosState.current = [{ id: "o1", src: "https://cdn/o.jpg", userId: "other", tags: [tag], createdAt: new Date().toISOString(), date: "2026-10-31" }];
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const row = await screen.findByTestId("home-theme-participants");
        expect(row.getAttribute("href")).toBe(`/search?tags=${encodeURIComponent(tag)}`);
        expect(row.textContent).toContain("今週 1件の投稿");
        expect(row.textContent).toContain("みんなの参加");
        // 見た目 24・当たりは下だけ 20 広げて 44（上は「参加する」の当たり〈下に 4〉と行の間 4 で接するので広げない）
        expect(row.style.height).toBe("24px");
        expect(row.className).toContain("before:top-0");
        expect(row.className).toContain("before:-bottom-[20px]");
        expect(row.className).not.toContain("-inset-y-");
        const join = screen.queryByTestId("home-theme-entry");
        if (join) expect(join.className).toContain("before:-inset-y-[4px]");
    });
});

// 🔴 **ホームの写真の並びに「はじめての投稿」の印を渡す**（札 journey.photo-ios#537 の確かめ役）。
// `GalleryPageClient` が `HomeMosaic` に印の写真を渡し忘れると、印の部品は試験が通っても画面には出ない
describe("ホームの写真のはじめての投稿の印", () => {
    it("持ち主の公開の 1 枚目が 72 時間以内なら、その写真に印が出る", async () => {
        photosState.current = [
            { id: "first", src: "https://cdn/f.jpg", userId: "newbie", tags: [], createdAt: new Date(Date.now() - 3_600_000).toISOString(), date: "2026-11-11" },
            { id: "old", src: "https://cdn/o.jpg", userId: "regular", tags: [], createdAt: "2026-01-01T00:00:00.000Z", date: "2026-01-01" },
        ];
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(document.querySelector('[data-photo-id="first"] [data-testid="home-first-post"]')).not.toBeNull());
        expect(document.querySelector('[data-photo-id="old"] [data-testid="home-first-post"]')).toBeNull();
    });
});
