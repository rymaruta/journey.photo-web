import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, cleanup } from "@testing-library/react";
import AreaBackToMap from "../AreaBackToMap";
import SpotAreaPage from "../../spots/area/[area]/page";
import { saveMapReturn, MAP_RETURN_KEY } from "../../../lib/utils/mapReturn";

/** 2026-11-09: 地図から来たときだけ「地図に戻る」。サーバーの HTML には出さない（検索から来た人・クロールに出さない） */
beforeEach(() => { cleanup(); sessionStorage.clear(); });

/** 描画した要素の木から、型（コンポーネント）が一致する要素を集める */
function findAll(node: unknown, type: unknown, out: { props: Record<string, unknown> }[] = []): { props: Record<string, unknown> }[] {
    if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, out)); return out; }
    if (!React.isValidElement(node)) return out;
    const el = node as React.ReactElement<Record<string, unknown>>;
    if (el.type === type) out.push({ props: el.props });
    findAll(el.props.children, type, out);
    return out;
}

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
    it("覚えが古い（1 時間超）・壊れているときも出さない", () => {
        saveMapReturn("kanagawa", 100, Date.now() - 61 * 60 * 1000);
        render(<AreaBackToMap slug="kanagawa" name="神奈川県" />);
        expect(screen.queryByTestId("area-back-to-map")).toBeNull();
        cleanup();
        sessionStorage.setItem(MAP_RETURN_KEY, "{壊れた");
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
    it("県の頁（area/[area]）を実際に描いた要素の木で: 見つかった県には、その県の slug と名前を渡して置く。見つからない県には置かない", async () => {
        const ok = await SpotAreaPage({ params: Promise.resolve({ area: "kanagawa" }) });
        const found = findAll(ok, AreaBackToMap);
        expect(found).toHaveLength(1);
        expect(found[0].props).toEqual({ slug: "kanagawa", name: "神奈川県" });
        const none = await SpotAreaPage({ params: Promise.resolve({ area: "atlantis" }) });
        expect(findAll(none, AreaBackToMap)).toHaveLength(0);
    }, 60_000);
});
