import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AreaBackToMap from "../AreaBackToMap";
import { saveMapReturn } from "../../../lib/utils/mapReturn";

/** 2026-11-09: 地図から来たときだけ「地図に戻る」。サーバーの HTML には出さない（検索から来た人・クロールに出さない） */
beforeEach(() => { cleanup(); sessionStorage.clear(); });

describe("AreaBackToMap", () => {
    it("サーバーの HTML には何も出さない", () => {
        saveMapReturn("kanagawa", 100);
        expect(renderToStaticMarkup(<AreaBackToMap slug="kanagawa" name="神奈川県" />)).toBe("");
    });
    it("覚えが無い・別の県の覚えなら出さない", () => {
        render(<AreaBackToMap slug="kanagawa" name="神奈川県" />);
        expect(screen.queryByTestId("area-back-to-map")).toBeNull();
        cleanup();
        saveMapReturn("osaka", 100);
        render(<AreaBackToMap slug="kanagawa" name="神奈川県" />);
        expect(screen.queryByTestId("area-back-to-map")).toBeNull();
    });
    it("この県の覚えがあれば、/#pref=<県> へのリンクが出る（44px の高さ）", () => {
        saveMapReturn("kanagawa", 100);
        render(<AreaBackToMap slug="kanagawa" name="神奈川県" />);
        const a = screen.getByTestId("area-back-to-map").querySelector("a")!;
        expect(a.getAttribute("href")).toBe("/#pref=kanagawa");
        expect(a.textContent).toContain("ホームの地図に戻る");
        expect(a.className).toContain("min-h-[44px]");
    });
    it("県の頁（area/[area]/page.tsx）が、見つかった県のときだけ置く", () => {
        const src = readFileSync(join(__dirname, "../../spots/area/[area]/page.tsx"), "utf8");
        expect(src).toContain("{found && <AreaBackToMap slug={found.slug} name={found.name} />}");
    });
});
