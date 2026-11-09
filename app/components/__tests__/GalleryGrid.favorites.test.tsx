// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// 2026-11-09: 未ログインのいいねは端末に溜めない。以前に端末へ残った古いお気に入りで、カードのハートを塗らない。
// 判定中も塗らない（古い控えで塗ったハートが、判定後に空になる一瞬を作らない）。ログイン済みは今まで通り塗る
const auth = vi.hoisted(() => ({ current: { isAuthenticated: true, loading: false } }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth.current }));
vi.mock("../../../lib/hooks/useFavorites", () => ({
    useFavorites: () => ({ favorites: ["p1"], isFavorite: (id: string) => id === "p1", toggleFavorite: vi.fn() }),
}));

import GalleryGrid from "../GalleryGrid";
import { GRID_SIZES_5XL } from "../gridSizes";
import type { Photo } from "@/lib/data/photos";

const photos: Photo[] = [{ id: "p1", src: "https://cdn.example.com/p1.jpg", title: { ja: "写真", en: "Photo" }, tags: [] }];
const hearts = (c: HTMLElement) => c.querySelectorAll("svg.text-white").length;

beforeEach(() => { auth.current = { isAuthenticated: true, loading: false }; });

describe("GalleryGrid: 端末のお気に入りのハート", () => {
    it("ログイン済みは塗る", () => {
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={photos} locale="ja" />);
        expect(hearts(container)).toBe(1);
    });

    it("未ログインは、端末に古いお気に入りが残っていても塗らない", () => {
        auth.current = { isAuthenticated: false, loading: false };
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={photos} locale="ja" />);
        expect(hearts(container)).toBe(0);
    });

    it("判定中も塗らない", () => {
        auth.current = { isAuthenticated: false, loading: true };
        const { container } = render(<GalleryGrid sizes={GRID_SIZES_5XL} photos={photos} locale="ja" />);
        expect(hearts(container)).toBe(0);
    });
});
