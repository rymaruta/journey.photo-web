import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OKINAWA_FRAME, PREFECTURE_SHAPES } from "../../data/prefectureShapes";
import { REGION_LABELS } from "../../data/prefectureRegionLabels";
import {
    HIT_CAP_PX, STICK_PX, boundaryDistance, hitAt, hitKey, insideShape, okinawaFrameDistancePx, pickHit, prefDistancePx,
    type Hit, type HitContext,
} from "../japanMapHit";
import { geoOf } from "../japanMapGeo";
import { NOMINAL_W, REGION_ORDER, isDirectRegion, membersOf, regionOf, viewFor, type RegionName } from "../japanMapView";
import { MAP_W } from "../../data/prefectureShapes";
import { edgeDistance, inShape, rng, type Pt } from "./shapeGeometry";

/**
 * 当たり判定（`japanMapHit.ts`）。仕様 v4 の「2 · HIT AREA」:
 *   形の中は必ずその県・形の外は輪郭から 16px 以内で最も近い県・全国は地方で判定・触れている県を優先する粘り（別の県が 6px 以上近いときだけ切り替え）。
 * **固定のベクトル**（`docs/home-map-hit-vectors.json`）を、iOS の実装でも同じ数字で試験できる表として出す。
 * 表を作り直すとき: `UPDATE_HIT_VECTORS=1 npx vitest run lib/utils/__tests__/japanMapHit.test.ts`
 */
const ALL = new Set(PREFECTURE_SHAPES.map((s) => s[0]));
const VECTORS_PATH = join(__dirname, "../../../docs/home-map-hit-vectors.json");

/** 画面の px / 単位（390px 画面の地図の幅 358px・地方は外接箱に合わせた拡大） */
const scaleOf = (stage: RegionName | null) => NOMINAL_W / viewFor(stage).w;
const ctx = (stage: RegionName | null, among: ReadonlySet<string> = ALL): HitContext => ({ region: stage, s: scaleOf(stage), among });
const key = (h: Hit | null) => hitKey(h);

type Vec = { id: string; stage: string; s: number; x: number; y: number; prev: string | null; expect: string | null };
const round = (n: number) => Math.round(n * 100) / 100;

/** 地方・県の名前の札を出す位置（県の中に置いた字の中心＝県の中の点）。北海道・沖縄は県そのもの */
const INNER = new Map<string, [number, number]>(REGION_LABELS.map((l) => [l[0], [l[3], l[4]]]));

describe("当たり判定: 形の中は必ずその県・輪郭から 16px 以内", () => {
    it("県の名前の位置（県の中の点）は、その県の形の中（拡大した地方の中ではその県に必ず当たる）", () => {
        expect(INNER.size).toBe(46);
        for (const [slug, [x, y]] of INNER) {
            expect(insideShape(slug, x, y), `${slug} の字の点が形の外`).toBe(true);
            const r = regionOf(slug);
            const h = hitAt(x, y, ctx(r)).best;
            expect(key(h), slug).toBe(`pref:${slug}`);
        }
    });

    it("全国の画面では、同じ点が「地方」に当たる（北海道・沖縄は県）", () => {
        for (const [slug, [x, y]] of INNER) {
            const r = regionOf(slug);
            const h = hitAt(x, y, ctx(null)).best;
            expect(key(h), slug).toBe(isDirectRegion(r) ? `pref:${slug}` : `region:${r}`);
        }
    });

    it("沖縄は枠ぜんたいが 1 つの面（枠の中・枠から 16px 以内は沖縄・17px 外は当たらない）", () => {
        const [ox, oy, ow, oh] = OKINAWA_FRAME;
        const s = scaleOf(null);
        const inside = hitAt(ox + ow / 2, oy + oh / 2, ctx(null)).best;
        expect(key(inside)).toBe("pref:okinawa");
        // 枠の右側（本土の県は近くにない）で測る
        const x = ox + ow, y = oy + oh / 2;
        expect(okinawaFrameDistancePx(x + 15.5 / s, y, s)).toBeCloseTo(15.5, 5);
        expect(key(hitAt(x + 15.5 / s, y, ctx(null)).best)).toBe("pref:okinawa");
        expect(hitAt(x + 17 / s, y, ctx(null)).best).toBeNull();
    });

    it("形の外は輪郭から 16px: 北海道の東の端から 15.5px は当たり・16.5px は当たらない（全国・縮尺 0.994）", () => {
        const s = scaleOf(null);
        const g = geoOf("hokkaido")!;
        // 北海道のいちばん東の点（頂点）から真東へ
        let vx = -Infinity, vy = 0;
        for (const r of g.rings) for (let i = 0; i < r.length; i += 2) if (r[i] > vx) { vx = r[i]; vy = r[i + 1]; }
        const near = hitAt(vx + 15.5 / s, vy, ctx(null));
        expect(key(near.best)).toBe("pref:hokkaido");
        expect(near.ds.get("pref:hokkaido")).toBeGreaterThan(15);
        expect(near.ds.get("pref:hokkaido")).toBeLessThan(15.6);
        expect(hitAt(vx + 16.5 / s, vy, ctx(null)).best).toBeNull();
        // 拡大した地方では、同じ 16px でも単位は小さい（東北の縮尺 s≈3.6 → 4.4 単位）
        const tohoku = scaleOf("東北");
        expect(tohoku).toBeGreaterThan(3);
        const g2 = geoOf("aomori")!;
        let ax = Infinity, ay = 0;
        for (const r of g2.rings) for (let i = 0; i < r.length; i += 2) if (r[i + 1] < ax) { ax = r[i + 1]; ay = r[i]; } // いちばん北の頂点から真北へ
        expect(key(hitAt(ay, ax - 15.5 / tohoku, ctx("東北")).best)).toBe("pref:aomori");
        expect(hitAt(ay, ax - 16.5 / tohoku, ctx("東北")).best).toBeNull();
    });

    it("海（どの県からも遠い所）は当たらない", () => {
        for (const stage of [null, ...REGION_ORDER.filter((r) => !isDirectRegion(r))]) {
            expect(hitAt(40, 100, ctx(stage)).best, String(stage)).toBeNull(); // 日本海の沖
            expect(hitAt(345, 250, ctx(stage)).best, String(stage)).toBeNull(); // 太平洋の沖
        }
    });

    it("離島も同じ県: 鹿児島の離島の頂点（本土から遠い）は、九州の画面で鹿児島に当たる", () => {
        const g = geoOf("kagoshima")!;
        const main = g.rings.reduce((m, r) => (r.length > m.length ? r : m), g.rings[0]);
        const island = g.rings.find((r) => r !== main && r.length >= 6);
        expect(island, "鹿児島に離島の輪がある").toBeTruthy();
        const x = island![0], y = island![1];
        expect(key(hitAt(x, y, ctx("九州")).best)).toBe("pref:kagoshima");
        // 全国では九州（地方）
        expect(key(hitAt(x, y, ctx(null)).best)).toBe("region:九州");
    });

    it("拡大した地方の外の県の形の中で離すと「地方ごと切り替え」: 関東の画面で長野の中", () => {
        const [x, y] = INNER.get("nagano")!;
        const h = hitAt(x, y, ctx("関東")).best;
        expect(h).toEqual({ k: "switch", slug: "nagano" });
        // 地方内の県から 16px 以内なら地方内を優先（群馬との県境に近い長野側の点）
        const g = geoOf("gunma")!;
        const r0 = g.rings[0];
        const near = hitAt(r0[0], r0[1], ctx("関東")).best; // 群馬の輪の頂点（距離 0）
        expect(near).toEqual({ k: "pref", slug: expect.any(String) });
    });

    it("全国の画面の地方の距離は、その地方の県のうち最も近い県までの距離（東京の海の側 10px → 関東）", () => {
        const s = scaleOf(null);
        const g = geoOf("tokyo")!;
        let vx = -Infinity, vy = 0;
        for (const r of g.rings) for (let i = 0; i < r.length; i += 2) if (r[i] > vx && r[i + 1] < 270) { vx = r[i]; vy = r[i + 1]; }
        const h = hitAt(vx + 6 / s, vy, ctx(null));
        expect(h.best).not.toBeNull();
    });

    it("独立に書いた計算（形の内外＋辺までの距離）と、乱数の点 8,000 個で一致する（全国・東北・関東・中部・近畿・中国・四国・九州）", () => {
        const R = rng(11);
        let checked = 0, withHit = 0;
        for (const stage of [null, "東北", "関東", "中部", "近畿", "中国", "四国", "九州"] as (RegionName | null)[]) {
            const v = viewFor(stage);
            const s = scaleOf(stage);
            for (let i = 0; i < 1000; i++) {
                const p: Pt = [v.x + R() * v.w, v.y + R() * v.h];
                let want: string | null = null;
                if (stage === null) {
                    const dr = new Map<string, number>();
                    for (const sh of PREFECTURE_SHAPES) {
                        if (sh[0] === "okinawa") continue;
                        const d = inShape(sh[0], p) ? 0 : edgeDistance(sh[0], p) * s;
                        const r = regionOf(sh[0]);
                        dr.set(r, Math.min(dr.get(r) ?? Infinity, d));
                    }
                    const [ox, oy, ow, oh] = OKINAWA_FRAME;
                    dr.set("沖縄", Math.hypot(Math.max(ox - p[0], 0, p[0] - ox - ow), Math.max(oy - p[1], 0, p[1] - oy - oh)) * s);
                    let bd = Infinity;
                    for (const r of REGION_ORDER) { const d = dr.get(r)!; if (d <= HIT_CAP_PX && d < bd) { bd = d; want = r === "北海道" ? "pref:hokkaido" : r === "沖縄" ? "pref:okinawa" : `region:${r}`; } }
                } else {
                    let bd = Infinity;
                    for (const slug of membersOf(stage)) {
                        const d = inShape(slug, p) ? 0 : edgeDistance(slug, p) * s;
                        if (d <= HIT_CAP_PX && d < bd) { bd = d; want = `pref:${slug}`; }
                    }
                    if (want === null) {
                        for (const sh of PREFECTURE_SHAPES) {
                            if (sh[0] === "okinawa" || membersOf(stage).includes(sh[0])) continue;
                            if (inShape(sh[0], p)) { want = `switch:${sh[0]}`; break; }
                        }
                    }
                }
                const got = key(hitAt(p[0], p[1], ctx(stage)).best);
                expect(got, `${stage ?? "全国"} (${p[0].toFixed(2)}, ${p[1].toFixed(2)})`).toBe(want);
                checked++;
                if (want) withHit++;
            }
        }
        expect(checked).toBe(8000);
        expect(withHit).toBeGreaterThan(1500); // 当たる点も十分に含まれている
    });
});

describe("当たり判定: 触れている県を優先する粘り（別の県が 6px 以上近いときだけ切り替える）", () => {
    /** 地方の画面で、どの県の形の外にある・2 つの県までの距離が near / far の点を探す（全部決まった格子） */
    function findGap(stage: RegionName, minGap: number, maxGap: number) {
        const v = viewFor(stage), s = scaleOf(stage);
        for (let gy = 0; gy < 160; gy++) for (let gx = 0; gx < 160; gx++) {
            const x = v.x + (gx + 0.5) * (v.w / 160), y = v.y + (gy + 0.5) * (v.h / 160);
            const ds = membersOf(stage)
                .map((slug) => [slug, prefDistancePx(slug, x, y, s)] as const)
                .filter(([, d]) => d > 0 && d <= HIT_CAP_PX)
                .sort((a, b) => a[1] - b[1]);
            if (ds.length >= 2) {
                const gap = ds[1][1] - ds[0][1];
                if (gap >= minGap && gap <= maxGap) return { x, y, a: ds[0][0], b: ds[1][0], da: ds[0][1], db: ds[1][1], gap };
            }
        }
        return null;
    }

    it("差が 6px 未満なら、触れている県（遠いほう）のまま。6px を超えれば最も近い県へ切り替わる", () => {
        const close = findGap("関東", 0.5, 4.5) ?? findGap("近畿", 0.5, 4.5) ?? findGap("中部", 0.5, 4.5);
        const far = findGap("関東", 7, 16) ?? findGap("近畿", 7, 16) ?? findGap("中部", 7, 16) ?? findGap("東北", 7, 16);
        expect(close, "差の小さい点が見つかる").not.toBeNull();
        expect(far, "差の大きい点が見つかる").not.toBeNull();
        const stageOf = (slug: string) => regionOf(slug);
        const c = close!;
        const stage = stageOf(c.a);
        const prev: Hit = { k: "pref", slug: c.b };
        expect(key(hitAt(c.x, c.y, ctx(stage)).best)).toBe(`pref:${c.a}`); // 粘りなしなら最寄り
        expect(key(pickHit(c.x, c.y, ctx(stage), prev))).toBe(`pref:${c.b}`); // 粘る
        const f = far!;
        const stage2 = stageOf(f.a);
        expect(key(pickHit(f.x, f.y, ctx(stage2), { k: "pref", slug: f.b }))).toBe(`pref:${f.a}`); // 6px 超は切り替え
        expect(STICK_PX).toBe(6);
    });

    it("形の中は必ずその県: 触れていた県から 1px でも近い別の県の形の中に入ったら、粘らず切り替える", () => {
        const [x, y] = INNER.get("tochigi")!;
        const prev: Hit = { k: "pref", slug: "ibaraki" };
        expect(key(pickHit(x, y, ctx("関東"), prev))).toBe("pref:tochigi");
    });

    it("触れていた県が 16px より遠くなったら、粘らない（どこにも当たらなければ null）", () => {
        const prev: Hit = { k: "pref", slug: "tokyo" };
        expect(pickHit(40, 100, ctx("関東"), prev)).toBeNull();
    });
});

describe("当たり判定: 固定のベクトル（docs/home-map-hit-vectors.json・iOS で同じ数字で試験できる）", () => {
    function buildVectors(): Vec[] {
        const out: Vec[] = [];
        const add = (id: string, stage: RegionName | null, x: number, y: number, prev: Hit | null = null) => {
            const c = ctx(stage);
            out.push({ id, stage: stage ?? "全国", s: Math.round(c.s * 1e6) / 1e6, x: round(x), y: round(y), prev: key(prev), expect: key(pickHit(round(x), round(y), c, prev)) });
        };
        for (const [slug, [x, y]] of INNER) {
            add(`中心・${slug}・地方の画面`, regionOf(slug), x, y);
            add(`中心・${slug}・全国`, null, x, y);
        }
        add("中心・okinawa・全国（枠の中心）", null, OKINAWA_FRAME[0] + OKINAWA_FRAME[2] / 2, OKINAWA_FRAME[1] + OKINAWA_FRAME[3] / 2);
        // 輪郭からの距離: 県のいちばん端の頂点から、海の側（他の県のない向き）へ d px
        for (const [slug, stage, dx, dy, dir] of [["hokkaido", null, 1, 0, "東"], ["aomori", "東北", 0, -1, "北"], ["kagawa", "四国", 0, -1, "北"], ["wakayama", "近畿", 0, 1, "南"], ["kochi", "四国", 0, 1, "南"], ["chiba", "関東", 1, 0, "東"]] as const) {
            const g = geoOf(slug)!;
            let bx = 0, by = 0, bs = -Infinity;
            for (const r of g.rings) for (let i = 0; i < r.length; i += 2) { const v = r[i] * dx + r[i + 1] * dy; if (v > bs) { bs = v; bx = r[i]; by = r[i + 1]; } }
            const s = scaleOf(stage);
            for (const d of [0, 8, 15.5, 16.5, 30]) add(`${dir}の端から ${d}px・${slug}`, stage, bx + (dx * d) / s, by + (dy * d) / s);
        }
        // 沖縄の枠の外
        const [ox, oy, ow, oh] = OKINAWA_FRAME;
        const s0 = scaleOf(null);
        for (const d of [0, 15.5, 16.5]) add(`沖縄の枠の右から ${d}px`, null, ox + ow + d / s0, oy + oh / 2);
        // 海・離島・地方ごと切り替え
        add("海・日本海の沖・全国", null, 40, 100);
        add("海・太平洋の沖・関東", "関東", 345, 250);
        const g = geoOf("kagoshima")!;
        const main = g.rings.reduce((m, r) => (r.length > m.length ? r : m), g.rings[0]);
        const island = g.rings.find((r) => r !== main && r.length >= 6)!;
        add("離島・鹿児島の離島の頂点・九州", "九州", island[0], island[1]);
        add("切り替え・関東の画面の長野の中", "関東", ...INNER.get("nagano")!);
        // 粘り
        const v = viewFor("関東"), s = scaleOf("関東");
        let found = 0;
        for (let gy = 0; gy < 160 && found < 3; gy++) for (let gx = 0; gx < 160 && found < 3; gx++) {
            const x = v.x + (gx + 0.5) * (v.w / 160), y = v.y + (gy + 0.5) * (v.h / 160);
            const ds = membersOf("関東").map((sl) => [sl, prefDistancePx(sl, x, y, s)] as const).filter(([, d]) => d > 0 && d <= HIT_CAP_PX).sort((a, b) => a[1] - b[1]);
            if (ds.length >= 2 && gx % 23 === 0 && ds[1][1] - ds[0][1] < 5.5) { add(`粘り・${ds[1][0]} に触れたまま ${ds[0][0]} が ${(ds[1][1] - ds[0][1]).toFixed(1)}px 近い`, "関東", x, y, { k: "pref", slug: ds[1][0] }); found++; }
        }
        return out;
    }

    it("ベクトルの表が、いまの実装と一致する（形のデータ・判定を変えたら、表を作り直して iOS へも渡す）", () => {
        const now = buildVectors();
        if (process.env.UPDATE_HIT_VECTORS === "1") {
            writeFileSync(VECTORS_PATH, JSON.stringify({ note: "ホームの日本地図の当たり判定の固定ベクトル（docs/home-map-hit-vectors.md）。x,y は viewBox の単位（幅 360）、s は画面の px / 単位。", cap: HIT_CAP_PX, stick: STICK_PX, vectors: now }, null, 1) + "\n");
        }
        expect(existsSync(VECTORS_PATH)).toBe(true);
        const saved = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as { cap: number; stick: number; vectors: Vec[] };
        expect(saved.cap).toBe(16);
        expect(saved.stick).toBe(6);
        expect(saved.vectors.length).toBe(now.length);
        expect(saved.vectors.length).toBeGreaterThan(120);
        for (let i = 0; i < now.length; i++) expect(saved.vectors[i], now[i].id).toEqual(now[i]);
    });

    it("ベクトルは 3 種の当たり（pref・region・switch）と「当たらない」をぜんぶ含む", () => {
        const saved = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as { vectors: Vec[] };
        const kinds = new Set(saved.vectors.map((v) => (v.expect ?? "null").split(":")[0]));
        expect([...kinds].sort()).toEqual(["null", "pref", "region", "switch"]);
        expect(MAP_W).toBe(360);
        expect(boundaryDistance("tokyo", 0, 0)).toBeGreaterThan(100);
    });
});
