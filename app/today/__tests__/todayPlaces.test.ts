import { describe, it, expect } from "vitest";
import { PREFECTURES } from "@/lib/data/prefectures";
import { SPOTS } from "@/lib/data/spots";
import { haversineKm } from "@/lib/utils/journey";
import { clockIn, sunTimes } from "@/lib/utils/sunTimes";
import { lightBlocksFor } from "@/lib/utils/spotLight";
import { lightCalendar, lightCellText } from "@/lib/utils/lightCalendar";
import { inJapan, monthlyDayLengths, dayLengthText, TODAY_TIME_ZONE } from "@/lib/utils/todayLight";
import {
    todayPlaces, todayPlace, nearbyForPlace, PREFECTURE_CAPITAL_CITY,
    NEARBY_RADIUS_KM, NEARBY_LIMIT, todayPrefTitle, TODAY_HUB_TITLE,
} from "@/lib/data/todayPlaces";

/**
 * **47県の座標と、近くのスポット。** 座標は台帳（県庁所在地の市のスポットの平均）から出す。
 * 値の出どころは `sunTimes`（国立天文台の暦と照らす試験は `sunTimes.test.ts`）。
 */
describe("47県の頁の場所", () => {
    const places = todayPlaces();

    it("47県すべてに場所があり、県庁所在地の名前の表も47県そろっている", () => {
        expect(places).toHaveLength(47);
        expect(places.map((p) => p.pref.slug)).toEqual(PREFECTURES.map((p) => p.slug));
        expect(Object.keys(PREFECTURE_CAPITAL_CITY).sort()).toEqual(PREFECTURES.map((p) => p.slug).sort());
    });

    it("座標は日本国内に収まる（47県ぜんぶ）", () => {
        for (const p of places) {
            expect(inJapan(p.coords), p.pref.name).toBe(true);
            expect(Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng), p.pref.name).toBe(true);
        }
    });

    it("平均に使った点の広がりが大きすぎない（県庁所在地の市の外へ平均が飛んでいない）", () => {
        for (const p of places) {
            expect(p.sampleCount, p.pref.name).toBeGreaterThan(0);
            expect(p.spreadKm, `${p.pref.name} ${p.basis}`).toBeLessThanOrEqual(50);
        }
    });

    it("出どころは県庁所在地の市のスポット（台帳に該当が無い県だけ県内の重心）", () => {
        for (const p of places) {
            expect(["capital-spots", "prefecture-centroid"]).toContain(p.basis);
        }
        // いまの台帳では、47県すべてが県庁所在地の市のスポットで出せている（変わったら頁の注記が切り替わる）
        expect(places.filter((p) => p.basis === "capital-spots")).toHaveLength(47);
    });

    it("題は日付を入れない安定した文で、47県で重ならない", () => {
        const titles = places.map(todayPrefTitle);
        expect(new Set(titles).size).toBe(47);
        for (const t of titles) {
            expect(t).toMatch(/^.+の今日の日の出・日の入り時刻｜ゴールデンアワーと近くの撮影スポット$/);
            expect(t).not.toMatch(/\d{4}|\d+月|\d+日(?!の)/);
            expect(t).not.toMatch(/Journey Photo|旅フォト/);   // サイト名は title.template が足す
        }
        expect(todayPrefTitle(todayPlace("tokyo")!)).toBe("東京の今日の日の出・日の入り時刻｜ゴールデンアワーと近くの撮影スポット");
        expect(TODAY_HUB_TITLE).not.toMatch(/\d{4}/);
    });
});

describe("近くの撮影スポット", () => {
    const places = todayPlaces();

    it("距離の近い順で、12件まで", () => {
        for (const p of places) {
            const { items } = nearbyForPlace(p);
            expect(items.length, p.pref.name).toBeLessThanOrEqual(NEARBY_LIMIT);
            expect(items.length, p.pref.name).toBeGreaterThan(0);
            const kms = items.map((i) => i.km);
            expect(kms, p.pref.name).toEqual([...kms].sort((a, b) => a - b));
            expect(new Set(items.map((i) => i.slug)).size, p.pref.name).toBe(items.length);
        }
    });

    it("半径内が3件以上なら全部が30km 以内。足りない県だけ県内のスポットで足す", () => {
        for (const p of places) {
            const near = nearbyForPlace(p);
            if (near.withinRadius >= 3) {
                expect(near.filledFromPrefecture, p.pref.name).toBe(false);
                // 丸めた km（約1km 刻みの表示用）で見るので、境界は 0.5km の余裕
                for (const i of near.items) expect(i.km, `${p.pref.name} ${i.name}`).toBeLessThanOrEqual(NEARBY_RADIUS_KM + 0.5);
            } else {
                expect(near.filledFromPrefecture, p.pref.name).toBe(true);
            }
        }
    });

    it("距離は県庁所在地の座標からの直線距離（haversineKm）で、台帳の座標と一致する", () => {
        const tokyo = todayPlace("tokyo")!;
        const near = nearbyForPlace(tokyo);
        expect(near.items[0].km).toBeLessThanOrEqual(near.items[near.items.length - 1].km);
        // 先頭と haversineKm の独立計算を突き合わせる
        const first = SPOTS.find((s) => s.slug === near.items[0].slug)!;
        const km = haversineKm(tokyo.coords, first.coords!);
        expect(Math.abs(near.items[0].km - km)).toBeLessThan(0.5);
    });
});

describe("日の出・日の入りの値は sunTimes と一致する", () => {
    it("東京・那覇・札幌: 今日の段・月ごとの表が sunTimes の直接の呼び出しと同じ", () => {
        for (const slug of ["tokyo", "okinawa", "hokkaido"]) {
            const p = todayPlace(slug)!;
            for (const ymd of ["2026-01-05", "2026-06-21", "2026-11-07", "2026-12-22"]) {
                const t = sunTimes(ymd, p.coords)!;
                const rise = clockIn(TODAY_TIME_ZONE, t.sunrise)!;
                const set = clockIn(TODAY_TIME_ZONE, t.sunset)!;
                const rows = lightBlocksFor(ymd, p.coords, TODAY_TIME_ZONE).flatMap((b) => b.rows);
                expect(rows.find((r) => r.label === "日の出")!.value, `${slug} ${ymd}`).toBe(rise);
                expect(rows.find((r) => r.label === "日の入り")!.value, `${slug} ${ymd}`).toBe(set);
            }
            const cal = lightCalendar(p.coords, "日本")!;
            expect(cal.rows).toHaveLength(12);
            const lens = monthlyDayLengths(p.coords);
            expect(lens).toHaveLength(12);
            cal.rows.forEach((r, i) => {
                const t = sunTimes(`2026-${String(r.month).padStart(2, "0")}-15`, p.coords)!;
                expect(lightCellText(r.sunrise, true)).toBe(clockIn(TODAY_TIME_ZONE, t.sunrise));
                expect(lightCellText(r.sunset, true)).toBe(clockIn(TODAY_TIME_ZONE, t.sunset));
                expect(lens[i].dayLength).toBe(dayLengthText(clockIn(TODAY_TIME_ZONE, t.sunrise), clockIn(TODAY_TIME_ZONE, t.sunset)));
            });
        }
    });

    it("昼の長さは表に出した日の出・日の入りの差", () => {
        expect(dayLengthText("06:00", "18:30")).toBe("12時間30分");
        expect(dayLengthText("06:00", null)).toBeNull();
        expect(dayLengthText(null, "18:30")).toBeNull();
    });

    it("日本の外枠", () => {
        expect(inJapan({ lat: 35.68, lng: 139.76 })).toBe(true);
        expect(inJapan({ lat: 48.85, lng: 2.35 })).toBe(false);     // パリ
        expect(inJapan({ lat: 0, lng: 0 })).toBe(false);
        expect(inJapan({ lat: NaN, lng: 139 })).toBe(false);
    });
});
