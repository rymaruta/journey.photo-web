import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 2026-11-09 owner 承認「未ログインの反応を登録の入口にする」。
// 以前: 未ログインでハートを押すと塗られ、端末の localStorage に溜まるだけ（件数も通知も動かず、案内も無い）。
// 今: ハートは塗らず、端末にも保存せず、「ログイン」リンク付きの案内（info）を出す。
// **押す道は3つ**（ボタン・ダブルタップ・キーボード h）。どれも同じ口を通る

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/utils/api")>()),
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import { resetFavoritesCache } from "../../../lib/hooks/useFavorites";
import GalleryModal from "../GalleryModal";
import type { Photo } from "@/lib/data/photos";

const photos: Photo[] = [{ id: "p1", src: "https://cdn/p1.jpg", title: { ja: "1枚目", en: "1" }, tags: [], likes: 3 }];

beforeEach(() => {
    localStorage.clear();
    resetFavoritesCache();
    mockShowToast.mockReset();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 3 }) });
    mockUserFetch.mockReset();
    window.history.replaceState({}, "", "/?photo=p1");
});

async function mounted() {
    render(<GalleryModal photos={photos} currentIndex={0} onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />);
    return await screen.findByRole("button", { name: "いいね" });
}
const expectPrompt = async () => {
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(
        "いいねするにはログインしてください", "info", 6000,
        { label: "ログイン", href: "/login?next=%2F%3Fphoto%3Dp1&via=like" });
    // 赤い失敗の文言は出さない
    expect(mockShowToast.mock.calls.map((c) => String(c[1]))).not.toContain("error");
};
const expectNothingSaved = (_heart: HTMLElement) => {
    // 塗られると読み上げ名が「いいねを取り消す」に変わる（ModalControls）
    expect(screen.queryByRole("button", { name: "いいねを取り消す" }), "ハートが塗られている").toBeNull();
    expect(screen.getByRole("button", { name: "いいね" })).toBeTruthy();
    expect(localStorage.getItem("photo-gallery-favorites"), "端末に溜めている").toBeNull();
    expect(mockUserFetch, "サーバーへは送らない").not.toHaveBeenCalled();
};

describe("モーダルのいいね: 未ログイン", () => {
    it("ボタン: 案内を出し、ハートは塗らない", async () => {
        const heart = await mounted();
        fireEvent.click(heart);
        await expectPrompt();
        expectNothingSaved(screen.getByRole("button", { name: "いいね" }));
    });

    it("ダブルタップ: 同じ案内", async () => {
        const heart = await mounted();
        const img = document.querySelector("img")!;
        fireEvent.click(img, { clientX: 10, clientY: 10 });
        fireEvent.click(img, { clientX: 12, clientY: 12 });
        await expectPrompt();
        expectNothingSaved(heart);
    });

    it("キーボード（h）: 同じ案内", async () => {
        const heart = await mounted();
        fireEvent.keyDown(document, { key: "h" });
        await expectPrompt();
        expectNothingSaved(heart);
    });
});
