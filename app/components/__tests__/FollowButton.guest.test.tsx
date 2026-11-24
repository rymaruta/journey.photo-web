import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 2026-11-09: 未ログインでフォローを押したら、文言だけで終わらせずログイン・新規登録の入口を出す（via=follow）。
// 戻り先は押した頁（その人・その写真に返す）。
// 2026-11-20（札 journey.photo-ios#664）: 入口を小さなトーストから案内の板に替えた。
// 板のリンクにも via=follow を残し、`login_prompt`{follow} は板を出した回だけ数える

const showToast = vi.hoisted(() => vi.fn());
const gtag = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
    publicFetch: vi.fn(),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../UserAvatar", () => ({ default: () => <div data-testid="avatar" /> }));

const { FollowAction } = await import("../FollowButton");

const T = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
    showToast.mockReset();
    gtag.mockReset();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
    sessionStorage.clear();
    window.history.replaceState({}, "", `/users/${T}`);
});

describe("FollowAction: 未ログイン", () => {
    it.each([
        ["ja", "フォロー"],
        ["en", "Follow"],
    ])("%s: 案内の板（ログイン・新規登録に via=follow と戻り先）", async (locale, btn) => {
        render(<FollowAction targetUserId={T} isOwner={false} isAuthenticated={false} locale={locale as "ja" | "en"} />);
        const b = await screen.findByRole("button", { name: new RegExp(btn) });
        await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(b);
        const primary = await screen.findByTestId("follow-login-primary");
        const signup = screen.getByTestId("follow-login-signup");
        await waitFor(() => expect(primary.getAttribute("href")).toContain("via=follow"));
        expect(primary.getAttribute("href")!.startsWith(`/login?next=${encodeURIComponent(`/users/${T}`)}`)).toBe(true);
        expect(signup.getAttribute("href")!.startsWith(`/signup?next=${encodeURIComponent(`/users/${T}`)}`)).toBe(true);
        expect(signup.getAttribute("href")).toContain("via=follow");
        // 小さなトーストは出さない（板に替えた）
        expect(showToast).not.toHaveBeenCalled();
    });

    it("login_prompt{follow} を板を出した回だけ数える", async () => {
        render(<FollowAction targetUserId={T} isOwner={false} isAuthenticated={false} locale="ja" />);
        const b = await screen.findByRole("button", { name: /フォロー/ });
        await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(b);
        await screen.findByTestId("follow-login-sheet");
        const prompts = () => gtag.mock.calls.filter((c) => c[1] === "login_prompt");
        await waitFor(() => expect(prompts()).toHaveLength(1));
        expect(prompts()[0][2]).toMatchObject({ trigger: "follow" });
    });
});
