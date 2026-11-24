// テスト専用の道具（`*.test.*` ではないので単体では流れない）。`lib/data/prefectureShapes.ts` のパス d を
// 点の列に戻し、点の内外・縁までの距離・当たりの解決（部品の DOM の振る舞いの幾何モデル）を計算する。
import { OKINAWA_FRAME, PREFECTURE_SHAPES } from "../../data/prefectureShapes";

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

/** 乱数（再現できるように種つき） */
export function rng(seed: number): () => number {
    let s = seed;
    return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}
