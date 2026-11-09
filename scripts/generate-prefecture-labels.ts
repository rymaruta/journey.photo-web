// scripts/generate-prefecture-labels.ts
//
// ホームの日本地図の**県名の置き場**を作る（生成物: `lib/data/prefectureLabels.ts`・手で直さない）。
//
//   npx tsx scripts/generate-prefecture-labels.ts > lib/data/prefectureLabels.ts
//
// 2026-11-09 owner「地図に県の名前をつけ忘れている」。**小さい県・密集する関東・近畿・瀬戸内でも読める**ことが条件。
// 作り方（ここで決めた順に置く。判断は全部ここ）:
//   1. 字の大きさは画面で 12px。地図は画面の幅によって 1 単位 0.9〜1.17px なので、**いちばん狭い 0.9px/単位**
//      （幅およそ 324px）で重ならない置き場を作る。広い画面では字が相対的に小さくなるだけで、重ならない。
//   2. 県の内側に収まる県（横書き→縦書きの順）は、その中に置く。収まる＝文字の枠の 90% 以上が自分の県の中・
//      ほかの県に 2% より多くかからない。
//   3. 収まらない県は**海へ出し、引き出し線**（細い線＋県の中の点）でつなぐ。置き場は小さい県から順に、
//      ほかの県・ほかの字・地図の外・沖縄の枠にかからない場所のうち、引き出し線が短く、
//      ほかの県の上を通る長さが短いものを選ぶ。
//   4. 北海道・沖縄は別扱い（北海道は大きいので内側・沖縄は枠の「沖縄県」の字）。
//
// 出力: [スラッグ, 字, 向き("h"|"v"), 字の中心 x, y, 引き出し先の点 x, y（内側に置いた県は null）]

import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "../lib/data/prefectureShapes";
import { PREFECTURES } from "../lib/data/prefectures";
import { RINGS, inRing, edgeDistance, type Pt } from "../lib/utils/__tests__/shapeGeometry";

/** 設計の縮尺（px / 単位）。字 12px はここで 14.1 単位 */
export const DESIGN_PX = 0.9;
const FS = 12 / DESIGN_PX;
const LINE = FS * 1.12;
const PAD = 1.6;

type Orient = "h" | "v";
type Rect = [number, number, number, number]; // x0 y0 x1 y1

const SHORT = new Map(PREFECTURES.map((p) => [p.slug, p.slug === "hokkaido" ? p.name : p.name.replace(/[県府都]$/, "")]));
const SHAPE = new Map(PREFECTURE_SHAPES.map((s) => [s[0], s]));

function rectOf(cx: number, cy: number, n: number, o: Orient, pad = 0): Rect {
    const w = (o === "h" ? n * FS : LINE) / 2 + pad;
    const h = (o === "h" ? LINE : n * FS) / 2 + pad;
    return [cx - w, cy - h, cx + w, cy + h];
}
const overlap = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** 地図を 0.75 単位の格子に塗った表（県の番号。海は -1）。点の内外の問い合わせを速くする */
const G = 0.75;
const GW = Math.ceil(MAP_W / G) + 1, GH = Math.ceil(MAP_H / G) + 1;
const RASTER = new Int8Array(GW * GH).fill(-1);
const IDX = new Map(PREFECTURE_SHAPES.map((s, i) => [s[0], i]));
(() => {
    for (const s of PREFECTURE_SHAPES) {
        if (s[0] === "okinawa") continue;
        const [bx, by, bw, bh] = s[2];
        const rings = RINGS.get(s[0]) ?? [];
        for (let gx = Math.floor(bx / G); gx <= Math.ceil((bx + bw) / G); gx++) for (let gy = Math.floor(by / G); gy <= Math.ceil((by + bh) / G); gy++) {
            const p: Pt = [gx * G, gy * G];
            if (gx >= 0 && gy >= 0 && gx < GW && gy < GH && rings.some((r) => inRing(p, r))) RASTER[gy * GW + gx] = IDX.get(s[0])!;
        }
    }
})();
function slugIdxAt(p: Pt): number {
    const gx = Math.round(p[0] / G), gy = Math.round(p[1] / G);
    return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : RASTER[gy * GW + gx];
}
function inSlug(slug: string, p: Pt): boolean { return slugIdxAt(p) === IDX.get(slug); }
function slugAt(p: Pt): string | null { const i = slugIdxAt(p); return i < 0 ? null : PREFECTURE_SHAPES[i][0]; }
function samples(r: Rect, step: number): Pt[] {
    const out: Pt[] = [];
    for (let x = r[0]; x <= r[2] + 1e-6; x += step) for (let y = r[1]; y <= r[3] + 1e-6; y += step) out.push([x, y]);
    return out;
}

/** 県の内側の「いちばん奥」の点（縁から最も遠い格子点）。引き出し線の先 */
function pole(slug: string): Pt {
    const [bx, by, bw, bh] = SHAPE.get(slug)![2];
    let best: Pt = SHAPE.get(slug)![3] as Pt, bd = -1;
    for (let x = bx; x <= bx + bw; x += 1) for (let y = by; y <= by + bh; y += 1) {
        if (!inSlug(slug, [x, y])) continue;
        const d = edgeDistance(slug, [x, y]);
        if (d > bd) { bd = d; best = [x, y]; }
    }
    return best;
}

type Placed = { slug: string; text: string; o: Orient; x: number; y: number; anchor: Pt | null; rect: Rect };

function leaderCost(a: Pt, b: Pt, own: string): number {
    // 線がほかの県の上を通る長さ
    let over = 0;
    const n = 30;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let i = 1; i < n; i++) {
        const s = slugAt([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
        if (s && s !== own) over += len / n;
    }
    return over;
}

function nearestOnRect(r: Rect, p: Pt): Pt {
    return [Math.max(r[0], Math.min(r[2], p[0])), Math.max(r[1], Math.min(r[3], p[1]))];
}

const [OFX, OFY, OFW, OFH] = OKINAWA_FRAME;
const FRAME: Rect = [OFX - 2, OFY - 2, OFX + OFW + 2, OFY + OFH + 2];

/**
 * 1つの県の字の置き場の候補を全部点数にして、いちばん良いものを返す。
 * 点数が小さいほど良い: ほかの県にかかる割合（強く減点）・自分の県にかからない割合・極（県の奥の点）からの距離・
 * 引き出し線（字が自分の県に 25% もかからないときだけ付く）の長さとほかの県の上を通る長さ。
 * 置いた字どうしは重ならない（余白つき）・地図の外・沖縄の枠には出さない
 */
function best(slug: string, text: string, others: Placed[], anchor: Pt): Placed {
    const [bx, by, bw, bh] = SHAPE.get(slug)![2];
    const R = 46;
    let win: (Placed & { cost: number }) | null = null;
    for (const o of ["h", "v"] as Orient[]) {
        for (let x = Math.max(4, bx - R); x <= Math.min(MAP_W - 4, bx + bw + R); x += 1.5) {
            for (let y = Math.max(4, by - R); y <= Math.min(MAP_H - 4, by + bh + R); y += 1.5) {
                const r = rectOf(x, y, text.length, o, PAD);
                if (r[0] < 1 || r[2] > MAP_W - 1 || r[1] < 1 || r[3] > MAP_H - 1) continue;
                if (overlap(r, FRAME)) continue;
                if (others.some((q) => overlap(r, q.rect))) continue;
                const pts = samples(rectOf(x, y, text.length, o), 1.5);
                let mine = 0, other = 0;
                for (const p of pts) {
                    const i = slugIdxAt(p);
                    if (i === IDX.get(slug)) mine++; else if (i >= 0) other++;
                }
                const cm = mine / pts.length, co = other / pts.length;
                const leader = cm < 0.25;
                let cost = co * 120 + (1 - cm) * 18 + Math.hypot(x - anchor[0], y - anchor[1]) * 0.12 + (o === "v" ? 14 : 0);
                if (leader) {
                    const from = nearestOnRect(r, anchor);
                    cost += 12 + Math.hypot(from[0] - anchor[0], from[1] - anchor[1]) * 0.8 + leaderCost(from, anchor, slug) * 3;
                }
                if (!win || cost < win.cost) win = { slug, text, o, x, y, anchor: leader ? anchor : null, rect: r, cost };
            }
        }
    }
    if (!win) throw new Error(`置き場が無い: ${slug}`);
    return win;
}

function main() {
    const slugs = PREFECTURE_SHAPES.map((s) => s[0]).filter((x) => x !== "okinawa");
    const anchors = new Map(slugs.map((x) => [x, pole(x)]));
    // 小さい県から置き、そのあと1県ずつ外して置き直す（3回）
    const bySize = [...slugs].sort((a, b) => SHAPE.get(a)![2][2] * SHAPE.get(a)![2][3] - SHAPE.get(b)![2][2] * SHAPE.get(b)![2][3]);
    let placed: Placed[] = [];
    for (const slug of bySize) placed.push(best(slug, SHORT.get(slug)!, placed, anchors.get(slug)!));
    for (let pass = 0; pass < 3; pass++) {
        for (const slug of bySize) {
            const rest = placed.filter((p) => p.slug !== slug);
            placed = [...rest, best(slug, SHORT.get(slug)!, rest, anchors.get(slug)!)];
        }
    }
    const todo = placed.filter((p) => p.anchor).map((p) => p.slug);
    // 引き出し線の先は、字にいちばん近い「縁から 2.5 単位以上内側」の点に付け替える（長い線を作らない）
    for (const p of placed) {
        if (!p.anchor) continue;
        const [bx, by, bw, bh] = SHAPE.get(p.slug)![2];
        let bestPt: Pt = p.anchor, bd = Infinity;
        for (let x = bx; x <= bx + bw; x += 1) for (let y = by; y <= by + bh; y += 1) {
            if (!inSlug(p.slug, [x, y])) continue;
            const q = nearestOnRect(p.rect, [x, y]);
            const d = Math.hypot(q[0] - x, q[1] - y);
            if (d < bd && edgeDistance(p.slug, [x, y]) >= 2.5) { bd = d; bestPt = [x, y]; }
        }
        p.anchor = bestPt;
    }
    const order = new Map(PREFECTURE_SHAPES.map((s, i) => [s[0], i]));
    placed.sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
    const f = (n: number) => String(Math.round(n * 10) / 10);
    const rows = placed.map((p) => `    ["${p.slug}", "${p.text}", "${p.o}", ${f(p.x)}, ${f(p.y)}, ${p.anchor ? `${f(p.anchor[0])}, ${f(p.anchor[1])}` : "null, null"}],`);
    console.log(`// lib/data/prefectureLabels.ts（**生成物**・手で直さない）
//
// ホームの日本地図（\`app/components/HomeJapanMap.tsx\`）の県名の置き場。作り方と判断は
// \`scripts/generate-prefecture-labels.ts\`（\`npx tsx scripts/generate-prefecture-labels.ts > lib/data/prefectureLabels.ts\`）。
// 字は画面で 12px（部品が 12 ÷ 画面の px/単位 で描く）。設計の縮尺は ${DESIGN_PX}px/単位（幅およそ ${Math.round(MAP_W * DESIGN_PX)}px の地図）。
//
// label = [スラッグ, 字, 向き（h=横書き・v=縦書き）, 字の中心 x, y, 引き出し先の点 x, y（県の中に置いた字は null, null）]。単位は viewBox。
// 沖縄は枠の「沖縄県」の字（部品が描く）なのでここには無い。

export const LABEL_DESIGN_PX = ${DESIGN_PX};
export const LABEL_FONT_PX = 12;

export type PrefectureLabel = readonly [
    slug: string, text: string, orient: "h" | "v", x: number, y: number, ax: number | null, ay: number | null,
];

export const PREFECTURE_LABELS: readonly PrefectureLabel[] = [
${rows.join("\n")}
];
`);
    console.error(`内側 ${placed.filter((p) => !p.anchor).length} / 海へ ${todo.length}: ${todo.join(", ")}`);
}
main();
