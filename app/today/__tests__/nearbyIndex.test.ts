import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { SPOTS } from "@/lib/data/spots";
import { PREFECTURES } from "@/lib/data/prefectures";
import { visibleSpots } from "@/lib/utils/spotGuide";
import { nearbyIndexJson, nearbyIndexRows } from "@/lib/data/todayPlaces";
import { isNearbyRows, nearestSpots } from "@/lib/utils/todayLight";
import * as route from "../../app/data/nearby.json/route";

/**
 * **近くのスポットの索引**（`/app/data/nearby.json`）。ハブの「現在地で調べる」が、位置が取れたあとにだけ読む軽い専用ファイル。
 * 目標は生で 300KB 以下（実測の値は報告に書く）。
 */
const MAX_RAW = 300_000;

describe("nearby.json", () => {
    const json = nearbyIndexJson();
    const rows = nearbyIndexRows();

    it("静的に建ち、spot-photo-links.json と同じ置き場・同じ配り方", async () => {
        expect(fs.existsSync(path.join(process.cwd(), "app", "app", "data", "nearby.json", "route.ts"))).toBe(true);
        expect(route.dynamic).toBe("force-static");
        const res = await route.GET();
        expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
        expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
        expect(await res.text()).toBe(json);
    });

    it("形は [slug, 名前, 緯度, 経度, 種類, 県スラッグ] の配列。緯度経度は小数3桁以内", () => {
        expect(isNearbyRows(JSON.parse(json))).toBe(true);
        const prefs = new Set(PREFECTURES.map((p) => p.slug));
        for (const [slug, name, lat, lng, kind, pref] of rows) {
            expect(slug).toMatch(/^[a-z0-9-]+$/);
            expect(name.length).toBeGreaterThan(0);
            expect(String(lat)).toMatch(/^-?\d+(\.\d{1,3})?$/);
            expect(String(lng)).toMatch(/^-?\d+(\.\d{1,3})?$/);
            expect(typeof kind).toBe("string");
            expect(prefs.has(pref), `${slug} の県 ${pref}`).toBe(true);
        }
        expect(new Set(rows.map((r) => r[0])).size).toBe(rows.length);
    });

    it("国内の見えるスポットで座標のあるものを全部（頁が無いスポットへリンクしない）", () => {
        const visible = new Set(visibleSpots(SPOTS).map((s) => s.slug));
        for (const r of rows) expect(visible.has(r[0]), r[0]).toBe(true);
        const expected = visibleSpots(SPOTS).filter((s) => s.region?.country === "日本" && s.coords && PREFECTURES.some((p) => p.name === s.region?.prefecture));
        expect(rows).toHaveLength(expected.length);
        expect(rows.length).toBeGreaterThan(1000);
    });

    it(`生で ${MAX_RAW / 1000}KB 以下（gzip 後は報告用に計る）`, () => {
        const raw = Buffer.byteLength(json);
        const gz = gzipSync(json).length;
        expect(raw).toBeLessThanOrEqual(MAX_RAW);
        expect(gz).toBeLessThan(raw);
        // 実測の値（2026-11-07）は報告に書く。ここは上限だけを見張る
    });

    it("近い順に並べる関数は、距離の昇順で、同じ距離は索引の並びのまま", () => {
        const tokyoStation = { lat: 35.681, lng: 139.767 };
        const hits = nearestSpots(rows, tokyoStation, 12);
        expect(hits).toHaveLength(12);
        const kms = hits.map((h) => h.km);
        expect(kms).toEqual([...kms].sort((a, b) => a - b));
        // 全件の最小が先頭
        const all = nearestSpots(rows, tokyoStation, rows.length);
        expect(hits[0].slug).toBe(all[0].slug);
    });

    it("壊れた配信（形違い）は行として受けない", () => {
        expect(isNearbyRows([["a", "b", 1, 2, "c"]])).toBe(false);
        expect(isNearbyRows([["a", "b", "1", 2, "c", "d"]])).toBe(false);
        expect(isNearbyRows({})).toBe(false);
        expect(isNearbyRows("<html>")).toBe(false);
    });
});
