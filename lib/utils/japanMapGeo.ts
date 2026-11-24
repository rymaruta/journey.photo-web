// lib/utils/japanMapGeo.ts
//
// ホームの日本地図の県の形（`lib/data/prefectureShapes.ts` の `d`）を、点の輪に読み直す（DOM を持たない）。
// 当たり判定（`japanMapHit.ts`）と、地方の拡大（`japanMapView.ts`）が同じ輪を見る。

import { PREFECTURE_SHAPES } from "../data/prefectureShapes";

export type Ring = Float64Array; // [x0, y0, x1, y1, …]（閉じた輪）
export type Geo = {
    rings: Ring[];
    /** 全部の輪（離島を含む）の外接箱 [x0, y0, x1, y1] */
    box: [number, number, number, number];
    /** いちばん大きい輪（本土）の外接箱 [x0, y0, x1, y1] */
    mainBox: [number, number, number, number];
};

/** `M x y l dx dy … z` の繰り返し（生成物の形式・相対座標）を絶対座標の輪にする */
export function parseRings(d: string): Ring[] {
    const rings: Ring[] = [];
    const num = /-?(?:\d+\.?\d*|\.\d+)/g;
    for (const m of d.matchAll(/M([^l]+)l([^z]+)z/g)) {
        const head = m[1].match(num)!.map(Number);
        const rest = (m[2].match(num) ?? []).map(Number);
        const out = new Float64Array(2 + rest.length - (rest.length % 2));
        let x = head[0], y = head[1];
        out[0] = x; out[1] = y;
        for (let i = 0, o = 2; i + 1 < rest.length; i += 2, o += 2) { x += rest[i]; y += rest[i + 1]; out[o] = x; out[o + 1] = y; }
        rings.push(out);
    }
    return rings;
}

function boxOf(rings: Ring[]): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
    }
    return [x0, y0, x1, y1];
}

function ringArea(r: Ring): number {
    let a = 0;
    const n = r.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1]; }
    return Math.abs(a) / 2;
}

let GEO: Map<string, Geo> | null = null;

export function geoOf(slug: string): Geo | undefined {
    if (!GEO) {
        GEO = new Map();
        for (const s of PREFECTURE_SHAPES) {
            const rings = parseRings(s[1]);
            const main = rings.reduce((m, r) => (ringArea(r) > ringArea(m) ? r : m), rings[0]);
            GEO.set(s[0], { rings, box: boxOf(rings), mainBox: boxOf([main]) });
        }
    }
    return GEO.get(slug);
}
