// lib/utils/japanMap.ts
//
// ホームの日本地図（`app/components/HomeJapanMap.tsx`）の**計算だけ**を切り出したもの（DOM を持たない）。
// 形のデータは `lib/data/prefectureShapes.ts`（生成物）。ここは「近くの県」「矢印キーの隣」「海のタップ」
// 「濃淡の段」「URL に持たせる選択県」。部品とテストが同じ関数を見る。
//
// 2026-11-09（2回目）: 当たり判定は `japanMapHit.ts`（輪郭までの距離・自前）・地方と見え方は `japanMapView.ts` へ移した。
//   外接箱までの距離で寄せる `nearestByBox` と、ピンチ・ボタンの拡大（`clampView`）は、案C（地方 → 県）で要らなくなり消した。
//
// 2026-11-09 判断（デザイナーの提案書・案D。owner「任せる」）:
//   - （2026-11-09 の2回目で撤回）「44px 以上の県は直接移動・小さい県は札」の分けは、県を押しても頁を移動せず
//     同じ頁に一覧を出す作りにしたので要らなくなった（`isDirectTap` を消した）。押し間違えても別の県を押せば直る

import { PREFECTURE_SHAPES, type PrefectureShape } from "../data/prefectureShapes";

const BY_SLUG = new Map<string, PrefectureShape>(PREFECTURE_SHAPES.map((s) => [s[0], s]));

export function shapeOf(slug: string): PrefectureShape | undefined {
    return BY_SLUG.get(slug);
}

/**
 * 近くの県（地図の上の重心の近い順）。`among` に載る県（リンクのある県）だけ。
 * 沖縄は枠で右下に動かしてあるので、地図の距離だと本州の県が並んでしまう——実際の近さ（九州の3県）に決め打ちする
 */
const NEAR_OVERRIDE: Readonly<Record<string, readonly string[]>> = {
    okinawa: ["kagoshima", "miyazaki", "kumamoto"],
};

export function nearestSlugs(slug: string, n: number, among: ReadonlySet<string>): string[] {
    const forced = (NEAR_OVERRIDE[slug] ?? []).filter((s) => among.has(s));
    if (forced.length >= n) return forced.slice(0, n);
    const a = BY_SLUG.get(slug);
    if (!a) return [];
    const rest = PREFECTURE_SHAPES
        .filter((s) => s[0] !== slug && among.has(s[0]) && !forced.includes(s[0]))
        // 沖縄は動かした位置にあるので、ほかの県の「近く」には入れない
        .filter((s) => s[0] !== "okinawa")
        .map((s) => [Math.hypot(s[3][0] - a[3][0], s[3][1] - a[3][1]), s[0]] as const)
        .sort((x, y) => x[0] - y[0])
        .map((x) => x[1]);
    return [...forced, ...rest].slice(0, n);
}

/** 矢印キーで動く先: その向きにいちばん近い県（向きの軸の距離＋横ずれ×1.6）。無ければ null */
export function neighborInDirection(slug: string, dx: number, dy: number, among: ReadonlySet<string>): string | null {
    const p = BY_SLUG.get(slug);
    if (!p) return null;
    let best: string | null = null;
    let bd = Infinity;
    for (const q of PREFECTURE_SHAPES) {
        if (q[0] === slug || !among.has(q[0])) continue;
        const ddx = q[3][0] - p[3][0];
        const ddy = q[3][1] - p[3][1];
        const along = ddx * dx + ddy * dy;
        if (along <= 1) continue;
        const across = Math.abs(ddx * dy) + Math.abs(ddy * dx);
        const d = along + across * 1.6;
        if (d < bd) { bd = d; best = q[0]; }
    }
    return best;
}

/** 件数の濃淡の段の切れ目（四分位）。`counts` は県ごとの件数 */
export function densityCuts(counts: readonly number[]): [number, number, number] {
    const sorted = [...counts].sort((a, b) => a - b);
    const at = (k: number) => sorted[Math.max(0, Math.ceil((sorted.length * k) / 4) - 1)] ?? 0;
    return [at(1), at(2), at(3)];
}

export function densityBin(n: number, cuts: readonly [number, number, number]): 0 | 1 | 2 | 3 {
    return n <= cuts[0] ? 0 : n <= cuts[1] ? 1 : n <= cuts[2] ? 2 : 3;
}

/** URL に持たせる選択県（`#pref=kanagawa`）。戻る・共有・一覧の頁から戻ったときに同じ県の一覧へ戻すための鍵 */
export const PREF_HASH_KEY = "pref";

export function prefHash(slug: string): string {
    return `#${PREF_HASH_KEY}=${slug}`;
}

/** ハッシュから選択県を読む。地図に在る県（`among`）のスラッグだけ通す（形の違う値・知らない県は null） */
export function prefFromHash(hash: string, among: ReadonlySet<string>): string | null {
    const v = new URLSearchParams(hash.replace(/^#/, "")).get(PREF_HASH_KEY);
    return v && /^[a-z]+$/.test(v) && among.has(v) ? v : null;
}
