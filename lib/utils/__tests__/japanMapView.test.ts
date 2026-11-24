import { describe, expect, it } from "vitest";
import { REGION_LABELS, REGION_LABEL_PX } from "../../data/prefectureRegionLabels";
import { MAP_H, MAP_W, PREFECTURE_SHAPES } from "../../data/prefectureShapes";
import { PREFECTURES } from "../../data/prefectures";
import { insideShape } from "../japanMapHit";
import { ALL_VIEW, NOMINAL_W, REGION_ORDER, REGION_POS, ZOOM_REGIONS, easeOut, isDirectRegion, lerpView, membersOf, regionBox, regionForSelection, regionOf, regionView, viewFor } from "../japanMapView";
import { geoOf } from "../japanMapGeo";

describe("地方（九州・沖縄を九州と沖縄に分ける）", () => {
    it("47県が 9 つの地方にもれなく入る・北海道と沖縄は 1 県の地方", () => {
        const all = REGION_ORDER.flatMap((r) => membersOf(r));
        expect(new Set(all).size).toBe(47);
        expect(all).toHaveLength(47);
        expect(membersOf("北海道")).toEqual(["hokkaido"]);
        expect(membersOf("沖縄")).toEqual(["okinawa"]);
        expect(membersOf("九州")).toHaveLength(7);
        expect(membersOf("関東")).toHaveLength(7);
        expect(regionOf("okinawa")).toBe("沖縄");
        expect(regionOf("kagoshima")).toBe("九州");
        for (const p of PREFECTURES) expect(membersOf(regionOf(p.slug))).toContain(p.slug);
    });

    it("北海道・沖縄は拡大せず直接県を選ぶ（選んだあとも全国のまま）。ほかは自分の地方へ", () => {
        expect(isDirectRegion("北海道")).toBe(true);
        expect(isDirectRegion("沖縄")).toBe(true);
        expect(ZOOM_REGIONS).toHaveLength(7);
        expect(regionForSelection("hokkaido")).toBeNull();
        expect(regionForSelection("okinawa")).toBeNull();
        expect(regionForSelection("tokyo")).toBe("関東");
        expect(viewFor("北海道")).toEqual(ALL_VIEW);
    });
});

describe("地方の拡大（外接箱に合わせる）", () => {
    it("拡大率は、関東 約 6 倍・東北 約 3.6 倍・九州 約 5.6 倍（仕様の値）", () => {
        const z = (r: Parameters<typeof regionView>[0]) => regionView(r).z;
        expect(z("関東")).toBeGreaterThan(5.5);
        expect(z("関東")).toBeLessThan(6.7);
        expect(z("東北")).toBeGreaterThan(3.2);
        expect(z("東北")).toBeLessThan(4.0);
        expect(z("九州")).toBeGreaterThan(5.0);
        expect(z("九州")).toBeLessThan(6.2);
        for (const r of ZOOM_REGIONS) expect(z(r), r).toBeGreaterThan(2.5);
    });

    it("viewBox は地図と同じ縦横比で、地方の箱が収まる・地図の枠は 358px 幅で 453px", () => {
        for (const r of ZOOM_REGIONS) {
            const v = regionView(r);
            expect(v.w / v.h).toBeCloseTo(MAP_W / MAP_H, 6);
            const [bx, by, bw, bh] = regionBox(r);
            expect(v.x).toBeLessThanOrEqual(bx + 1e-6);
            expect(v.y).toBeLessThanOrEqual(by + 1e-6);
            expect(v.x + v.w).toBeGreaterThanOrEqual(bx + bw - 1e-6);
            expect(v.y + v.h).toBeGreaterThanOrEqual(by + bh - 1e-6);
        }
        expect((NOMINAL_W * MAP_H) / MAP_W).toBeCloseTo(358 * 461.8 / 360, 3);
    });

    it("拡大した地方では、どの県も短辺が約 58px 以上（最小は香川の 57.7px・押せる面・仕様）", () => {
        const sizes: string[] = [];
        for (const r of ZOOM_REGIONS) {
            const s = NOMINAL_W / viewFor(r).w;
            for (const slug of membersOf(r)) {
                const b = geoOf(slug)!.mainBox;
                const short = Math.min(b[2] - b[0], b[3] - b[1]) * s;
                if (short < 57.5) sizes.push(`${slug}=${short.toFixed(1)}`);
            }
        }
        expect(sizes).toEqual([]);
    });

    it("全国の画面の地方名の位置は、その地方の県の上に載っている（地方名の点から 20px 以内に県の形がある）", () => {
        const s = NOMINAL_W / MAP_W;
        for (const r of Object.keys(REGION_POS) as (keyof typeof REGION_POS)[]) {
            const [x, y] = REGION_POS[r];
            let d = Infinity;
            for (const slug of membersOf(r)) {
                const g = geoOf(slug)!;
                const inside = insideShape(slug, x, y);
                if (inside) d = 0;
                else for (const ring of g.rings) for (let i = 0; i < ring.length; i += 2) d = Math.min(d, Math.hypot(ring[i] - x, ring[i + 1] - y));
            }
            expect(d * s, r).toBeLessThan(20);
        }
    });

    it("補間と ease-out（260ms の拡大の中身）", () => {
        const a = ALL_VIEW, b = regionView("関東");
        expect(lerpView(a, b, 0)).toEqual({ ...a, z: 1 });
        const m = lerpView(a, b, 1);
        expect(m.x).toBeCloseTo(b.x, 6);
        expect(m.z).toBeCloseTo(b.z, 6);
        expect(easeOut(0)).toBe(0);
        expect(easeOut(1)).toBe(1);
        expect(easeOut(0.5)).toBeGreaterThan(0.5); // 出だしが速い
    });
});

describe("県名（拡大した地方の中・14px）", () => {
    it("北海道・沖縄をふくむ 46 県に字があり、点は県の形の中（引き出し線はない）", () => {
        expect(REGION_LABEL_PX).toBe(14);
        expect(REGION_LABELS).toHaveLength(46);
        expect(REGION_LABELS.map((l) => l[0]).sort()).toEqual(PREFECTURE_SHAPES.map((s) => s[0]).filter((s) => s !== "okinawa").sort());
        for (const [slug, , , x, y] of REGION_LABELS) expect(insideShape(slug, x, y), slug).toBe(true);
    });

    it("字は県・府・都を除く名前（北海道だけそのまま）・縦書きの県は字数が 2 以上", () => {
        const names = new Map(PREFECTURES.map((p) => [p.slug, p.name]));
        for (const [slug, text, dir] of REGION_LABELS) {
            const full = names.get(slug)!;
            expect(full.startsWith(text), slug).toBe(true);
            expect(slug === "hokkaido" ? text === full : full.length === text.length + 1, slug).toBe(true);
            if (dir === "v") expect([...text].length).toBeGreaterThanOrEqual(2);
        }
    });

    it("県名どうしは、拡大した地方の画面（14px）で重ならない", () => {
        for (const r of ZOOM_REGIONS) {
            const s = NOMINAL_W / viewFor(r).w;
            const boxes = REGION_LABELS.filter((l) => regionOf(l[0]) === r).map((l) => {
                const n = [...l[1]].length, fs = REGION_LABEL_PX / s;
                const w = (l[2] === "h" ? n * fs : fs) / 2, h = (l[2] === "h" ? fs : n * fs) / 2;
                return { slug: l[0], x0: l[3] - w, x1: l[3] + w, y0: l[4] - h, y1: l[4] + h };
            });
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
                expect(ox > 0 && oy > 0, `${r}: ${a.slug}×${b.slug}`).toBe(false);
            }
        }
    });
});
