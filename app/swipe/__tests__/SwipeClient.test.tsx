import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

// 撮影スポットを払う画面（`/swipe`・2026-11-11）。未ログインでも払える・結果はログインしてから・
// ログインして戻ったら端末の鍵を送って消す・5枚で挟む札（窓で止めない）
const mockUserFetch = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: false, userId: null as string | null, loading: false },
}));
vi.mock("../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import ToastProvider from "../../components/ToastProvider";
import SwipeClient from "../SwipeClient";

const CARDS = Array.from({ length: 30 }, (_, i) => ({
    slug: `s${i}`, name: `スポット${i}`, region: "北海道", src: `/images/spots/thumb/s${i}.jpg`, alt: `スポット${i}`,
    credit: { author: "作者", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg" },
}));

beforeEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    authState.current = { isAuthenticated: false, userId: null, loading: false };
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/app/data/swipe.json"
        ? { ok: true, status: 200, json: async () => CARDS }
        : { ok: false, status: 404, json: async () => ({}) })));
    // 動きを減らす設定にして、飛ばす間を待たずに決める
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
});

const show = () => render(<ToastProvider><SwipeClient /></ToastProvider>);
const currentSlug = () => screen.getByTestId("swipe-card").getAttribute("data-slug")!;
const wantsInStorage = () => JSON.parse(window.localStorage.getItem("jp-swipe-wants") ?? "[]") as string[];

describe("未ログインでも払える", () => {
    it("行きたい・見送る・ひとつ戻す（ボタン）。行きたいは端末に撮影スポットの鍵だけ", async () => {
        show();
        await screen.findByTestId("swipe-card");
        const first = currentSlug();
        fireEvent.click(screen.getByTestId("swipe-want"));
        await waitFor(() => expect(currentSlug()).not.toBe(first));
        expect(wantsInStorage()).toEqual([`SPOT-${first}`]);
        expect(screen.getByTestId("swipe-count").textContent).toBe("行きたい 1 か所");

        const second = currentSlug();
        fireEvent.click(screen.getByTestId("swipe-pass"));
        await waitFor(() => expect(currentSlug()).not.toBe(second));
        expect(wantsInStorage()).toEqual([`SPOT-${first}`]);

        // 戻す（見送った札が戻る）→ もう一度戻す（行きたいが外れる）
        fireEvent.click(screen.getByTestId("swipe-undo"));
        await waitFor(() => expect(currentSlug()).toBe(second));
        fireEvent.click(screen.getByTestId("swipe-undo"));
        await waitFor(() => expect(currentSlug()).toBe(first));
        expect(wantsInStorage()).toEqual([]);
        expect(mockUserFetch, "未ログインはサーバーへ送らない").not.toHaveBeenCalled();
    });

    it("キーボードの → ← でも同じ", async () => {
        show();
        await screen.findByTestId("swipe-card");
        const first = currentSlug();
        fireEvent.keyDown(window, { key: "ArrowRight" });
        await waitFor(() => expect(currentSlug()).not.toBe(first));
        expect(wantsInStorage()).toEqual([`SPOT-${first}`]);
    });

    it("写真の出典を写真と一緒に出す（撮影スポットの頁と同じ形）", async () => {
        show();
        await screen.findByTestId("swipe-card");
        expect(screen.getByTestId("topic-credit").textContent).toContain("CC BY-SA 4.0");
        expect(screen.getByTestId("topic-credit").textContent).toContain("作者");
    });

    it("足元の「地図で見る」はログインへ（戻り先は払う画面・via=swipe）", async () => {
        show();
        await screen.findByTestId("swipe-card");
        expect(screen.getByTestId("swipe-map").getAttribute("href")).toBe("/login?next=%2Fswipe&via=swipe");
    });
});

describe("挟む札（窓で止めない）", () => {
    it("5枚払って行きたいが1つ以上なら山の中に1枚。続けたら次は10枚あと", async () => {
        show();
        await screen.findByTestId("swipe-card");
        fireEvent.click(screen.getByTestId("swipe-want"));
        for (let i = 0; i < 3; i++) {
            const s = currentSlug();
            fireEvent.click(screen.getByTestId("swipe-pass"));
            await waitFor(() => expect(currentSlug()).not.toBe(s));
        }
        expect(screen.queryByTestId("swipe-pause"), "4枚ではまだ").toBeNull();
        fireEvent.click(screen.getByTestId("swipe-pass"));
        const pause = await screen.findByTestId("swipe-pause");
        expect(pause.textContent).toContain("選んだ 1 か所を、地図と旅行プランで");
        expect(screen.getByTestId("swipe-pause-action").getAttribute("href")).toBe("/login?next=%2Fswipe&via=swipe");
        expect(screen.getByTestId("swipe-pause-action").textContent).toBe("ログインして見る");
        // 左へ払う（← キー）で続ける
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        await screen.findByTestId("swipe-card");
        expect(screen.queryByTestId("swipe-pause")).toBeNull();
        for (let i = 0; i < 9; i++) {
            const s = currentSlug();
            fireEvent.click(screen.getByTestId("swipe-pass"));
            await waitFor(() => expect(currentSlug()).not.toBe(s));
        }
        expect(screen.queryByTestId("swipe-pause")).toBeNull();
        fireEvent.click(screen.getByTestId("swipe-pass"));
        await screen.findByTestId("swipe-pause");
    });

    it("行きたいが無ければ挟まない", async () => {
        show();
        await screen.findByTestId("swipe-card");
        for (let i = 0; i < 6; i++) {
            const s = currentSlug();
            fireEvent.click(screen.getByTestId("swipe-pass"));
            await waitFor(() => expect(currentSlug()).not.toBe(s));
        }
        expect(screen.queryByTestId("swipe-pause")).toBeNull();
    });
});

describe("次に開いたときは続きから", () => {
    it("払った札は出さない", async () => {
        window.localStorage.setItem("jp-swipe-seen", JSON.stringify(CARDS.slice(0, 29).map((c) => `SPOT-${c.slug}`)));
        show();
        await screen.findByTestId("swipe-card");
        expect(currentSlug()).toBe("s29");
    });
});

describe("ログインして戻った", () => {
    it("端末の鍵を POST /user/spots で送って消し、「移しました」と地図", async () => {
        window.localStorage.setItem("jp-swipe-wants", JSON.stringify(["SPOT-s1", "SPOT-s2"]));
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        show();
        const moved = await screen.findByTestId("swipe-moved");
        expect(moved.textContent).toContain("払った 2 か所を、行きたい場所に移しました");
        expect(moved.querySelector("a")!.getAttribute("href")).toBe("/saved-spots/map");
        const posts = mockUserFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
        expect(posts.map(([path, init]) => [path, JSON.parse(String((init as RequestInit).body)).slug]))
            .toEqual([["/user/spots", "SPOT-s1"], ["/user/spots", "SPOT-s2"]]);
        expect(window.localStorage.getItem("jp-swipe-wants")).toBeNull();
        // 移した2か所は足元の数に入り、山には出ない（取り直す前のサーバーの一覧に無くても・確かめ役の指摘 10）
        await waitFor(() => expect(screen.getByTestId("swipe-count").textContent).toBe("行きたい 2 か所"));
        for (let i = 0; i < 28; i++) {
            const s = currentSlug();
            expect(["s1", "s2"]).not.toContain(s);
            fireEvent.click(screen.getByTestId("swipe-pass"));
            if (i < 27) await waitFor(() => expect(currentSlug()).not.toBe(s));
        }
    });

    it("ログイン中の行きたいはその場で行きたい場所へ・地図は本人の地図", async () => {
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        show();
        await screen.findByTestId("swipe-card");
        expect(screen.getByTestId("swipe-map").getAttribute("href")).toBe("/saved-spots/map");
        const first = currentSlug();
        await act(async () => { fireEvent.click(screen.getByTestId("swipe-want")); });
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/spots", expect.objectContaining({ method: "POST", body: JSON.stringify({ slug: `SPOT-${first}` }) })));
        expect(window.localStorage.getItem("jp-swipe-wants")).toBeNull();
    });
});
