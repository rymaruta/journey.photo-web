// lib/data/homeSpotEntry.ts（サーバー専用・ビルド時に焼く）
//
// **ホームの「撮影スポットを県から探す」の節**（`app/components/HomeSpotEntry.tsx`）に渡すデータ。
//
// 2026-11-09 判断（owner「任せる」・SEO の入口・案A）:
//   - ホームの写真の並びの下に、国内の県と海外の国への文字リンクを**最初から HTML に出す**
//     （折りたたまない）。ホーム → 県（国）→ スポットの2クリックで全スポットに届く
//   - **件数は行き先の頁が名乗る件数と同じ数え方**にそろえる。県の頁は `spotIndexItemsForArea` の
//     件数（`SpotArea.count`・見える行）、国の頁は `countryTopics` の件数（導入文の「N件」）。
//     台帳そのものを数え直さない（提案書のモックは台帳の全行を数えた見本で、実装の件数と違う）
//   - 台帳（`SPOTS`）は**クライアントへ渡さない**（`spotLedgerClientImport.test.ts`）。
//     渡すのは県のスラッグと件数・国の2文字と名前と件数だけ（RSC ペイロードに載るので小さく）
//
// 🔴 国は頁が建つ国をすべて載せる。**1件だけの国（`MIN_INDEXABLE_COUNTRY` 未満・頁は `noindex`）も載せる**:
//   そのスポット（2026-11-09 時点でバチカン市国・ジンバブエ・モンゴルの各1件）は、検索に出る
//   どのハブ（県・国・テーマ・季節）からもリンクされておらず、ここが唯一の入口になるため。
//   `noindex, follow` の頁へのリンクは評価の面では弱いが、利用者の入口としては要る（3本・全体の約3%）

import { spotAreas } from "./spotLink";
import { countryTopics } from "./spotTopics";

/** 大陸の分け。並びはこの順（国は件数の多い順のまま）。表に無い国は最後の「その他の国・地域」に落とす */
export const CONTINENTS: ReadonlyArray<{ key: string; name: string; codes: readonly string[] }> = [
    { key: "europe", name: "ヨーロッパ", codes: [
        "fr", "es", "fi", "it", "de", "cz", "ch", "gr", "gb", "nl", "pt", "hr", "va", "at",
        "is", "no", "dk", "se", "ie", "hu", "pl", "be", "si", "ge",
    ] },
    { key: "asia", name: "アジア", codes: [
        "tw", "kr", "th", "vn", "sg", "hk", "mo", "cn", "id", "my", "in", "lk", "kh", "ph", "la", "mm", "mn", "uz", "np",
    ] },
    { key: "americas", name: "北米・中南米", codes: ["us", "ca", "mx", "pe", "ar", "br", "cl"] },
    { key: "oceania", name: "オセアニア", codes: ["au", "nz"] },
    { key: "mea", name: "中東・アフリカ", codes: ["tr", "jo", "ae", "ma", "eg", "ir", "zw", "za", "ke", "tz"] },
];

/** 表に無い国が出たときの置き場（リンクを落とさない。`homeSpotEntry.test.ts` が空であることを見張る） */
export const OTHER_CONTINENT_NAME = "その他の国・地域";

/** 県のスラッグと件数（国内・北から南） */
export type HomeAreaRow = readonly [slug: string, count: number];
/** 国の2文字・名前・件数 */
export type HomeCountryRow = readonly [code: string, name: string, count: number];
export type HomeSpotEntryData = {
    areas: HomeAreaRow[];
    continents: Array<{ name: string; countries: HomeCountryRow[] }>;
};

export function homeSpotEntryData(): HomeSpotEntryData {
    // 国内は都道府県だけ（`region` が `null` の海外の一括の区画は国の側で出す）
    const areas = spotAreas().filter((a) => a.region !== null).map((a): HomeAreaRow => [a.slug, a.count]);

    const byCode = new Map(countryTopics().map((c) => [c.code, c]));
    const placed = new Set<string>();
    const continents: HomeSpotEntryData["continents"] = [];
    for (const k of CONTINENTS) {
        // 国の並びは `countryTopics`（件数の多い順・同数は名前の順）のまま
        const countries = [...byCode.values()]
            .filter((c) => k.codes.includes(c.code))
            .map((c): HomeCountryRow => [c.code, c.name, c.spots.length]);
        countries.forEach((c) => placed.add(c[0]));
        if (countries.length > 0) continents.push({ name: k.name, countries });
    }
    const rest = [...byCode.values()].filter((c) => !placed.has(c.code))
        .map((c): HomeCountryRow => [c.code, c.name, c.spots.length]);
    if (rest.length > 0) continents.push({ name: OTHER_CONTINENT_NAME, countries: rest });
    return { areas, continents };
}
