// lib/utils/japanMapTip.ts
//
// ホームの日本地図の**名前の札**の置き場所（DOM を持たない）。
//
// 2026-11-09 判断（owner 承認 案C・仕様 v4）: 札は**指の真上**（指の輪の上端から 20px 空ける）。
//   上に入らないとき（札の上端が安全域より上に出るとき）だけ左右へ退避: 指が画面の右半分なら左側、左半分なら右側
//   （指と 16px…輪の外から 20px 空ける）。左右に入らなければ、地図の上の固定欄にだけ出す（`mode: "fixed"`）。
//   横へ出したあと上へ戻すのは 12px の余裕ができてから（行き来のちらつきを防ぐ）。左右の端は 8px 内側へ収める。

export type TipMode = "above" | "left" | "right" | "fixed";

export type Rect = { left: number; top: number; right: number; bottom: number };

export type TipInput = {
    /** 指の位置（画面の px） */
    fx: number;
    fy: number;
    /** 札の幅・高さ */
    tw: number;
    th?: number;
    /** 安全域（画面の px）: 札を置いてよい範囲。上はヘッダーの下 */
    safe: Rect;
    /** 前回の置き方（ちらつき防止） */
    prev: TipMode;
    /** 指の輪の半径（54px の輪の半分） */
    ring?: number;
    /** 指との間 */
    gap?: number;
};

export const TIP_H = 56;
export const TIP_GAP = 20;
export const FINGER_RING_R = 27;
export const TIP_MARGIN = 8;
const HYST = 12;

export function placeTip(i: TipInput): { x: number; y: number; mode: TipMode } {
    const th = i.th ?? TIP_H, g = i.gap ?? TIP_GAP, fr = i.ring ?? FINGER_RING_R, { safe } = i;
    const clampX = (x: number) => Math.max(safe.left + TIP_MARGIN, Math.min(safe.right - TIP_MARGIN - i.tw, x));
    const fits = (x: number, y: number) => x >= safe.left + TIP_MARGIN && x + i.tw <= safe.right - TIP_MARGIN && y >= safe.top && y + th <= safe.bottom;
    const aboveY = i.fy - fr - g - th;
    if (aboveY >= safe.top + (i.prev === "above" ? 0 : HYST)) return { x: clampX(i.fx - i.tw / 2), y: aboveY, mode: "above" };
    const sy = Math.max(safe.top, i.fy - th / 2);
    const left = i.fx - fr - g - i.tw, right = i.fx + fr + g;
    const mid = (safe.left + safe.right) / 2;
    const order: [TipMode, number][] = i.fx > mid ? [["left", left], ["right", right]] : [["right", right], ["left", left]];
    for (const [m, x] of order) if (fits(x, sy)) return { x, y: sy, mode: m };
    return { x: (safe.left + safe.right - i.tw) / 2, y: safe.top, mode: "fixed" };
}
