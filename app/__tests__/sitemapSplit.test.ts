import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
    sitemapGroups, allSitemapEntries, renderUrlset, renderSitemapIndex, SITEMAP_KINDS, type SitemapKind,
} from "../../lib/server/sitemap";
import { siteConfig } from "../../lib/utils/seo";
import { collectEntries, isIndexableCollection, isIndexableCollectionIndex, type CollectionType } from "../../lib/utils/collections";
import { SPOTS } from "../../lib/data/spots";
import { publishableSpots } from "../../lib/utils/spotGuide";
import { spotAreas } from "../../lib/data/spotLink";
import { spotTopicSitemapEntries } from "../../lib/data/spotTopics";
import { PREFECTURES } from "../../lib/data/prefectures";
import { LEARN_ARTICLES } from "../../lib/data/learn/articles";
import type { Photo } from "../../lib/data/photos";

/**
 * サイトマップは**種類別に分けて配る**（2026-11-09）。`/sitemap.xml` は索引、中身は `/sitemap-<種類>.xml`。
 * Search Console は sitemap ごとに登録数を出すので、種類ごとの効果を分けて比べられる。
 * 🔴 分けても**総件数は変わらない**・**ビルドの時刻を lastmod に入れない**・**どの種類も配線されている**。
 * 実データ（`photos.json`・台帳）で見るので、1つの実行に数秒かかる。
 */
const T = 60_000;

/** XML として読む。壊れていれば `<parsererror>` が入るので落とす（このファイルは jsdom の環境で走る） */
function parseXml(xml: string): Document {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length, "XML として壊れている").toBe(0);
    return doc;
}
const ROOT = join(__dirname, "..", "..");
const base = siteConfig.url;

function realPhotos(): Photo[] {
    const p = join(ROOT, "app", "data", "photos.json");
    const raw = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Photo[]) : [];
    return raw.filter((x) => x.published !== false);
}

afterEach(() => { vi.useRealTimers(); });

describe("サイトマップを種類別に分ける", () => {
    it("全種類が空でなく、合わせて重複なし。総件数は部品から数えた数と同じ（分けても増減しない）", async () => {
        const g = await sitemapGroups();
        for (const k of SITEMAP_KINDS) expect(g[k].length, `${k} が空`).toBeGreaterThan(0);

        const all = await allSitemapEntries();
        const urls = all.map((e) => e.url);
        expect(new Set(urls).size, "URL が重複している").toBe(urls.length);

        // 部品（写真・台帳・集約・切り口）から独立に数える
        const photos = realPhotos();
        const users = new Set(photos.filter((p) => p.userId).map((p) => p.userId)).size;
        const collections = (["tag", "location", "category", "camera"] as CollectionType[])
            .reduce((n, t) => n + collectEntries(photos, t).filter((e) => isIndexableCollection(e.count, t)).length, 0);
        const indexes = (["location", "category", "camera"] as CollectionType[])
            .filter((t) => isIndexableCollectionIndex(collectEntries(photos, t).length)).length;
        const spots = publishableSpots(SPOTS);
        const expected =
            4 /* トップ・privacy・terms・map */ + users +
            photos.length + collections + indexes +
            spots.length + (spots.length >= 3 ? 1 : 0) + spotAreas().filter((a) => a.publishedCount >= 2).length +
            spotTopicSitemapEntries(base).length +
            1 + LEARN_ARTICLES.filter((a) => a.modified).length + 1 /* 教科書の一覧 と 構図ガイド */ +
            1 + PREFECTURES.length /* 今日の日の出 */;
        expect(urls.length).toBe(expected);
    }, T);

    it("種類ごとの中身の形（スポット詳細・県・ハブ・今日・写真は、それぞれの URL だけ）", async () => {
        const g = await sitemapGroups();
        const path = (u: string) => u.slice(base.length);
        const isSpotDetail = (p: string) => /^\/spots\/[^/]+$/.test(p);
        const isIndexOrArea = (p: string) => p === "/spots" || p.startsWith("/spots/area/") || p.startsWith("/spots/city/");
        expect(g.spots.map((e) => path(e.url)).every(isSpotDetail), "spots に詳細以外がある").toBe(true);
        expect(g.areas.map((e) => path(e.url)).every(isIndexOrArea), "areas に一覧以外がある").toBe(true);
        expect(g.areas.some((e) => path(e.url) === "/spots"), "/spots が areas に無い").toBe(true);
        expect(g.areas.some((e) => path(e.url).startsWith("/spots/area/overseas/")), "国の一覧が areas に無い").toBe(true);
        expect(g.areas.some((e) => path(e.url).startsWith("/spots/city/")), "市の一覧が areas に無い").toBe(true);
        // `/spots/momiji` などのまとめの頁は詳細と同じ形の URL なので、形では分けず「県・市・詳細の台帳に無い」で見る
        const slugs = new Set(publishableSpots(SPOTS).map((s) => s.slug));
        expect(g.hubs.every((e) => path(e.url).startsWith("/spots/") && !isIndexOrArea(path(e.url)) && !slugs.has(path(e.url).slice("/spots/".length))), "hubs にハブ以外がある").toBe(true);
        expect(g.hubs.map((e) => path(e.url))).toEqual(expect.arrayContaining(["/spots/momiji", "/spots/sakura", "/spots/snow"]));
        expect(g.hubs.some((e) => /^\/spots\/theme\//.test(path(e.url)))).toBe(true);
        expect(g.hubs.some((e) => /^\/spots\/season\//.test(path(e.url)))).toBe(true);
        expect(g.today.every((e) => path(e.url).startsWith("/today")), "today に別の頁がある").toBe(true);
        expect(g.photos.every((e) => path(e.url).startsWith("/photo/")), "photos に写真以外がある").toBe(true);
        expect(g.learn.every((e) => path(e.url).startsWith("/learn") || path(e.url) === "/composition")).toBe(true);
        expect(g.pages.map((e) => path(e.url))).toEqual(expect.arrayContaining(["", "/privacy", "/terms", "/map"]));
    }, T);
});

describe("🔴 lastmod にビルドの時刻を入れない", () => {
    it("ビルドの日時が違っても、全種類の出力が1文字も変わらない", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2031-01-02T03:04:05.678Z"));
        const a = await sitemapGroups();
        vi.setSystemTime(new Date("2032-07-08T09:10:11.121Z"));
        const b = await sitemapGroups();
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(renderSitemapIndex(b)).toBe(renderSitemapIndex(a));
        // どの行にも、ビルドの日時（2031・2032 年）は入っていない
        const text = JSON.stringify(a) + JSON.stringify(b);
        expect(text).not.toMatch(/"lastModified":"203[12]-/);
    }, T);

    it("県の一覧と /spots の lastmod は、台帳の更新日の最大（ビルドの日時ではない）", async () => {
        const g = await sitemapGroups();
        const latest = (rows: readonly { updatedAt?: string }[]) => rows.map((r) => r.updatedAt).filter(Boolean).sort().pop();
        const areas = g.areas.filter((e) => e.url.startsWith(`${base}/spots/area/`) && e.url.split("/").length === 6);
        expect(areas.length).toBeGreaterThan(10);
        for (const e of areas) expect(e.lastModified, e.url).toBeTruthy();
        const spotsIndex = g.areas.find((e) => e.url === `${base}/spots`)!;
        // どの行の更新日より新しくならない
        const max = latest(SPOTS)!;
        expect(String(spotsIndex.lastModified) <= max, "/spots の lastmod が台帳のどの行より新しい").toBe(true);
        for (const e of areas) expect(String(e.lastModified) <= max, `${e.url} が台帳のどの行より新しい`).toBe(true);
    }, T);
});

describe("種類別の XML と索引", () => {
    it("どの種類も正しい XML（`<url>` の数は行の数・画像は image 名前空間つき）", async () => {
        const g = await sitemapGroups();
        for (const k of SITEMAP_KINDS) {
            const xml = renderUrlset(g[k]);
            const doc = parseXml(xml);
            expect(doc.getElementsByTagName("url").length, k).toBe(g[k].length);
            expect(doc.getElementsByTagName("loc").length, k).toBe(g[k].length);
        }
        expect(renderUrlset(g.photos)).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
        expect(renderUrlset(g.photos)).toContain("<image:image>");
    }, T);

    it("日付の無い行は <lastmod> を書かない・記号は実体参照にする", () => {
        const xml = renderUrlset([
            { url: `${base}/a?x=1&y=2`, changeFrequency: "monthly", priority: 0.5 },
            { url: `${base}/b`, lastModified: "2026-11-07", changeFrequency: "weekly", priority: 0.6 },
        ]);
        expect(xml).toContain("<loc>" + base + "/a?x=1&amp;y=2</loc>");
        expect(xml.match(/<lastmod>/g)).toHaveLength(1);
        parseXml(xml);
    });

    it("索引は全種類を1回ずつ、/sitemap-<種類>.xml の URL で束ねる。lastmod は種類の中身の最大", async () => {
        const g = await sitemapGroups();
        const xml = renderSitemapIndex(g);
        const doc = parseXml(xml);
        expect(doc.documentElement.tagName).toBe("sitemapindex");
        const locs = [...doc.getElementsByTagName("loc")].map((n) => n.textContent);
        expect(locs).toEqual(SITEMAP_KINDS.map((k) => `${base}/sitemap-${k}.xml`));
        // 日付を持たない種類（今日の日の出）は lastmod を書かない。ほかはその種類の最大
        const byKind = new Map<string, string | null>();
        for (const s of [...doc.getElementsByTagName("sitemap")]) {
            byKind.set(s.getElementsByTagName("loc")[0].textContent!, s.getElementsByTagName("lastmod")[0]?.textContent ?? null);
        }
        expect(byKind.get(`${base}/sitemap-today.xml`)).toBeNull();
        const iso = (v: string | Date | undefined) => (v === undefined ? "" : typeof v === "string" ? v : v.toISOString());
        const max = (k: SitemapKind) => g[k].map((e) => iso(e.lastModified)).filter(Boolean).sort().pop();
        expect(byKind.get(`${base}/sitemap-spots.xml`)).toBe(max("spots"));
    }, T);
});

describe("配線（書いたが配らない、を防ぐ）", () => {
    it.each(SITEMAP_KINDS)("app/sitemap-%s.xml/route.ts があり、その種類を返す", (k) => {
        const f = join(ROOT, "app", `sitemap-${k}.xml`, "route.ts");
        expect(existsSync(f), `${f} が無い`).toBe(true);
        const src = readFileSync(f, "utf8");
        expect(src).toMatch(new RegExp(`sitemapGroups\\(\\)\\)\\.${k}\\b`));
        expect(src).toMatch(/export const dynamic = "force-static"/);
    });

    it("各 route の GET が、種類別の XML（と索引）をそのまま返す（Content-Type は XML）", async () => {
        const g = await sitemapGroups();
        for (const k of SITEMAP_KINDS) {
            const res = await (await import(`../sitemap-${k}.xml/route`)).GET();
            expect(res.headers.get("Content-Type"), k).toMatch(/^application\/xml/);
            expect(await res.text(), k).toBe(renderUrlset(g[k]));
        }
        const idx = await (await import("../sitemap.xml/route")).GET();
        expect(await idx.text()).toBe(renderSitemapIndex(g));
    }, T);

    it("/sitemap.xml は索引で、旧来の app/sitemap.ts（全部入り）は残っていない・画像サイトマップはそのまま", () => {
        expect(existsSync(join(ROOT, "app", "sitemap.ts")), "app/sitemap.ts が残ると /sitemap.xml が衝突する").toBe(false);
        const idx = readFileSync(join(ROOT, "app", "sitemap.xml", "route.ts"), "utf8");
        expect(idx).toContain("renderSitemapIndex");
        expect(existsSync(join(ROOT, "app", "sitemap-images.xml", "route.ts"))).toBe(true);
    });

    it("robots.txt は索引と画像サイトマップを案内する（種類別は索引から辿る）", async () => {
        vi.resetModules();
        vi.stubEnv("NEXT_PUBLIC_ENV_NAME", "prod");
        const r = (await import("../robots")).default();
        vi.unstubAllEnvs();
        expect(r.sitemap).toEqual([`${base}/sitemap.xml`, `${base}/sitemap-images.xml`]);
    });
});
