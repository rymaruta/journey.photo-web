// lib/utils/mapReturn.ts
//
// ホームの日本地図から県の頁・スポットの頁へ進んだあと、**戻ったときに地図の位置へ帰る**ための覚え
// （2026-11-09 owner「地図で県に行って戻ったら、また地図に戻る」）。
//
// 覚えるもの: 選んでいた県と、進む直前のスクロール位置（`sessionStorage`・タブごと・1時間で失効）。
// 戻す方式: URL の `#pref=…`（選択県・`japanMap.ts`）で一覧を開き、この覚えのスクロール位置へ寄せる。
// ブラウザ自身のスクロール復元に任せきりにしない理由は、`HomeJapanMap` の注記（実測）を見る。
// すべて try/catch（プライベートモード・容量・無効化でも地図は動く）。

export const MAP_RETURN_KEY = "jm-return";
const MAX_AGE_MS = 60 * 60 * 1000;

export type MapReturn = { pref: string; y: number; t: number };

export function saveMapReturn(pref: string, y: number, now = Date.now()): void {
    try { window.sessionStorage.setItem(MAP_RETURN_KEY, JSON.stringify({ pref, y: Math.max(0, Math.round(y)), t: now } satisfies MapReturn)); } catch { /* 覚えられなくても動く */ }
}

/** 覚えを読む。形が違う・古い（1時間超）・読めないときは null */
export function readMapReturn(now = Date.now()): MapReturn | null {
    try {
        const v = JSON.parse(window.sessionStorage.getItem(MAP_RETURN_KEY) ?? "null") as Partial<MapReturn> | null;
        if (!v || typeof v.pref !== "string" || !/^[a-z]+$/.test(v.pref) || typeof v.y !== "number" || typeof v.t !== "number") return null;
        if (!Number.isFinite(v.y) || v.y < 0 || now - v.t > MAX_AGE_MS || now < v.t) return null;
        return { pref: v.pref, y: v.y, t: v.t };
    } catch { return null; }
}

export function clearMapReturn(): void {
    try { window.sessionStorage.removeItem(MAP_RETURN_KEY); } catch { /* 同上 */ }
}
