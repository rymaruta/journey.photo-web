import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * **設定の下の画面**（2026-11-04・iOS の `SettingsPage`／`BlockedUsersView`／`CloseFriendsView`／
 * `ChangePasswordView`／`LegalLinksView` と同じく、設定の行 → 画面）。
 *
 * どの画面も同じ入れ物（`SettingsShell`）: 明朝 30 の大見出し・「設定」へ戻る・ログインだけ見る門。
 */

const mockReplace = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ value: { isAuthenticated: true, loading: false, userId: "me" } as Record<string, unknown> }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => mockAuth.value }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../BlockedUsers", () => ({ default: () => <div data-testid="blocked-body" /> }));
vi.mock("../CloseFriends", () => ({ default: ({ userId }: { userId: string }) => <div data-testid="close-friends-body">{userId}</div> }));
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    getCurrentEmail: async () => "me@example.com",
}));

const pages = {
    blocked: (await import("../blocked/page")).default,
    closeFriends: (await import("../close-friends/page")).default,
    legal: (await import("../legal/page")).default,
    email: (await import("../email/page")).default,
    password: (await import("../password/page")).default,
};

beforeEach(() => {
    mockReplace.mockReset();
    mockAuth.value = { isAuthenticated: true, loading: false, userId: "me" };
});

describe("設定の下の画面", () => {
    it.each([
        ["blocked", "ブロックした人"],
        ["closeFriends", "親しい友達"],
        ["legal", "利用規約・プライバシーポリシー"],
        ["email", "メールアドレスを変える"],
        ["password", "パスワードを変える"],
    ] as const)("%s: 明朝 30 の大見出し「%s」と、設定へ戻るリンク", async (key, title) => {
        const Page = pages[key];
        render(<Page />);
        const h1 = await screen.findByRole("heading", { level: 1, name: title });
        expect(h1.className).toMatch(/font-serif/);
        expect(h1.className).toMatch(/text-\[30px\]/);
        expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute("href", "/user/settings");
    });

    it("ブロックした人: iOS と同じ説明を題の下に出し、一覧の部品を描く", async () => {
        render(<pages.blocked />);
        expect(await screen.findByText("ブロックすると、おたがいの投稿・ストーリー・通知が見えなくなります。")).toBeInTheDocument();
        expect(screen.getByTestId("blocked-body")).toBeInTheDocument();
    });

    it("親しい友達: 自分の id を渡して部品を描く", async () => {
        render(<pages.closeFriends />);
        expect((await screen.findByTestId("close-friends-body")).textContent).toBe("me");
    });

    it("利用規約・プライバシーポリシー: 2つの頁へ真鍮のリンク", async () => {
        render(<pages.legal />);
        const terms = await screen.findByRole("link", { name: /^利用規約/ });
        const privacy = screen.getByRole("link", { name: /^プライバシーポリシー/ });
        expect(terms).toHaveAttribute("href", "/terms");
        expect(privacy).toHaveAttribute("href", "/privacy");
        expect(terms.querySelector(".text-accent")).not.toBeNull();
    });

    it("パスワードを変える: 主ボタンは「変える」（真鍮の塗りに墨）", async () => {
        render(<pages.password />);
        const btn = await screen.findByRole("button", { name: "変える" });
        expect(btn.className).toMatch(/bg-accent-fill/);
        expect(btn.className).toMatch(/text-ink/);
    });

    it.each(Object.keys(pages) as Array<keyof typeof pages>)("%s: 未ログインならログインへ送り、中身を描かない", async (key) => {
        mockAuth.value = { isAuthenticated: false, loading: false, userId: null };
        const Page = pages[key];
        render(<Page />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
        expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
        expect(screen.getByTestId("state-loading")).toBeInTheDocument();
    });
});
