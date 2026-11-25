import React from "react";
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { AuthBrand, AUTH_BRAND, AUTH_MARK_RATIO, AUTH_WORDMARK_SIZE, AUTH_MARK_SRC, AUTH_MARK_DROP_EM, wordmarkFontSize } from "../AuthPhotoBand";

/**
 * ログインと登録の頁のロゴ。字は iOS と同じ serif の太字（`font-wordmark`＝iPhone では New York）。
 *
 * 2026-11-25 owner「Web版細かいとこも修正して。今はバランス悪く見える。各アイコンとかロゴとかも」: 印は余白を切った絵にし、
 * 印と字の比はヘッダーと iOS の見出しのロゴ（見える印が字の約 0.83）、間は iOS の大きいロゴ（0.3em）、縦は大文字の高さの真ん中
 */
describe("AuthBrand", () => {
    it("字はアプリと同じ font-wordmark（明朝ではない）・大きさは iOS の大きいロゴと同じ 40", () => {
        render(<AuthBrand />);
        const word = screen.getByText("Journey Photo");
        expect(word.className).toContain("font-wordmark");
        expect(word.className).not.toContain("font-serif");
        expect(AUTH_WORDMARK_SIZE).toBe(40);
        expect(wordmarkFontSize()).toContain("min(40px");
    });

    it("印は余白を切った絵（見える絵が枠の 96%）。前の 64px の絵は周りに 17% の透明な余白があり、印が字より小さく見えた", () => {
        render(<AuthBrand />);
        const mark = screen.getByTestId("login-wordmark-mark") as HTMLImageElement;
        expect(mark.getAttribute("src")).toBe(AUTH_MARK_SRC);
        expect(AUTH_MARK_SRC).toBe("/logo-aperture-mark.png");
        // 絵は 128px の PNG（3 倍の画面で 40px の字の横に置いてもぼけない大きさ）
        const png = fs.readFileSync(path.join(process.cwd(), "public", AUTH_MARK_SRC));
        expect(png.subarray(1, 4).toString()).toBe("PNG");
        expect(png.readUInt32BE(16)).toBe(128);
        expect(png.readUInt32BE(20)).toBe(128);
    });

    it("見える印は字の約 0.82 倍（ヘッダーのロゴと iOS `AppLogo` の見出しと同じ釣り合い）・間は 0.3em（iOS 12／40）", () => {
        render(<AuthBrand />);
        const mark = screen.getByTestId("login-wordmark-mark");
        expect(mark.style.width).toBe(`${AUTH_MARK_RATIO}em`);
        expect(mark.style.height).toBe(`${AUTH_MARK_RATIO}em`);
        const visible = AUTH_MARK_RATIO * 0.96;
        expect(visible).toBeGreaterThan(0.78);
        expect(visible).toBeLessThan(0.86);
        expect(screen.getByTestId("login-wordmark-row").style.gap).toBe("0.3em");
    });

    it("印の中心は大文字の高さの真ん中（字の基準線にそろえて、(印 − 大文字の高さ)／2 だけ下げる）", () => {
        render(<AuthBrand />);
        expect(screen.getByTestId("login-wordmark-row").className).toContain("items-baseline");
        expect(AUTH_MARK_DROP_EM).toBeCloseTo((AUTH_BRAND.markRatio - AUTH_BRAND.capHeightRatio) / 2, 3);
        expect(screen.getByTestId("login-wordmark-mark").style.transform).toBe(`translateY(${AUTH_MARK_DROP_EM}em)`);
    });

    it("ロゴと一文の間は iOS と同じ 10、一文は白 90%", () => {
        render(<AuthBrand />);
        expect(screen.getByTestId("login-wordmark").style.gap).toBe("10px");
        expect(screen.getByText("写真から、次の旅が始まる。").className).toContain("text-white/90");
    });
});
