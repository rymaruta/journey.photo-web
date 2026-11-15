import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SignUpLoginLinks from "../SignUpLoginLinks";

// ログインのお願いに並べる「新規登録」と「ログイン」（札 journey.photo-ios#630、2026-11-15）
describe("SignUpLoginLinks", () => {
    it("新規登録が先（主）、ログインが隣。どちらも戻り先つきで今の頁へ、当たり 44", () => {
        render(<SignUpLoginLinks locale="ja" next="/trips" testIdPrefix="t" />);
        const signup = screen.getByTestId("t-signup");
        const login = screen.getByTestId("t-login");
        expect(signup.textContent).toBe("新規登録");
        expect(signup.getAttribute("href")).toBe("/signup?next=%2Ftrips");
        expect(login.textContent).toBe("ログイン");
        expect(login.getAttribute("href")).toBe("/login?next=%2Ftrips");
        expect(signup.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING, "新規登録が先に無い").toBeTruthy();
        expect(signup.style.minHeight).toBe("44px");
        expect(login.style.minHeight).toBe("44px");
    });

    it("写真の無い頁は主ボタンを真鍮の塗りに墨、写真のある頁は線のボタン", () => {
        const { unmount } = render(<SignUpLoginLinks locale="ja" next="/saves" variant="fill" testIdPrefix="f" />);
        expect(screen.getByTestId("f-signup").className).toContain("bg-accent-fill");
        expect(screen.getByTestId("f-signup").className).toContain("text-ink");
        unmount();
        render(<SignUpLoginLinks locale="ja" next="/" testIdPrefix="o" />);
        expect(screen.getByTestId("o-signup").className).toContain("border-line-strong");
        expect(screen.getByTestId("o-signup").className).not.toContain("bg-accent-fill");
    });

    it("外の頁は戻り先に添えない。英語", () => {
        render(<SignUpLoginLinks locale="en" next="//evil.example" testIdPrefix="e" />);
        expect(screen.getByTestId("e-signup").getAttribute("href")).toBe("/signup");
        expect(screen.getByTestId("e-signup").textContent).toBe("Sign up");
        expect(screen.getByTestId("e-login").getAttribute("href")).toBe("/login");
    });
});
