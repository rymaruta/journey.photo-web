import { describe, it, expect } from "vitest";
import { seasonTopics } from "../spotTopics";

/**
 * 2026-11-05: フッターの「春・夏・秋・冬の撮影スポット」（`app/components/Footer.tsx`）の行き先は、
 * 季節の全体の頁。4つとも実際に建つこと（建たない季節をリンクすると 404 になる）。
 * 台帳を読むので、jsdom の画面テスト（`app/__tests__/entryLinks.test.tsx`）とは別のファイルにしている
 */
describe("フッターの季節の入口", () => {
    it("春・夏・秋・冬の全体の頁が4つとも建つ", () => {
        const built = new Set(seasonTopics().filter((t) => t.area === null).map((t) => t.season));
        for (const season of ["spring", "summer", "autumn", "winter"]) expect(built.has(season as never), season).toBe(true);
    }, 30_000);
});
