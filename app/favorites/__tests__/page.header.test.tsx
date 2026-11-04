import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { ja } from "@/app/i18n/labels";

/**
 * いいねした写真の頁の見出しの型と状態（2026-11-04・札 #478・iOS `FavoritesView`）。
 * 眉「LIKED · N枚」→ 明朝の題 → 一行 → 先頭が大きな1枚。読み込み中は灰の骨格、失敗は失敗の形。
 */
const photos = [
    { id: "a", src: "https://cdn.example.com/uploads/a.jpg", title: { ja: "写真A" }, tags: [] },
    { id: "b", src: "https://cdn.example.com/uploads/b.jpg", title: { ja: "写真B" }, tags: [] },
] as unknown as Photo[];
const local = vi.hoisted(() => ({ ids: [] as string[] }));
const likes = vi.hoisted(() => ({ photoIds: [] as string[], pending: false, failed: false, retry: vi.fn() }));
vi.mock("../../../lib/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: local.ids, isFavorite: () => false, toggle: vi.fn() }) }));
vi.mock("../../../lib/hooks/useMyServerLikes", () => ({ useMyServerLikes: () => likes }));
vi.mock("../../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos, loaded: true, failed: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: ja }) }));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));

const FavoritesPage = (await import("../page")).default;

beforeEach(() => { local.ids = []; likes.photoIds = []; likes.pending = false; likes.failed = false; });

describe("いいねした写真: 見出しの型", () => {
    it("眉に枚数・明朝の題・iOS と同じ一行", () => {
        local.ids = ["a", "b"];
        render(<FavoritesPage />);
        expect(screen.getByText("LIKED · 2枚")).toBeTruthy();
        const h1 = screen.getByRole("heading", { level: 1, name: "いいねした写真" });
        expect(h1.className).toContain("font-serif");
        expect(screen.getByText(/ハートを押した写真。作者に届き/)).toBeTruthy();
        expect(screen.getByText(/しおりで保存した写真はマイページの「保存」に/)).toBeTruthy();
    });

    it("聞いている間は枚数を言わない（眉は数なし）。灰の骨格を出す", () => {
        likes.pending = true;
        render(<FavoritesPage />);
        expect(screen.getByText("LIKED")).toBeTruthy();
        expect(screen.getByRole("status").textContent).toContain("読み込み中");
    });

    it("0件の一手は「写真を見に行く」", () => {
        render(<FavoritesPage />);
        expect(screen.getByText("まだいいねした写真がありません")).toBeTruthy();
        expect(screen.getByRole("link", { name: "写真を見に行く" }).getAttribute("href")).toBe("/");
    });

    it("写真が0枚で聞けなかったときは、失敗の形（0件と言わない）", () => {
        likes.failed = true;
        render(<FavoritesPage />);
        expect(screen.getByRole("alert").textContent).toContain("読み込めませんでした");
        expect(screen.queryByText("まだいいねした写真がありません")).toBeNull();
    });
});
