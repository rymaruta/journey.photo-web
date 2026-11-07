// lib/data/todayPlaces.ts（サーバー側だけ。クライアントから import しない）
//
// **「今日の日の出・日の入り」の頁（/today/<県>）の場所と、近くの撮影スポット**（2026-11-07）。
//
// ## 座標の出どころ（座標の表を新しく手書きしない）
//
// 県庁所在地の座標は、台帳（`content/spots.json`）の**県庁所在地の市にあるスポットの座標の平均**。
// 「県庁所在地の市にある」は `region.city` が県庁所在地名で始まること（政令市は区まで書いてある:
// 「札幌市中央区」→「札幌市」で始まる）。東京都は都庁の所在地の新宿区。
// 該当するスポットが1件も無い県は、**県内のスポットの座標の平均（重心）**にして、頁にその旨を書く
// （`basis`）。台帳の座標は約1km に丸めてある（`lib/data/spots.ts`）ので、平均も数 km の幅を持つ。
// 日の出・日の入りは経度 0.1° で約 0.4 分動くので、これで困る精度ではない。
//
// ## 近くのスポット
//
// 県庁所在地から 30km 以内を近い順に 12 件（県をまたいでよい）。3 件に満たないときは、
// 県内のスポットを近い順に足して 12 件にする（`filledFromPrefecture`・頁に「30km 以内は n 件」と書く）。
// 母集合は頁を建てているスポット（`visibleSpots`）の国内の行だけ。

import { SPOTS, type Spot } from "./spots";
import { PREFECTURES, prefectureByName, prefectureBySlug, type Prefecture } from "./prefectures";
import { visibleSpots } from "../utils/spotGuide";
import { haversineKm, kmForLabel } from "../utils/journey";
import type { NearbyRow } from "../utils/todayLight";

/** 県庁所在地の市区の名前（`region.city` の頭に付く綴り）。座標ではなく名前の表 */
export const PREFECTURE_CAPITAL_CITY: Readonly<Record<string, string>> = {
    hokkaido: "札幌市", aomori: "青森市", iwate: "盛岡市", miyagi: "仙台市", akita: "秋田市",
    yamagata: "山形市", fukushima: "福島市", ibaraki: "水戸市", tochigi: "宇都宮市", gunma: "前橋市",
    saitama: "さいたま市", chiba: "千葉市", tokyo: "新宿区", kanagawa: "横浜市", niigata: "新潟市",
    toyama: "富山市", ishikawa: "金沢市", fukui: "福井市", yamanashi: "甲府市", nagano: "長野市",
    gifu: "岐阜市", shizuoka: "静岡市", aichi: "名古屋市", mie: "津市", shiga: "大津市",
    kyoto: "京都市", osaka: "大阪市", hyogo: "神戸市", nara: "奈良市", wakayama: "和歌山市",
    tottori: "鳥取市", shimane: "松江市", okayama: "岡山市", hiroshima: "広島市", yamaguchi: "山口市",
    tokushima: "徳島市", kagawa: "高松市", ehime: "松山市", kochi: "高知市", fukuoka: "福岡市",
    saga: "佐賀市", nagasaki: "長崎市", kumamoto: "熊本市", oita: "大分市", miyazaki: "宮崎市",
    kagoshima: "鹿児島市", okinawa: "那覇市",
};

/** 県庁所在地の近くのスポットを拾う半径 */
export const NEARBY_RADIUS_KM = 30;
/** 近くのスポットの最大件数 */
export const NEARBY_LIMIT = 12;
/** 半径内がこれに満たなければ県内のスポットで足す */
export const NEARBY_MIN_WITHIN = 3;

type PoolSpot = { spot: Spot; coords: { lat: number; lng: number }; pref: Prefecture };

let poolCache: PoolSpot[] | null = null;

/** 国内で、頁を建てていて、座標を持つスポット（台帳の順） */
function pool(): PoolSpot[] {
    if (poolCache) return poolCache;
    const out: PoolSpot[] = [];
    for (const spot of visibleSpots(SPOTS)) {
        if (spot.region?.country !== "日本" || !spot.coords) continue;
        const pref = prefectureByName(spot.region?.prefecture);
        if (!pref) continue;
        out.push({ spot, coords: spot.coords, pref });
    }
    poolCache = out;
    return out;
}

/** 「東京都」→「東京」。北海道はそのまま */
export function shortPrefName(p: Prefecture): string {
    return p.name === "北海道" ? p.name : p.name.replace(/[都府県]$/, "");
}

/** ハブ（/today）の題。日付を入れない安定した文（サイト名は `title.template` が足す） */
export const TODAY_HUB_TITLE = "今日の日の出・日の入り時刻｜ゴールデンアワーと近くの撮影スポット";

/** 県の頁の題。日付を入れない安定した文 */
export function todayPrefTitle(place: { shortName: string }): string {
    return `${place.shortName}の今日の日の出・日の入り時刻｜ゴールデンアワーと近くの撮影スポット`;
}

export type TodayPlaceBasis = "capital-spots" | "prefecture-centroid";

export type TodayPlace = {
    pref: Prefecture;
    /** 見出し・題に使う短い名前（東京・京都・北海道） */
    shortName: string;
    /** 県庁所在地の市区の名前（札幌市・新宿区） */
    capital: string;
    coords: { lat: number; lng: number };
    basis: TodayPlaceBasis;
    /** 平均に使ったスポットの件数 */
    sampleCount: number;
    /** 平均した点から、使ったスポットのいちばん遠い点までの距離（km）。平均の信頼の幅の目安 */
    spreadKm: number;
};

function centroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    return { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
}

const placeCache = new Map<string, TodayPlace>();

export function todayPlace(slug: string): TodayPlace | null {
    const hit = placeCache.get(slug);
    if (hit) return hit;
    const pref = prefectureBySlug(slug);
    const capital = PREFECTURE_CAPITAL_CITY[slug];
    if (!pref || !capital) return null;
    const inPref = pool().filter((p) => p.pref.slug === slug);
    const inCapital = inPref.filter((p) => {
        const city = p.spot.region?.city ?? "";
        return city === capital || (capital.endsWith("市") && city.startsWith(capital));
    });
    const basis: TodayPlaceBasis = inCapital.length > 0 ? "capital-spots" : "prefecture-centroid";
    const used = (inCapital.length > 0 ? inCapital : inPref).map((p) => p.coords);
    if (used.length === 0) return null;
    const coords = centroid(used);
    const place: TodayPlace = {
        pref, shortName: shortPrefName(pref), capital, coords, basis,
        sampleCount: used.length,
        spreadKm: Math.round(Math.max(...used.map((u) => haversineKm(coords, u)))),
    };
    placeCache.set(slug, place);
    return place;
}

/** 47県すべて（`PREFECTURES` の順）。座標が引けない県があれば落とすのではなく試験が落ちる */
export function todayPlaces(): TodayPlace[] {
    return PREFECTURES.map((p) => todayPlace(p.slug)).filter((p): p is TodayPlace => p !== null);
}

export type NearbyItem = {
    slug: string;
    name: string;
    /** 台帳の種類（神社・公園…）。無ければ空 */
    kind: string;
    /** 県庁所在地からの距離（`distanceLabel` が見せる桁に丸めた km） */
    km: number;
    /** 県名（県をまたぐ近さのとき、どの県かが分かるように） */
    prefName: string;
};

export type NearbyForPlace = {
    items: NearbyItem[];
    /** 半径内の件数（足す前） */
    withinRadius: number;
    /** 半径内が少なく、県内のスポットで足したか */
    filledFromPrefecture: boolean;
};

export function nearbyForPlace(place: TodayPlace): NearbyForPlace {
    const ranked = pool()
        .map((p, i) => ({ p, i, km: haversineKm(place.coords, p.coords) }))
        .sort((a, b) => a.km - b.km || a.i - b.i);
    const within = ranked.filter((r) => r.km <= NEARBY_RADIUS_KM);
    let chosen = within.slice(0, NEARBY_LIMIT);
    const filledFromPrefecture = within.length < NEARBY_MIN_WITHIN;
    if (filledFromPrefecture) {
        const have = new Set(chosen.map((r) => r.p.spot.slug));
        const extra = ranked.filter((r) => r.p.pref.slug === place.pref.slug && !have.has(r.p.spot.slug));
        chosen = [...chosen, ...extra].slice(0, NEARBY_LIMIT);
    }
    return {
        withinRadius: within.length,
        filledFromPrefecture,
        items: chosen.map((r) => ({
            slug: r.p.spot.slug,
            name: r.p.spot.name,
            kind: r.p.spot.category ?? "",
            km: kmForLabel(r.km),
            prefName: r.p.pref.name,
        })),
    };
}

// ── 近くのスポットの索引（/app/data/nearby.json）──

const round3 = (n: number) => Number(n.toFixed(3));

/** 索引の行（台帳の順）。国内で頁を建てているスポットだけ。緯度経度は小数3桁 */
export function nearbyIndexRows(): NearbyRow[] {
    return pool().map(({ spot, coords, pref }) => [
        spot.slug, spot.name, round3(coords.lat), round3(coords.lng), spot.category ?? "", pref.slug,
    ]);
}

/** 配る JSON（空白なし） */
export function nearbyIndexJson(): string {
    return JSON.stringify(nearbyIndexRows());
}
