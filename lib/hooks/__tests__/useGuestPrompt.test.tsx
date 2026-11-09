import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../useToast", () => ({ useToast: () => ({ showToast }) }));

import { useGuestPrompt, GUEST_PROMPT_COPY } from "../useGuestPrompt";

// 2026-11-09: 未ログインの反応は、押した頁に戻れる「ログイン」リンク付きの案内（info）にする。
// 数えるのは案内を出した回（login_prompt・trigger だけ）
describe("useGuestPrompt", () => {
    const gtag = vi.fn();
    beforeEach(() => {
        showToast.mockReset();
        gtag.mockReset();
        sessionStorage.clear();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
        window.history.replaceState({}, "", "/photo/p1?x=1");
    });
    const prompts = () => gtag.mock.calls.filter((c) => c[1] === "login_prompt");

    it("文言・info・ログインのリンク（next=今の頁・via=押したもの）", () => {
        const { result } = renderHook(() => useGuestPrompt("ja"));
        result.current("like");
        expect(showToast).toHaveBeenCalledWith("いいねするにはログインしてください", "info", 6000,
            { label: "ログイン", href: "/login?next=%2Fphoto%2Fp1%3Fx%3D1&via=like" });
    });

    it("英語", () => {
        const { result } = renderHook(() => useGuestPrompt("en"));
        result.current("like");
        expect(showToast.mock.calls[0][0]).toBe("Log in to like");
        expect(showToast.mock.calls[0][3]).toEqual({ label: "Log in", href: "/login?next=%2Fphoto%2Fp1%3Fx%3D1&via=like" });
    });

    it("4つの入口が全部、リンク付き・via 付き", () => {
        const { result } = renderHook(() => useGuestPrompt("ja"));
        for (const t of ["like", "save", "follow", "comment"] as const) {
            showToast.mockReset();
            result.current(t);
            expect(showToast.mock.calls[0][0]).toBe(GUEST_PROMPT_COPY[t].ja);
            expect(showToast.mock.calls[0][1]).toBe("info");
            expect(showToast.mock.calls[0][3].href).toContain(`via=${t}`);
        }
    });

    it("サーバーが理由を言っている文はそのまま使う（リンクは付く）", () => {
        const { result } = renderHook(() => useGuestPrompt("ja"));
        result.current("follow", "セッションの有効期限が切れています");
        expect(showToast.mock.calls[0][0]).toBe("セッションの有効期限が切れています");
        expect(showToast.mock.calls[0][3].href).toContain("via=follow");
    });

    it("login_prompt を trigger だけで数える（写真の id・URL を送らない）", () => {
        const { result } = renderHook(() => useGuestPrompt("ja"));
        result.current("save");
        expect(prompts()).toHaveLength(1);
        expect(prompts()[0][2].trigger).toBe("save");
        expect(Object.keys(prompts()[0][2]).sort()).toEqual(["landing_type", "trigger"]);
        expect(JSON.stringify(gtag.mock.calls)).not.toContain("p1");
    });
});
