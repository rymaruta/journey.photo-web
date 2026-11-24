import { describe, it, expect } from "vitest";
import { articleStructuredData } from "../seo";
import { ORGANIZATION_ID, SITE_SHORT_NAME, siteConfig, generateOrganizationStructuredData } from "@/lib/utils/seo";

// #525 の続き（確かめ役 2026-11-11）: 記事の書き手・発行元は、全ページに出す Organization を @id で指す
describe("記事の構造化データ", () => {
    it("author と publisher は全ページの Organization を指す（別の組織を作らない）", () => {
        const a = articleStructuredData({
            path: "/learn/x", headline: "見出し", description: "説明",
            published: "2026-11-01", modified: "2026-11-11", images: [],
        });
        const org = { "@type": "Organization", "@id": ORGANIZATION_ID, name: SITE_SHORT_NAME, url: siteConfig.url };
        expect(a.author).toEqual(org);
        expect(a.publisher).toEqual(org);
        expect(generateOrganizationStructuredData()["@id"]).toBe(ORGANIZATION_ID);
    });
});
