import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthBrand, AUTH_MARK_RATIO, AUTH_WORDMARK_SIZE } from "../AuthPhotoBand";

/**
 * ログインと登録の頁のロゴ（2026-11-25 owner「Web のログインのロゴがアプリと比べて小さい」「印が字に比べて小さい」）。
 * 字は iOS と同じ serif の太字（`font-wordmark`＝iPhone では New York）。印の大きさは字に対する比 1 か所（`AUTH_MARK_RATIO`）で決める
 */
describe("AuthBrand", () => {
    it("字はアプリと同じ font-wordmark（明朝ではない）・前の 40 より大きい", () => {
        render(<AuthBrand />);
        const word = screen.getByText("Journey Photo");
        expect(word.className).toContain("font-wordmark");
        expect(word.className).not.toContain("font-serif");
        expect(AUTH_WORDMARK_SIZE).toBeGreaterThan(40);
    });

    it("印の直径は字の大きさ × AUTH_MARK_RATIO（字と一緒に縮む em）", () => {
        render(<AuthBrand />);
        const mark = screen.getByTestId("login-wordmark-mark");
        expect(mark.style.width).toBe(`${AUTH_MARK_RATIO}em`);
        expect(mark.style.height).toBe(`${AUTH_MARK_RATIO}em`);
        expect(AUTH_MARK_RATIO).toBeGreaterThan(29.5 / 40);
    });

    it("ロゴと一文の間は iOS と同じ 4（gap-1）、一文は白 90%", () => {
        render(<AuthBrand />);
        expect(screen.getByTestId("login-wordmark").className).toContain("gap-1");
        expect(screen.getByText("写真から、次の旅が始まる。").className).toContain("text-white/90");
    });
});
