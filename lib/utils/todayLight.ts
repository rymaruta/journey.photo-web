// lib/utils/todayLight.ts
//
// **「今日の日の出・日の入り」の頁（/today・/today/<県>）が使う、純粋な計算と整形**（2026-11-07）。
//
// 値の出どころは新しく作らない: 日の出・日の入り・ゴールデンアワー・ブルーアワーは `sunTimes.ts`、
// 朝・夕の段と日付の札は `spotLight.ts`、月ごとの表は `lightCalendar.ts` が持つもの
// （国立天文台の暦と照らす試験つき・スポットの頁と同じ式）。ここは頁に要る足りない部分だけ:
//   - 昼の長さ（表に出した日の出・日の入りの "HH:MM" の差。画面の2つの時刻と食い違わないように）
//   - 現在地が日本の範囲か
//   - 近くのスポットの索引（`nearby.json`）の行の型と、近い順に並べる関数
//
// **座標はこのファイルの外へ出さない。** 通信も保存も計測もしない（頁に書いてある約束）。
// 見張りは `app/today/__tests__/`。

import { haversineKm } from "./journey";
import { clockIn, sunTimes } from "./sunTimes";
import { LIGHT_DAY_OF_MONTH, LIGHT_REFERENCE_YEAR } from "./lightCalendar";

/** 日本の時計（この頁は日本の中だけを扱う） */
export const TODAY_TIME_ZONE = "Asia/Tokyo";

/** 日本の範囲（沖ノ鳥島・南鳥島・与那国までを含む外枠）。外なら「日本国内ではない」と言う */
export const JAPAN_BOUNDS = { latMin: 20, latMax: 46, lngMin: 122, lngMax: 154 } as const;

export function inJapan(c: { lat: number; lng: number }): boolean {
    return Number.isFinite(c.lat) && Number.isFinite(c.lng)
        && c.lat >= JAPAN_BOUNDS.latMin && c.lat <= JAPAN_BOUNDS.latMax
        && c.lng >= JAPAN_BOUNDS.lngMin && c.lng <= JAPAN_BOUNDS.lngMax;
}

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 昼の長さ（「10時間12分」）。日の出か日の入りが無い日は null。表の "HH:MM" の差なので、画面の2つの時刻と食い違わない */
export function dayLengthText(sunrise: string | null, sunset: string | null): string | null {
    if (!sunrise || !sunset) return null;
    const m = minutesOf(sunset) - minutesOf(sunrise);
    if (!Number.isFinite(m) || m <= 0) return null;
    return `${Math.floor(m / 60)}時間${m % 60}分`;
}

/** その日・その場所の昼の長さ（日本の時計） */
export function dayLengthAt(ymd: string, coords: { lat: number; lng: number }): string | null {
    const t = sunTimes(ymd, coords);
    if (!t) return null;
    return dayLengthText(clockIn(TODAY_TIME_ZONE, t.sunrise), clockIn(TODAY_TIME_ZONE, t.sunset));
}

/** 月ごとの表の1行（各月15日。`lightCalendar` と同じ代表日・同じ年） */
export type MonthlyDay = { month: number; ymd: string; dayLength: string | null };

export function monthlyDayLengths(coords: { lat: number; lng: number }): MonthlyDay[] {
    return Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const ymd = `${LIGHT_REFERENCE_YEAR}-${String(month).padStart(2, "0")}-${String(LIGHT_DAY_OF_MONTH).padStart(2, "0")}`;
        return { month, ymd, dayLength: dayLengthAt(ymd, coords) };
    });
}

/**
 * 近くのスポットの索引（`/app/data/nearby.json`）の1行。
 * `[slug, 名前, 緯度, 経度, 種類の短い語（台帳の category）, 県スラッグ]`。緯度経度は小数3桁
 */
export type NearbyRow = [slug: string, name: string, lat: number, lng: number, kind: string, pref: string];

export type NearbyHit = { slug: string; name: string; kind: string; pref: string; km: number };

/** 地点から近い順に `limit` 件。同じ距離は索引の並びのまま（安定） */
export function nearestSpots(rows: readonly NearbyRow[], from: { lat: number; lng: number }, limit: number): NearbyHit[] {
    return rows
        .map((r, i) => ({ r, i, km: haversineKm(from, { lat: r[2], lng: r[3] }) }))
        .sort((a, b) => a.km - b.km || a.i - b.i)
        .slice(0, limit)
        .map(({ r, km }) => ({ slug: r[0], name: r[1], kind: r[4], pref: r[5], km }));
}

/** 索引（JSON）を読んだ値が、行の形をしているか（壊れた配信を画面に流さない） */
export function isNearbyRows(v: unknown): v is NearbyRow[] {
    return Array.isArray(v) && v.every((r) =>
        Array.isArray(r) && r.length === 6
        && typeof r[0] === "string" && typeof r[1] === "string"
        && typeof r[2] === "number" && typeof r[3] === "number"
        && typeof r[4] === "string" && typeof r[5] === "string");
}
