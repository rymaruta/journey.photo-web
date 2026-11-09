// lib/utils/japanMapView.ts
//
// ホームの日本地図（`app/components/HomeJapanMap.tsx`）の「地方」と「見え方」の計算（DOM を持たない）。
//
// 2026-11-09 判断（owner 承認: 案C「地方 → 県」）:
//   - 全国の画面では**地方**を当て、離すと地方が拡大して開く（県は選ばない）。拡大した地方の中で**県**を当てる。
//     北海道と沖縄は地方を拡大せず、直接県を選ぶ（北海道は 1 県で 1 地方・沖縄は枠の中）
//   - 「九州・沖縄」（`prefectures.ts` の地方）は、九州（7県）と沖縄（独立した面）に分ける
//   - 拡大は**地方の外接箱**に合わせる。箱は各県のいちばん大きい輪（本土）の外接箱の和に、外へ 3 単位の余白（東京の伊豆・小笠原の島、
//     鹿児島の離島などの小さな島は箱に入れない——入れると関東が 6 倍ではなく 4 倍になる・2026-11-09 実測）。基準の地図は幅 358px（左右 16px の余白の 390px 画面）

import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "../data/prefectureShapes";
import { geoOf } from "./japanMapGeo";
import { PREFECTURES } from "../data/prefectures";

export type RegionName = "北海道" | "東北" | "関東" | "中部" | "近畿" | "中国" | "四国" | "九州" | "沖縄";

/** 地方チップ・一覧の並び（北から南） */
export const REGION_ORDER: readonly RegionName[] = ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州", "沖縄"];

/** 地方を拡大して開く地方（北海道・沖縄は拡大せず直接県を選ぶ） */
export const ZOOM_REGIONS: readonly RegionName[] = ["東北", "関東", "中部", "近畿", "中国", "四国", "九州"];

const REGION_OF = new Map<string, RegionName>(
    PREFECTURES.map((p) => [p.slug, p.slug === "okinawa" ? "沖縄" : p.region === "九州・沖縄" ? "九州" : (p.region as RegionName)]),
);

export function regionOf(slug: string): RegionName {
    return REGION_OF.get(slug) ?? "中部";
}

/** その地方の県（`PREFECTURE_SHAPES` の並び＝北から南） */
export function membersOf(region: RegionName): string[] {
    return PREFECTURE_SHAPES.filter((s) => REGION_OF.get(s[0]) === region).map((s) => s[0]);
}

/** 北海道・沖縄は拡大せず直接県を選ぶ */
export function isDirectRegion(region: RegionName): boolean {
    return region === "北海道" || region === "沖縄";
}

/** 全国の画面で地方名を出す位置（viewBox の単位・デザイナーの提案書 v4） */
export const REGION_POS: Readonly<Record<Exclude<RegionName, "沖縄">, readonly [number, number]>> = {
    北海道: [298, 62], 東北: [252, 165], 中部: [184, 226], 関東: [240, 252], 近畿: [146, 286], 中国: [84, 276], 四国: [100, 316], 九州: [42, 346],
};

/** 沖縄の枠の中心（「沖縄県」の字を置く） */
export const OKINAWA_CENTER: readonly [number, number] = [OKINAWA_FRAME[0] + OKINAWA_FRAME[2] / 2, OKINAWA_FRAME[1] + OKINAWA_FRAME[3] / 2];

/** 基準の地図の幅（px）。390px 画面の左右 16px 余白＝358px */
export const NOMINAL_W = 358;
export const NOMINAL_H = (NOMINAL_W * MAP_H) / MAP_W;
/** 地方の外接箱の外の余白（viewBox の単位） */
export const REGION_BOX_PAD = 3;

/** viewBox。`z` は全国の画面を 1 としたときの拡大率 */
export type MapView = { x: number; y: number; w: number; h: number; z: number };

export const ALL_VIEW: MapView = { x: 0, y: 0, w: MAP_W, h: MAP_H, z: 1 };

/** 地方の外接箱 [x, y, w, h]（県のいちばん大きい輪の箱の和＋ 3 単位。九州は沖縄を含めない） */
export function regionBox(region: RegionName): [number, number, number, number] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of membersOf(region)) {
        const b = geoOf(s)!.mainBox;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    const p = REGION_BOX_PAD;
    return [x0 - p, y0 - p, x1 - x0 + 2 * p, y1 - y0 + 2 * p];
}

/**
 * 地方を拡大した viewBox（箱を地図の真ん中に）。
 * 実際の地図の幅が違っても、viewBox の縦横比は地図と同じ（`MAP_W : MAP_H`）なので、そのまま使える。
 */
export function regionView(region: RegionName): MapView {
    if (isDirectRegion(region)) return ALL_VIEW;
    const [bx, by, bw, bh] = regionBox(region);
    const s = Math.min(NOMINAL_W / bw, NOMINAL_H / bh); // 基準の画面の px / 単位
    const z = s / (NOMINAL_W / MAP_W);
    const w = MAP_W / z, h = MAP_H / z;
    return { x: bx + bw / 2 - w / 2, y: by + bh / 2 - h / 2, w, h, z };
}

/** 画面（stage）に対応する viewBox */
export function viewFor(region: RegionName | null): MapView {
    return region === null ? ALL_VIEW : regionView(region);
}

/** 県を選んだあと、地図がどの画面にいるか（北海道・沖縄は全国のまま・ほかは自分の地方） */
export function regionForSelection(slug: string): RegionName | null {
    const r = regionOf(slug);
    return isDirectRegion(r) ? null : r;
}

/** 2 つの viewBox の補間（`u` は 0〜1） */
export function lerpView(a: MapView, b: MapView, u: number): MapView {
    const l = (p: number, q: number) => p + (q - p) * u;
    return { x: l(a.x, b.x), y: l(a.y, b.y), w: l(a.w, b.w), h: l(a.h, b.h), z: MAP_W / l(a.w, b.w) };
}

/** ease-out cubic */
export function easeOut(u: number): number {
    return 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
}

/** 地図のスクリーン上の幅（px）と viewBox から、画面の px / 単位 */
export function pxPerUnit(widthPx: number, view: MapView): number {
    return widthPx / view.w;
}
