import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../useToast", () => ({ useToast: () => ({ showToast }) }));

import { useGuestPrompt, GUEST_PROMPT_COPY, resetGuestPromptThrottle } from "../useGuestPrompt";

// 2026-11-09: 未ログインの反応は、押した頁に戻れる「ログイン」リンク付きの案内（info）にする。
// 数えるのは案内を出した回（login_prompt・trigger だけ）
describe("useGuestPrompt", () => {
    const gtag = vi.fn();
    beforeEach(() => {
        resetGuestPromptThrottle();
        vi.useRealTimers();
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

    // 連打・ダブルタップ: 同じ文言が出ている間は積まない・数えない
    it("連打しても1回だけ（トーストも login_prompt も）", () => {
        const { result } = renderHook(() => useGuestPrompt("ja"));
        result.current("like"); result.current("like"); result.current("like");
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(prompts()).toHaveLength(1);
    });

    it("別の文言（保存）は出る。区切り（6秒）が過ぎたらまた出る", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useGuestPrompt("ja"));
        result.current("like");
        result.current("save");
        expect(showToast).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(5999);
        result.current("like");
        expect(showToast).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(2);
        result.current("like");
        expect(showToast).toHaveBeenCalledTimes(3);
        expect(prompts()).toHaveLength(3);
        vi.useRealTimers();
    });

    it("フックの別のインスタンス（一覧のフォローボタン）でも同じ区切り", () => {
        const a = renderHook(() => useGuestPrompt("ja"));
        const b = renderHook(() => useGuestPrompt("ja"));
        a.result.current("follow"); b.result.current("follow");
        expect(showToast).toHaveBeenCalledTimes(1);
    });
});
