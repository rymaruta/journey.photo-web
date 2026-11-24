import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockLogin = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../auth/context", () => ({
    useAuth: () => ({ login: mockLogin, isAuthenticated: false, loading: false, userId: null }),
}));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => ({
    forgotPassword: vi.fn(), confirmForgotPassword: vi.fn(), PASSWORD_RULE_MESSAGE: "rule",
}));
vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children),
}));

import LoginPage from "../page";

describe("LoginPage - login の計測（2026-11-04）", () => {
    const gtag = vi.fn();
    beforeEach(() => {
        gtag.mockReset();
        mockLogin.mockReset();
        sessionStorage.clear();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
    });

    async function submit() {
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByLabelText(/メールアドレス/), "leak@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Secret1!x");
        await user.click(screen.getByRole("button", { name: /^ログイン$/ }));
    }

    it("ログインに成功したら login method=email を1回。メールもパスワードも送らない", async () => {
        mockLogin.mockResolvedValue({ success: true, userId: "u1" });
        await submit();
        await waitFor(() => expect(gtag.mock.calls.filter((c) => c[1] === "login")).toHaveLength(1));
        expect(gtag).toHaveBeenCalledWith("event", "login", expect.objectContaining({ method: "email" }));
        const all = JSON.stringify(gtag.mock.calls);
        expect(all).not.toContain("leak@example.com");
        expect(all).not.toContain("Secret1");
        expect(all).not.toContain("u1");
    });

    it("失敗した回は login を送らない", async () => {
        mockLogin.mockResolvedValue({ success: false, error: "ログインに失敗しました" });
        await submit();
        await waitFor(() => expect(mockLogin).toHaveBeenCalled());
        expect(gtag.mock.calls.filter((c) => c[1] === "login")).toEqual([]);
    });
});
