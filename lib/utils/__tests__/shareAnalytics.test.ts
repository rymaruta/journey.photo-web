import { describe, it, expect, vi, beforeEach } from "vitest";
import { shareToTwitter, shareToLine, shareUrl } from "../share";

// share の計測（2026-11-04）。数えるのは「共有できた回」だけ。URL・題名・本文は送らない
const gtag = vi.fn();
const openMock = vi.fn();
Object.defineProperty(window, "open", { value: openMock, writable: true });
const shares = () => gtag.mock.calls.filter((c) => c[1] === "share").map((c) => c[2]);

beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, writable: true, configurable: true });
});
const stubShare = (v: unknown) => Object.defineProperty(navigator, "share", { value: v, writable: true, configurable: true });

describe("share の計測", () => {
    it("共有シートで共有できた → method=native", async () => {
        stubShare(vi.fn().mockResolvedValue(undefined));
        await shareUrl("https://example.com/photo/secret-id", "題名", "本文", "photo");
        expect(shares()).toEqual([expect.objectContaining({ method: "native", content_type: "photo" })]);
        const sent = JSON.stringify(gtag.mock.calls);
        for (const leak of ["secret-id", "題名", "本文", "example.com"]) expect(sent).not.toContain(leak);
    });

    it("共有シートが無くコピーに落ちた → method=copy", async () => {
        stubShare(undefined);
        await shareUrl("https://example.com", "t", "x", "spot");
        expect(shares()).toEqual([expect.objectContaining({ method: "copy", content_type: "spot" })]);
    });

    it("利用者が閉じた回は数えない", async () => {
        stubShare(vi.fn().mockRejectedValue(Object.assign(new Error("c"), { name: "AbortError" })));
        await shareUrl("https://example.com", "t", "x", "photo");
        expect(shares()).toEqual([]);
    });

    it("コピーも失敗した回は数えない", async () => {
        stubShare(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, writable: true, configurable: true });
        document.execCommand = vi.fn(() => false);
        expect(await shareUrl("https://example.com", "t", "x", "photo")).toBe("failed");
        expect(shares()).toEqual([]);
    });

    it("何を共有したかを渡さない呼び出しは数えない", async () => {
        stubShare(vi.fn().mockResolvedValue(undefined));
        await shareUrl("https://example.com");
        expect(shares()).toEqual([]);
    });

    it("X と LINE → method=x / line", () => {
        shareToTwitter("https://example.com", "t", "photo");
        shareToLine("https://example.com", "t", "spot");
        expect(shares()).toEqual([
            expect.objectContaining({ method: "x", content_type: "photo" }),
            expect.objectContaining({ method: "line", content_type: "spot" }),
        ]);
    });
});
