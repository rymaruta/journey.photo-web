import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

// **共有画像の保存は持ち主だけ**（2026-11-15・札 journey.photo-ios#629）。
// CLAUDE.md「他人の写真は、その人のもの」: 他人の写真の画像を手にできる道（共有カードの画像の書き出し）は持ち主だけ。
// 持ち主の写真へ人を連れて行くもの（共有・リンクのコピー・X・LINE）は誰にでも残す。

const authState = vi.hoisted(() => ({
    current: { isAuthenticated: false, userId: null as string | null, loading: false },
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn(async () => ({ ok: true })) }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/owner-1/a.jpg",
    userId: "owner-1",
    title: "テスト写真",
} as unknown as Photo;

const SAVE = /共有画像を保存/;

async function openMenu() {
    render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
    await screen.findByText("テスト写真");
    fireEvent.click(screen.getByRole("button", { name: "その他" }));
    return screen.getAllByRole("menuitem").map((m) => m.textContent ?? "");
}

beforeEach(() => {
    authState.current = { isAuthenticated: false, userId: null, loading: false };
});

describe("共有画像の保存は持ち主だけ", () => {
    it("ログインしていない人には出さない（リンクの共有は残す）", async () => {
        const items = await openMenu();
        expect(items.filter((t) => SAVE.test(t))).toEqual([]);
        expect(items).toEqual(expect.arrayContaining(["共有", "リンクをコピー", "Xで共有", "LINEで共有"]));
    });

    it("ログインしている他人には出さない", async () => {
        authState.current = { isAuthenticated: true, userId: "someone-else", loading: false };
        const items = await openMenu();
        expect(items.filter((t) => SAVE.test(t))).toEqual([]);
        expect(items).toContain("リンクをコピー");
    });

    it("持ち主には3つの比率を出す", async () => {
        authState.current = { isAuthenticated: true, userId: "owner-1", loading: false };
        const items = await openMenu();
        expect(items.filter((t) => SAVE.test(t))).toEqual(["共有画像を保存（4:5）", "共有画像を保存（9:16）", "共有画像を保存（1:1）"]);
    });

    it("ログインの確かめ中は出さない（持ち主と分かってから出す）", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: true };
        const items = await openMenu();
        expect(items.filter((t) => SAVE.test(t))).toEqual([]);
    });
});
