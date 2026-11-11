import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Organization の構造化データは**全ページに出す**（ルートのレイアウト）。
 * 2026-11-11 journey.photo-ios#525: トップにしか無く、Google の AI の概要で別のサービスと
 * 混ぜて説明されていた。トップの頁とレイアウトの両方に出すと二重になるので、頁からは外す。
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Organization の構造化データの置き場所", () => {
    it("ルートのレイアウトが出す", () => {
        const layout = read("app/layout.tsx");
        expect(layout).toMatch(/const organizationStructuredData = generateOrganizationStructuredData\(\);/);
        expect(layout).toMatch(/JSON\.stringify\(organizationStructuredData\)/);
    });

    it("トップの頁は二重に出さない", () => {
        expect(read("app/page.tsx")).not.toMatch(/generateOrganizationStructuredData\(/);
    });
});
