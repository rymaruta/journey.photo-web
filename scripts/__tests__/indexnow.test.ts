import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// **IndexNow**（Bing などへ、直近2日に更新された URL を知らせる）。
// 守ること: 本番のときだけ送る・直近2日の URL だけ送る・何があってもデプロイを止めない（例外を投げない）。

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { submitIndexNow, urlsFromSitemap, INDEXNOW_KEY, PROD_URL, ENDPOINT, MAX_URLS } = require("../lib/indexnow.js") as {
    submitIndexNow: (o: Record<string, unknown>) => Promise<{ skipped?: string; sent?: number; status?: number; error?: string }>;
    urlsFromSitemap: (xml: string, sinceMs: number) => string[];
    INDEXNOW_KEY: string; PROD_URL: string; ENDPOINT: string; MAX_URLS: number;
};

const NOW = Date.parse("2026-11-15T12:00:00Z");
const xml = (rows: { loc: string; lastmod?: string }[]) =>
    `<?xml version="1.0"?><urlset>${rows.map((r) => `<url><loc>${r.loc}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ""}</url>`).join("")}</urlset>`;

function outDirWith(files: Record<string, string>, withKey = true): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexnow-"));
    if (withKey) fs.writeFileSync(path.join(dir, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
    return dir;
}

describe("urlsFromSitemap", () => {
    it("lastmod が基準以降の URL だけを取り出す（日付だけでも日時でも）・lastmod が無い URL は含めない", () => {
        const since = NOW - 2 * 86400_000;
        const out = urlsFromSitemap(xml([
            { loc: "https://journey-photo.com/spots/a", lastmod: "2026-11-15" },
            { loc: "https://journey-photo.com/spots/b", lastmod: "2026-11-14T15:38:31.000Z" },
            { loc: "https://journey-photo.com/spots/old", lastmod: "2026-10-08" },
            { loc: "https://journey-photo.com/spots/none" },
        ]), since);
        expect(out).toEqual(["https://journey-photo.com/spots/a", "https://journey-photo.com/spots/b"]);
    });
});

describe("submitIndexNow", () => {
    afterEach(() => vi.restoreAllMocks());

    it("本番だけで送る: ステージング・手元・未設定では送らない", async () => {
        const f = vi.fn();
        const dir = outDirWith({ "sitemap-spots.xml": xml([{ loc: `${PROD_URL}/spots/a`, lastmod: "2026-11-15" }]) });
        for (const siteUrl of ["https://d15fn3rcaiymu9.cloudfront.net", "", undefined, "http://localhost:3000"]) {
            const r = await submitIndexNow({ siteUrl, outDir: dir, now: NOW, fetchImpl: f, log: () => {} });
            expect(r.skipped, String(siteUrl)).toBeTruthy();
        }
        expect(f).not.toHaveBeenCalled();
    });

    it("直近2日の URL を、鍵つきで IndexNow に1回で送る（古い URL・lastmod の無い URL・別のドメインは送らない）", async () => {
        const f = vi.fn().mockResolvedValue({ status: 200 });
        const dir = outDirWith({
            "sitemap-spots.xml": xml([
                { loc: `${PROD_URL}/spots/new`, lastmod: "2026-11-14T15:00:00.000Z" },
                { loc: `${PROD_URL}/spots/old`, lastmod: "2026-10-01" },
                { loc: "https://example.com/spots/other", lastmod: "2026-11-15" },
            ]),
            "sitemap-areas.xml": xml([{ loc: `${PROD_URL}/spots/area/aichi`, lastmod: "2026-11-15" }, { loc: `${PROD_URL}/spots/area/x` }]),
        });
        const r = await submitIndexNow({ siteUrl: `${PROD_URL}/`, outDir: dir, now: NOW, fetchImpl: f, log: () => {} });
        expect(r).toEqual({ sent: 2, status: 200 });
        expect(f).toHaveBeenCalledTimes(1);
        const [url, init] = f.mock.calls[0];
        expect(url).toBe(ENDPOINT);
        const body = JSON.parse(init.body);
        expect(body).toEqual({
            host: "journey-photo.com", key: INDEXNOW_KEY, keyLocation: `${PROD_URL}/${INDEXNOW_KEY}.txt`,
            urlList: [`${PROD_URL}/spots/new`, `${PROD_URL}/spots/area/aichi`],
        });
    });

    it("鍵のファイルが out に無ければ送らない（鍵が確かめられず、断られるだけ）", async () => {
        const f = vi.fn();
        const dir = outDirWith({ "sitemap-spots.xml": xml([{ loc: `${PROD_URL}/spots/a`, lastmod: "2026-11-15" }]) }, false);
        const r = await submitIndexNow({ siteUrl: PROD_URL, outDir: dir, now: NOW, fetchImpl: f, log: () => {} });
        expect(r.skipped).toBeTruthy();
        expect(f).not.toHaveBeenCalled();
    });

    it("更新された URL が無ければ送らない", async () => {
        const f = vi.fn();
        const dir = outDirWith({ "sitemap-spots.xml": xml([{ loc: `${PROD_URL}/spots/a`, lastmod: "2026-01-01" }]) });
        expect((await submitIndexNow({ siteUrl: PROD_URL, outDir: dir, now: NOW, fetchImpl: f, log: () => {} })).skipped).toBeTruthy();
        expect(f).not.toHaveBeenCalled();
    });

    it("🔴 ネットワークが落ちても・応答が何であっても例外を投げない（デプロイを止めない）", async () => {
        const dir = outDirWith({ "sitemap-spots.xml": xml([{ loc: `${PROD_URL}/spots/a`, lastmod: "2026-11-15" }]) });
        const down = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
        const r1 = await submitIndexNow({ siteUrl: PROD_URL, outDir: dir, now: NOW, fetchImpl: down, log: () => {} });
        expect(r1.error).toContain("ECONNRESET");
        const e429 = vi.fn().mockResolvedValue({ status: 429 });
        const r2 = await submitIndexNow({ siteUrl: PROD_URL, outDir: dir, now: NOW, fetchImpl: e429, log: () => {} });
        expect(r2).toEqual({ sent: 1, status: 429 });
        // outDir が無くても投げない
        const r3 = await submitIndexNow({ siteUrl: PROD_URL, outDir: "/no/such/dir", now: NOW, fetchImpl: down, log: () => {} });
        expect(r3.skipped || r3.error).toBeTruthy();
    });

    it("1回に送る URL は上限（10,000）まで", async () => {
        const f = vi.fn().mockResolvedValue({ status: 200 });
        const rows = Array.from({ length: MAX_URLS + 50 }, (_, i) => ({ loc: `${PROD_URL}/spots/s${i}`, lastmod: "2026-11-15" }));
        const dir = outDirWith({ "sitemap-spots.xml": xml(rows) });
        const r = await submitIndexNow({ siteUrl: PROD_URL, outDir: dir, now: NOW, fetchImpl: f, log: () => {} });
        expect(r.sent).toBe(MAX_URLS);
    });
});

describe("鍵のファイル", () => {
    it("public/<鍵>.txt があり、中身が鍵と同じ（IndexNow が鍵の持ち主を確かめる）", () => {
        const p = path.join(__dirname, "..", "..", "public", `${INDEXNOW_KEY}.txt`);
        expect(fs.existsSync(p)).toBe(true);
        expect(fs.readFileSync(p, "utf8").trim()).toBe(INDEXNOW_KEY);
        expect(INDEXNOW_KEY).toMatch(/^[a-f0-9]{32}$/);
    });
});
