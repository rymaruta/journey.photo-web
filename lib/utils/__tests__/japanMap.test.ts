import { describe, it, expect } from "vitest";
import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "../../data/prefectureShapes";
import { clampView, densityBin, densityCuts, nearestSlugs, neighborInDirection, prefFromHash, prefHash } from "../japanMap";
import { RINGS, edgeDistance, inShape, resolveTap, rng, type Pt } from "./shapeGeometry";

const ALL = new Set(PREFECTURE_SHAPES.map((s) => s[0]));

describe("日本地図: 当たり判定（幾何モデル・幅360=0.911 / 390=0.994 px/単位）", () => {
    for (const scale of [0.911, 0.994]) {
        it(`県の内側の点は ≥99% が、その県に当たる（縮尺 ${scale}）`, () => {
            const R = rng(7);
            let tot = 0, ok = 0;
            for (const [slug, , box] of PREFECTURE_SHAPES) {
                let n = 0, tries = 0;
                while (n < 40 && tries < 4000) {
                    tries++;
                    const p: Pt = [box[0] + R() * box[2], box[1] + R() * box[3]];
                    if (!inShape(slug, p)) continue;
                    n++; tot++;
                    if (resolveTap(p, scale, ALL) === slug) ok++;
                }
                expect(n, slug).toBeGreaterThan(0);
            }
            expect(ok / tot).toBeGreaterThanOrEqual(0.99);
        });

        it(`海の点（県の縁から 1〜12px）は ≥90% が、いちばん近い県に当たる（縮尺 ${scale}）`, () => {
            const R = rng(11);
            let n = 0, ok = 0, tries = 0;
            while (n < 150 && tries < 40000) {
                tries++;
                const p: Pt = [R() * MAP_W, R() * MAP_H];
                // 沖縄の枠の中は枠が当たり（別のテスト）・拡大のボタンの下は除く
                if (p[0] > OKINAWA_FRAME[0] && p[1] > OKINAWA_FRAME[1]) continue;
                if (PREFECTURE_SHAPES.some((s) => inShape(s[0], p))) continue;
                let best = "", bd = Infinity;
                for (const s of PREFECTURE_SHAPES) {
                    if (s[0] === "okinawa") continue;
                    const d = edgeDistance(s[0], p);
                    if (d < bd) { bd = d; best = s[0]; }
                }
                if (bd * scale > 12 || bd * scale < 1) continue;
                n++;
                if (resolveTap(p, scale, ALL) === best) ok++;
            }
            expect(n).toBeGreaterThanOrEqual(100);
            expect(ok / n).toBeGreaterThanOrEqual(0.9);
        });
    }

    it("沖縄は枠ぜんたい（175×110）が当たり", () => {
        const [x, y, w, h] = OKINAWA_FRAME;
        for (const p of [[x + 5, y + 5], [x + w / 2, y + h / 2], [x + w - 5, y + h - 5], [x + 10, y + h - 10]] as Pt[]) {
            expect(resolveTap(p, 0.994, ALL)).toBe("okinawa");
        }
    });

    it("拡大の ＋ − 全体 のボタン列（左上 8px・44px×3＋間 8px）は、どの幅でも沖縄の枠に重ならない", () => {
        const [fx, fy] = OKINAWA_FRAME;
        for (const width of [240, 280, 328, 358, 420, 704]) {
            const s = width / MAP_W;
            const btn = { x1: 8, y1: 8, x2: 8 + 44, y2: 8 + 44 * 3 + 16 };
            const fr = { x1: fx * s, y1: fy * s };
            const overlap = btn.x2 > fr.x1 && btn.y2 > fr.y1;
            expect(overlap, `幅 ${width}`).toBe(false);
        }
    });
});

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

    it("見える窓は地図の中に収まり、拡大は 1〜4 倍", () => {
        expect(clampView({ z: 9, x: -50, y: 9999 }, MAP_H)).toEqual({ z: 4, x: 0, y: MAP_H - MAP_H / 4 });
        expect(clampView({ z: 0.2, x: 30, y: 30 }, MAP_H)).toEqual({ z: 1, x: 0, y: 0 });
        expect(RINGS.size).toBe(47);
    });
});
