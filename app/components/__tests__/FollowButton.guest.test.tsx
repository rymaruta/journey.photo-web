import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 2026-11-09: 未ログインでフォローを押したら、文言だけで終わらせず「ログイン」リンク付きの案内（info・via=follow）。
// 戻り先は押した頁（その人・その写真に返す）

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
    publicFetch: vi.fn(),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast }) }));

const { FollowAction } = await import("../FollowButton");

beforeEach(() => {
    showToast.mockReset();
    window.history.replaceState({}, "", "/users/22222222-2222-4222-8222-222222222222");
});

describe("FollowAction: 未ログイン", () => {
    it.each([
        ["ja", "フォローするにはログインしてください", "ログイン", "フォロー"],
        ["en", "Log in to follow", "Log in", "Follow"],
    ])("%s: リンク付きの info", async (locale, msg, label, btn) => {
        render(<FollowAction targetUserId="22222222-2222-4222-8222-222222222222" isOwner={false} isAuthenticated={false} locale={locale as "ja" | "en"} />);
        const b = await screen.findByRole("button", { name: new RegExp(btn) });
        await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(b);
        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast).toHaveBeenCalledWith(msg, "info", 6000, {
            label,
            href: "/login?next=%2Fusers%2F22222222-2222-4222-8222-222222222222&via=follow",
        });
    });
});
