import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cacheControlFor } = require("../deploy-static-site.js") as { cacheControlFor: (key: string) => string };

/**
 * **配る `Cache-Control`**（2026-11-11 札 journey.photo-ios#527）。
 *
 * HTML は以前 `no-cache, no-store, must-revalidate`。`no-store` があると Chrome は戻る・進むの即時表示（bfcache）に
 * ページを入れない（本番の撮影スポットの頁で CDP が `MainResourceHasCacheControlNoStore` を返した）。
 * `no-cache`（使う前に必ずたしかめる）なら古い HTML は出さないまま、bfcache と 304 が使える
 */
describe("cacheControlFor", () => {
    it("HTML・txt・サイトマップ・photos.json・sw.js は no-cache（no-store を付けない）", () => {
        for (const k of ["index.html", "spots/kiyomizudera.html", "spots/kiyomizudera.txt", "robots.txt", "sitemap.xml",
            "sitemap-images.xml", "app/data/photos.json", "sw.js", "manifest.webmanifest", "feed.xml"]) {
            expect(cacheControlFor(k), k).toBe("no-cache");
            expect(cacheControlFor(k), k).not.toMatch(/no-store/);
        }
    });

    it("中身のハッシュ名（_next/）は1年 immutable・固定名の資産は1時間（今までどおり）", () => {
        expect(cacheControlFor("_next/static/chunks/a.js")).toBe("public, max-age=31536000, immutable");
        for (const k of ["images/spots/kiyomizudera.jpg", "favicon.ico", "icon-512.png", "app/data/spots/a.json"]) {
            expect(cacheControlFor(k), k).toBe("public, max-age=3600");
        }
    });
});
