// lib/utils/japanMapHit.ts
//
// ホームの日本地図の**当たり判定**（DOM を持たない・自前）。`HomeJapanMap` が指・マウスの位置から「どの地方・県か」を決めるのに使う。
// 固定のベクトルで固めた表は `docs/home-map-hit-vectors.md`（iOS で同じ計算を移すとき、同じ数字で試験できる）。
//
// 2026-11-09 判断（owner 承認 案C・仕様 v4。現行の `nearestByBox`＝外接箱までの距離 を置き換え）:
//   - 形の中は必ずその県。形の外は、**輪郭から 16px 以内**でいちばん近い県（画面の px ÷ 拡大率で単位に換算）
//   - 全国の画面は**地方**で判定する（地方の距離＝その地方の県のうち最も近い県までの距離）。北海道・沖縄は県そのものが 1 つの面
//     （沖縄は枠ぜんたい。枠までの距離）。拡大した地方では、その地方の県だけを見る。地方の外の県の形の中で離したときは
//     「地方ごと切り替え」（`switch`）になる（地方内の県から 16px 以内なら、地方内を優先）
//   - **選択中（指が触れている）の県を優先する粘り**: 別の県が 6px 以上近いときだけ切り替える。
//     ただし**形の中は必ずその県**なので、新しい候補が形の中（距離 0）なら粘らない（粘るのは海・隙間の上だけ）
//     2026-11-09: 仕様書 v4 の表は 3px、依頼文は 6px。依頼文（後の指示）に合わせた。値は `STICK_PX`
//   - 辺までの距離は点と線分の最短距離、内外は偶奇則（光線法）。**県ごとの輪を `d`（`prefectureShapes.ts`）から読み直す**ので、
//     生成物を作り直すとこの判定も同じ形で動く

import { OKINAWA_FRAME, PREFECTURE_SHAPES } from "../data/prefectureShapes";
import { geoOf, type Ring } from "./japanMapGeo";
import { REGION_ORDER, isDirectRegion, membersOf, regionOf, type RegionName } from "./japanMapView";

/** 形の外の当たりの広さ（画面の px） */
export const HIT_CAP_PX = 16;
/** 触れている県を優先する粘り（画面の px）。別の県がこれ以上近いときだけ切り替える */
export const STICK_PX = 6;

export type Hit =
    | { k: "region"; region: RegionName }
    | { k: "pref"; slug: string }
    /** 拡大した地方の外の県の形の中（離すと、その県の地方へ切り替えて県を選ぶ） */
    | { k: "switch"; slug: string };

export function hitKey(h: Hit | null): string | null {
    if (!h) return null;
    return h.k === "region" ? `region:${h.region}` : `${h.k}:${h.slug}`;
}

export function sameHit(a: Hit | null, b: Hit | null): boolean {
    return hitKey(a) === hitKey(b);
}

// ---- 形（`d` の輪・`japanMapGeo.ts`） ----

function inRing(r: Ring, x: number, y: number): boolean {
    let inside = false;
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** 点が県の形の中か（離島も含む） */
export function insideShape(slug: string, x: number, y: number): boolean {
    const g = geoOf(slug);
    if (!g) return false;
    const b = g.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    return g.rings.some((r) => inRing(r, x, y));
}

/** 点から県の輪郭までの最短距離（単位）。内外は問わない */
export function boundaryDistance(slug: string, x: number, y: number): number {
    const g = geoOf(slug);
    if (!g) return Infinity;
    let best = Infinity;
    for (const r of g.rings) {
        const n = r.length / 2;
        for (let i = 0; i < n; i++) {
            const ax = r[2 * i], ay = r[2 * i + 1];
            const j = i + 1 === n ? 0 : i + 1;
            const dx = r[2 * j] - ax, dy = r[2 * j + 1] - ay;
            const l = dx * dx + dy * dy;
            const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l));
            const ex = ax + t * dx - x, ey = ay + t * dy - y;
            const q = ex * ex + ey * ey;
            if (q < best) best = q;
        }
    }
    return Math.sqrt(best);
}

/** 点から県までの距離（画面の px）。形の中は 0 */
export function prefDistancePx(slug: string, x: number, y: number, s: number): number {
    return insideShape(slug, x, y) ? 0 : boundaryDistance(slug, x, y) * s;
}

/** 点が、県の外接箱を `padUnits` だけ広げた中か（遠い県の計算を省く） */
function nearBox(slug: string, x: number, y: number, padUnits: number): boolean {
    const g = geoOf(slug);
    if (!g) return false;
    const b = g.box;
    return !(x < b[0] - padUnits || x > b[2] + padUnits || y < b[1] - padUnits || y > b[3] + padUnits);
}

// ---- 当たり ----

export type HitContext = {
    /** 画面: 全国は null・拡大した地方はその地方 */
    region: RegionName | null;
    /** 画面の px / 単位 */
    s: number;
    /** リンクのある県 */
    among: ReadonlySet<string>;
    /** 形の外の当たりの広さ（px）。既定 16 */
    cap?: number;
};

export type HitResult = {
    best: Hit | null;
    /** 候補ごとの距離（px・`hitKey` で引く）。粘りの比較に使う */
    ds: Map<string, number>;
};

const NOT_OKINAWA = (slug: string) => slug !== "okinawa";

/** 地方（北海道・沖縄は県そのもの）に対応する当たり */
export function regionHit(region: RegionName): Hit {
    return region === "北海道" ? { k: "pref", slug: "hokkaido" } : region === "沖縄" ? { k: "pref", slug: "okinawa" } : { k: "region", region };
}

/** 沖縄の枠までの距離（px・枠の中は 0） */
export function okinawaFrameDistancePx(x: number, y: number, s: number): number {
    const [ox, oy, ow, oh] = OKINAWA_FRAME;
    return Math.hypot(Math.max(ox - x, 0, x - ox - ow), Math.max(oy - y, 0, y - oy - oh)) * s;
}

/** 点（viewBox の単位）の当たり。`best` は 16px 以内でいちばん近いもの（無ければ null） */
export function hitAt(x: number, y: number, ctx: HitContext): HitResult {
    const cap = ctx.cap ?? HIT_CAP_PX;
    const { s, among } = ctx;
    const pad = (cap + 10) / s;
    const ds = new Map<string, number>();
    let best: Hit | null = null;

    if (ctx.region === null) {
        // 全国: 地方（北海道・沖縄は県）。地方の距離＝その地方の県のうち最も近い県
        const dr = new Map<RegionName, number>();
        for (const sh of PREFECTURE_SHAPES) {
            const slug = sh[0];
            if (!NOT_OKINAWA(slug) || !among.has(slug) || !nearBox(slug, x, y, pad)) continue;
            const r = regionOf(slug);
            const d = prefDistancePx(slug, x, y, s);
            const cur = dr.get(r);
            if (cur === undefined || d < cur) dr.set(r, d);
        }
        if (among.has("okinawa")) dr.set("沖縄", okinawaFrameDistancePx(x, y, s));
        let bd = Infinity;
        for (const r of REGION_ORDER) {
            const d = dr.get(r);
            if (d === undefined) continue;
            const h = regionHit(r);
            ds.set(hitKey(h)!, d);
            if (d <= cap && d < bd) { bd = d; best = h; }
        }
        return { best, ds };
    }

    const inRegion = new Set(membersOf(ctx.region));
    let bd = Infinity;
    for (const sh of PREFECTURE_SHAPES) {
        const slug = sh[0];
        if (!inRegion.has(slug) || !among.has(slug) || !nearBox(slug, x, y, pad)) continue;
        const d = prefDistancePx(slug, x, y, s);
        ds.set(`pref:${slug}`, d);
        if (d <= cap && d < bd) { bd = d; best = { k: "pref", slug }; }
    }
    if (!best) {
        // 地方の外の県の形の中（地方ごと切り替える）。沖縄の枠は拡大した地方の外にある
        for (const sh of PREFECTURE_SHAPES) {
            const slug = sh[0];
            if (inRegion.has(slug) || !NOT_OKINAWA(slug) || !among.has(slug)) continue;
            if (insideShape(slug, x, y)) { best = { k: "switch", slug }; break; }
        }
    }
    return { best, ds };
}

/**
 * 指・マウスの位置の当たり（粘りつき）。`prev` は今触れているもの。
 * `prev` が候補で、新しい `best` より `STICK_PX` 以内にしか遠くなく、`prev` 自身も 16px 以内なら、`prev` のまま。
 * 新しい候補が形の中（距離 0）なら粘らない（形の中は必ずその県）。
 */
export function pickHit(x: number, y: number, ctx: HitContext, prev: Hit | null, stick = STICK_PX): Hit | null {
    const r = hitAt(x, y, ctx);
    const b = r.best;
    if (!b || !prev || sameHit(prev, b) || prev.k === "switch") return b;
    const cap = ctx.cap ?? HIT_CAP_PX;
    const dp = r.ds.get(hitKey(prev)!);
    const db = b.k === "switch" ? undefined : r.ds.get(hitKey(b)!);
    if (dp === undefined || db === undefined) return b;
    if (db <= 0) return b;
    if (dp <= db + stick && dp <= cap) return prev;
    return b;
}
