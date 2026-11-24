import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import SpotRows, { type SpotRow } from "../SpotRows";

/**
 * **近くの撮影スポットの行の丸い印**（2026-11-04）。写真があれば同梱の小さい版の丸（40・真鍮の縁 2）、
 * 無い・読めなければ今のピンの印。どれも直しを戻すと落ちる。
 */
const WITH: SpotRow = { slug: "himeji-castle", name: "姫路城", region: "兵庫県 姫路市", thumb: true };
const WITHOUT: SpotRow = { slug: "no-photo", name: "写真なし", region: "兵庫県" };

describe("SpotRows の丸い印", () => {
    it("thumb があれば同梱の小さい版を丸で出す（alt 空・遅延読み込み・寸法 40 を予約）", () => {
        const { container } = render(<SpotRows rows={[WITH]} isJa />);
        const img = container.querySelector("img")!;
        expect(img.getAttribute("src")).toBe("/images/spots/thumb/himeji-castle.jpg");
        expect(img.getAttribute("alt")).toBe("");
        expect(img.getAttribute("loading")).toBe("lazy");
        expect(img.getAttribute("decoding")).toBe("async");
        expect(img.getAttribute("width")).toBe("40");
        expect(img.getAttribute("height")).toBe("40");
        const mark = screen.getByTestId("spot-thumb-mark");
        expect(mark.className).toContain("rounded-full");
        expect(mark.className).toContain("ring-2");
        // 2026-11-09: 写真が来る前の地は暗い面。真鍮の塗りだと「写真の代わりの金色の丸」に見えた
        expect(mark.className).toContain("bg-surface-2");
        expect(mark.className).not.toContain("bg-accent");
        expect(mark.style.width).toBe("40px");
        // 印の中にピンは出ない
        expect(container.querySelector("svg.w-\\[18px\\]")).toBeNull();
    });

    it("thumb が無い行は今のピンの印（画像を出さない）。箱は写真の丸と同じ 40 で題の左端がそろう", () => {
        const { container } = render(<SpotRows rows={[WITHOUT]} isJa />);
        expect(container.querySelector("img")).toBeNull();
        const svg = container.querySelector("a svg")!;
        expect(svg).toBeTruthy();
        const box = svg.parentElement as HTMLElement;
        expect(box.style.width).toBe("40px");
        expect(box.style.height).toBe("40px");
    });

    it("写真が読めなかったら（error）ピンの印に戻す", () => {
        const { container } = render(<SpotRows rows={[WITH]} isJa />);
        fireEvent.error(container.querySelector("img")!);
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("a svg")).toBeTruthy();
    });

    it("1つの一覧で写真のある行・無い行が混ざっても、行ごとに出し分ける", () => {
        const { container } = render(<SpotRows rows={[WITH, WITHOUT]} isJa />);
        const items = container.querySelectorAll("li");
        expect(within(items[0] as HTMLElement).queryByTestId("spot-thumb-mark")).toBeTruthy();
        expect(within(items[1] as HTMLElement).queryByTestId("spot-thumb-mark")).toBeNull();
    });
});
