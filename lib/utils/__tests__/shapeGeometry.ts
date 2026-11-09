// テスト専用の道具（`*.test.*` ではないので単体では流れない）。`lib/data/prefectureShapes.ts` のパス d を
// 点の列に戻し、点の内外・縁までの距離・当たりの解決（部品の DOM の振る舞いの幾何モデル）を計算する。
import { OKINAWA_FRAME, PREFECTURE_SHAPES } from "../../data/prefectureShapes";
import { nearestByBox, NEAR_TAP_PX } from "../japanMap";

export type Pt = [number, number];

/** 生成物の形式（`M x y l dx dy … z` の繰り返し・相対座標）だけを読む */
export function parseRings(d: string): Pt[][] {
    const rings: Pt[][] = [];
    for (const m of d.matchAll(/M([^l]+)l([^z]+)z/g)) {
        const nums = (s: string) => (s.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
        const [x0, y0] = nums(m[1]);
        const rest = nums(m[2]);
        const ring: Pt[] = [[x0, y0]];
        let x = x0, y = y0;
        for (let i = 0; i + 1 < rest.length; i += 2) { x += rest[i]; y += rest[i + 1]; ring.push([x, y]); }
        rings.push(ring);
    }
    return rings;
}

export function inRing(p: Pt, ring: Pt[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const RINGS = new Map(PREFECTURE_SHAPES.map((s) => [s[0], parseRings(s[1])]));

export function inShape(slug: string, p: Pt): boolean {
    return (RINGS.get(slug) ?? []).some((r) => inRing(p, r));
}

export function edgeDistance(slug: string, p: Pt): number {
    let best = Infinity;
    for (const r of RINGS.get(slug) ?? []) {
        for (let i = 0; i < r.length; i++) best = Math.min(best, distToSegment(p, r[i], r[(i + 1) % r.length]));
    }
    return best;
}

export function inFrame(p: Pt): boolean {
    const [x, y, w, h] = OKINAWA_FRAME;
    return p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h;
}

/** 重なったとき小さな県が上（部品の `LINK_ORDER` と同じ並び） */
const ORDER = [...PREFECTURE_SHAPES].sort((a, b) => b[2][2] * b[2][3] - a[2][2] * a[2][3]);

/**
 * 点を押したときに選ばれる県（ブラウザの当たり→部品の海のタップの順）:
 *  1. 塗りの内側（上にある県）・沖縄は枠ぜんたい  2. 縁の当たり（halo 10px＝縁から外へ 5px）  3. 14px 以内の外接箱で最寄り
 */
export function resolveTap(p: Pt, pxPerUnit: number, among: ReadonlySet<string>): string | null {
    if (inFrame(p) && among.has("okinawa")) return "okinawa";
    let top: string | null = null;
    for (const s of ORDER) if (among.has(s[0]) && inShape(s[0], p)) top = s[0];
    if (top) return top;
    let halo: string | null = null, hd = 5 / pxPerUnit;
    for (const s of ORDER) {
        if (!among.has(s[0])) continue;
        const d = edgeDistance(s[0], p);
        if (d <= hd) { hd = d; halo = s[0]; }
    }
    if (halo) return halo;
    return nearestByBox(p[0], p[1], NEAR_TAP_PX / pxPerUnit, among);
}

/** 乱数（再現できるように種つき） */
export function rng(seed: number): () => number {
    let s = seed;
    return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}
