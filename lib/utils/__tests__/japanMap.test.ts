import { describe, it, expect } from "vitest";
import { PREFECTURE_SHAPES } from "../../data/prefectureShapes";
import { densityBin, densityCuts, nearestSlugs, neighborInDirection, prefFromHash, prefHash } from "../japanMap";

const ALL = new Set(PREFECTURE_SHAPES.map((s) => s[0]));

describe("日本地図: 直接移動か札か・近くの県・矢印・濃淡", () => {
    it("URL に持たせる選択県: `#pref=<slug>` を書き・読む。知らない県・形の違う値・空は null", () => {
        expect(prefHash("kanagawa")).toBe("#pref=kanagawa");
        expect(prefFromHash("#pref=kanagawa", ALL)).toBe("kanagawa");
        expect(prefFromHash("pref=osaka&x=1", ALL)).toBe("osaka");
        expect(prefFromHash("#pref=atlantis", ALL)).toBeNull();
        expect(prefFromHash("#pref=../etc", ALL)).toBeNull();
        expect(prefFromHash("#home-spot-entry-list", ALL)).toBeNull();
        expect(prefFromHash("", ALL)).toBeNull();
        // 件数の無い（リンクの無い）県は読まない
        expect(prefFromHash("#pref=osaka", new Set(["kyoto"]))).toBeNull();
        for (const slug of ALL) expect(prefFromHash(prefHash(slug), ALL)).toBe(slug);
    });

    it("近くの県は3つ・自分は入らない・沖縄は九州の3県・本州の県の近くに沖縄は入らない", () => {
        for (const slug of ALL) {
            const near = nearestSlugs(slug, 3, ALL);
            expect(near, slug).toHaveLength(3);
            expect(near, slug).not.toContain(slug);
            if (slug !== "okinawa") expect(near, slug).not.toContain("okinawa");
        }
        expect(nearestSlugs("okinawa", 3, ALL)).toEqual(["kagoshima", "miyazaki", "kumamoto"]);
        expect(nearestSlugs("osaka", 3, ALL)).toEqual(expect.arrayContaining(["hyogo", "nara", "kyoto"]));
        // 件数の無い（リンクの無い）県は近くに出さない
        const less = new Set([...ALL].filter((s) => s !== "nara"));
        expect(nearestSlugs("osaka", 3, less)).not.toContain("nara");
    });

    it("矢印キー: 北海道から南は青森・東京から西は山梨か神奈川・端では null", () => {
        expect(neighborInDirection("hokkaido", 0, 1, ALL)).toBe("aomori");
        expect(["yamanashi", "kanagawa", "shizuoka"]).toContain(neighborInDirection("tokyo", -1, 0, ALL));
        expect(neighborInDirection("hokkaido", 0, -1, ALL)).toBeNull();
        // 47県すべてが、矢印のどれかで外へ出られる（行き止まりの県が無い）
        for (const slug of ALL) {
            const any = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => neighborInDirection(slug, dx, dy, ALL) !== null);
            expect(any, slug).toBe(true);
        }
    });

    it("全県は矢印キーの連なりで北海道から行き着ける", () => {
        const seen = new Set(["hokkaido"]);
        const todo = ["hokkaido"];
        while (todo.length) {
            const s = todo.pop()!;
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const t = neighborInDirection(s, dx, dy, ALL);
                if (t && !seen.has(t)) { seen.add(t); todo.push(t); }
            }
        }
        expect(seen.size).toBe(47);
    });

    it("濃淡の段は四分位（47県で 12/12/12/11 前後）で、値の小さい順に 0〜3", () => {
        const counts = Array.from({ length: 47 }, (_, i) => 30 + i);
        const cuts = densityCuts(counts);
        const bins = counts.map((n) => densityBin(n, cuts));
        const per = [0, 1, 2, 3].map((b) => bins.filter((x) => x === b).length);
        for (const n of per) expect(n).toBeGreaterThanOrEqual(11);
        expect(bins).toEqual([...bins].sort());
        expect(densityBin(cuts[0], cuts)).toBe(0);
        expect(densityBin(cuts[0] + 1, cuts)).toBe(1);
    });
});
