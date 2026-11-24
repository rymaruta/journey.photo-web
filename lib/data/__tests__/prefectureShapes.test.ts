import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "../prefectureShapes";
import { PREFECTURES } from "../prefectures";
import { RINGS, inFrame, parseRings } from "../../utils/__tests__/shapeGeometry";

/**
 * 2026-11-09: ホームの日本地図の県の形（生成物 `prefectureShapes.ts`・作り方は `scripts/generate-prefecture-shapes.py`）。
 * 形が欠ける・重なる・太る・沖縄の枠が本土に掛かる、を見張る。
 */
describe("県の形（生成物）", () => {
    it("47県ぜんぶ・スラッグは県の表と過不足なく一致し、重複しない", () => {
        const slugs = PREFECTURE_SHAPES.map((s) => s[0]);
        expect(slugs).toHaveLength(47);
        expect(new Set(slugs).size).toBe(47);
        expect([...slugs].sort()).toEqual(PREFECTURES.map((p) => p.slug).sort());
    });

    it("どの県も輪が1つ以上あり、点はすべて viewBox の中・外接箱と重心が点の範囲と合う", () => {
        for (const [slug, d, box, c] of PREFECTURE_SHAPES) {
            const rings = parseRings(d);
            expect(rings.length, slug).toBeGreaterThan(0);
            // 輪の数が d の `M` の数と一致（読み損ないが無い）
            expect(rings.length, slug).toBe((d.match(/M/g) ?? []).length);
            const pts = rings.flat();
            expect(Math.min(...pts.map((p) => p[0])), slug).toBeGreaterThanOrEqual(-0.5);
            expect(Math.max(...pts.map((p) => p[0])), slug).toBeLessThanOrEqual(MAP_W + 0.5);
            expect(Math.min(...pts.map((p) => p[1])), slug).toBeGreaterThanOrEqual(-0.5);
            expect(Math.max(...pts.map((p) => p[1])), slug).toBeLessThanOrEqual(MAP_H + 0.5);
            const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
            // 外接箱は 0.1 単位で丸めた相対座標の積み上げ誤差の範囲で一致する
            expect(Math.abs(box[0] - x0), slug).toBeLessThan(0.6);
            expect(Math.abs(box[1] - y0), slug).toBeLessThan(0.6);
            expect(c[0], slug).toBeGreaterThanOrEqual(box[0] - 0.6);
            expect(c[0], slug).toBeLessThanOrEqual(box[0] + box[2] + 0.6);
            expect(c[1], slug).toBeGreaterThanOrEqual(box[1] - 0.6);
            expect(c[1], slug).toBeLessThanOrEqual(box[1] + box[3] + 0.6);
        }
    });

    it("沖縄の枠は viewBox の中・沖縄の形は枠の中・本土の線（点も辺も）は枠に掛からない", () => {
        const [fx, fy, fw, fh] = OKINAWA_FRAME;
        expect(fx + fw).toBeLessThanOrEqual(MAP_W);
        expect(fy + fh).toBeLessThanOrEqual(MAP_H);
        for (const p of (RINGS.get("okinawa") ?? []).flat()) expect(inFrame([p[0], p[1]]) || inFrame([p[0] + 0.3, p[1] + 0.3]), `沖縄の点 ${p}`).toBe(true);
        for (const [slug, rings] of RINGS) {
            if (slug === "okinawa") continue;
            for (const r of rings) {
                for (let i = 0; i < r.length; i++) {
                    const a = r[i], b = r[(i + 1) % r.length];
                    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
                    for (let k = 0; k <= n; k++) {
                        const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
                        if (inFrame(p)) throw new Error(`${slug} の線が沖縄の枠に掛かる: ${p}`);
                    }
                }
            }
        }
    });

    it("沖縄の縮尺は本土と同じ（枠の幅は沖縄の経度幅×本土と同じ倍率・1.7倍にしない）", () => {
        // 沖縄の経度の幅 8.4° ×cos36°×(360/本土の幅 約 16.6°×cos36°…) ＝ 約 175。枠が 200 を超えたら拡大している
        expect(OKINAWA_FRAME[2]).toBeGreaterThan(150);
        expect(OKINAWA_FRAME[2]).toBeLessThan(200);
        expect(OKINAWA_FRAME[3]).toBeLessThan(130);
    });

    it("データが太らない: ファイル 30KB 以下・パスの合計 27.5KB 以下（案C で RDP を 0.3 → 0.1 にして約 +3.4KB・2026-11-09）", () => {
        const file = readFileSync(join(__dirname, "../prefectureShapes.ts"), "utf8");
        expect(Buffer.byteLength(file)).toBeLessThanOrEqual(30_000);
        expect(PREFECTURE_SHAPES.reduce((n, s) => n + s[1].length, 0)).toBeLessThanOrEqual(27_500);
        expect(gzipSync(file).length).toBeLessThanOrEqual(11_500);
    });

    it("小笠原は含めない（東京都の形は本土側・地図が縦に伸びない）", () => {
        expect(MAP_H).toBeLessThan(480);
        const tokyo = PREFECTURE_SHAPES.find((s) => s[0] === "tokyo")!;
        expect(tokyo[2][1] + tokyo[2][3]).toBeLessThan(346); // 沖縄の枠より上
    });
});
