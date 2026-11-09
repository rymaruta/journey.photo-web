// lib/utils/spotListSearch.ts
//
// **撮影スポット一覧（`/spots`）の検索窓の規則**（2026-11-09 owner「撮影スポットを探す一覧に検索窓がほしい」・
// Web と iOS の両方で見た目と検索の規則をそろえる）。純関数だけ（fs も JSX も持たない）。
//
// ## 🔴 iOS はこの規則に合わせる（正本はこのファイルと `docs/spot-list-search.md`）
//
// ### 1. 正規化（`foldSpotText`）——比べる前に両側へ同じ変換をかける
//   1. Unicode NFKC（全角英数・全角記号 → 半角、半角カナ → 全角カナ、「㈱」などの互換文字）
//   2. 小文字化（大文字小文字を区別しない）
//   3. カタカナ → ひらがな（U+30A1〜U+30F6 を 0x60 引く。「ー」は残す）。
//      「ギンザン」「ぎんざん」「ｷﾞﾝｻﾞﾝ」が同じ綴りになる
//   4. 空白（全角含む）・中黒（・）・読点・括弧・ピリオドを落とす。「オペラ・ガルニエ」と「オペラガルニエ」が同じ
//   ※ 濁点・長音・「ヶ／ケ／が」の揺れは寄せない（過剰に当てると別の場所が混ざる）
//
// ### 2. 語の分け方（`splitSpotTerms`）
//   入力を**空白（全角含む）・読点（、，,）で分け**、各語を正規化する。空の語は捨てる。最大 6 語（それ以上は無視）。
//   **全部の語が当たった行だけ**が結果（AND）。
//   **先に、続けた1語（語を空白なしでつなげたもの）として名前の欄に当てる**。当たればその順位で確定
//   （「嵐山 渡月橋」は名前「嵐山渡月橋」の連続一致を優先）。外れたときだけ語ごとに当てる（下の 3）。
//   折りたたみは行ごとに最初に1回だけ（毎キーで全件を折りたたまない）。
//
// ### 3. 1語が1行に当たる条件（部分一致）
//   名前の欄 = スポット名・英語名・読み・別名（どれか1つ）に語が**含まれる**。
//   - 完全一致 → 順位 0／前方一致 → 順位 1／部分一致 → 順位 2
//   地域の欄 = 地域の文字（「山形県 尾花沢市」・海外は「フランス パリ」）に語が含まれる → 順位 3
//   - 語が**県の読み・英語名の前方**（「やまがた」「yamagata」・2文字以上）なら、その県の名前が
//     地域の文字に含まれていても当たり（地域の文字は漢字なので、ひらがなで県を探せるように）
//   当たらない語が1つでもあれば、その行は結果に出さない。
//
// ### 4. 並び順
//   行の順位 = 語ごとに当てたときは各語の順位のうち**いちばん弱い（大きい）もの**（iOS と同じ）。
//   順位の小さい順、同じ順位は渡された順（台帳の順）。語が無いときは並べ替えない（ふだんの並びのまま）。
//   つまり**スポット名の前方一致が先**、名前の部分一致が次、地域だけで当たったものが最後。
//   枚数・人気・評価では並べない。
//
// ### 5. 県の一覧への導線（`matchSpotAreas`）
//   地域（県・「海外」）の名前・英語名・読み・綴り（slug）に**全部の語**が含まれる地域を、
//   県の一覧（`/spots/area/<slug>`）への近道として出す。名前の前方一致が先。最大 8。
//
// ### 6. 入力の扱い
//   - 打つたびに絞り込む（Enter で確定しない）。ただし**変換中（IME の確定前）は絞り込まない**。確定したら絞る
//   - 空・空白だけの入力は「検索なし」＝ふだんの一覧
//   - 0件のときは「見つかりません」と、県の一覧への導線を出す
//   - 検索語は外へ送らない（アナリティクスには長さと件数だけ）
//
// 折りたたみ（1）は `normalizeSpotName`（`lib/utils/spots.ts`）とは別に持つ（あちらにかなの折りたたみを足すと
// `spotAutoLink` のテストが15件落ちる）。「さがす」・地図の検索（`searchSpotRows`）はあちらのまま（かなを同じに見ない）。

import { PREFECTURES } from "../data/prefectures";
import type { SpotSearchRow } from "./spots";

/** 検索に使う最大の語数（長すぎる貼り付けで重くならないように） */
export const SPOT_LIST_MAX_TERMS = 6;

/**
 * 比べる前の正規化（規則 1）。判定にしか使わない。
 *
 * 🔴 **`normalizeSpotName` は変えず、別に持つ**（2026-11-09 判断）。あちらにかなの折りたたみを足すと、
 * 写真の撮影地とスポットの自動の結び（`spotAutoLink.ts`・「カタカナの続きは切れ目ではない」など
 * カタカナのまま比べる規則）が 15 件落ちる（実測）。呼び元を壊さないため、検索窓だけこの関数を使う。
 */
export function foldSpotText(value?: string): string {
    return (value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        // カタカナ → ひらがな（ァ〜ヶ・ヽヾ）。長音「ー」（U+30FC）は範囲外なので残る
        .replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
        .replace(/[\s　・･,、，()（）「」『』.。]+/g, "");
}

/** 入力を語に分ける（規則 2）。空なら `[]` */
export function splitSpotTerms(query: string): string[] {
    return query
        .normalize("NFKC")
        .split(/[\s、，,]+/)
        .map(foldSpotText)
        .filter(Boolean)
        .slice(0, SPOT_LIST_MAX_TERMS);
}

/** 県の読み（ひらがな）。`PREFECTURES` の `slug` で引く。地域の文字は漢字なので、ひらがなで県を探すために持つ */
const PREFECTURE_READING: Record<string, string> = {
    hokkaido: "ほっかいどう", aomori: "あおもり", iwate: "いわて", miyagi: "みやぎ", akita: "あきた",
    yamagata: "やまがた", fukushima: "ふくしま", ibaraki: "いばらき", tochigi: "とちぎ", gunma: "ぐんま",
    saitama: "さいたま", chiba: "ちば", tokyo: "とうきょう", kanagawa: "かながわ", niigata: "にいがた",
    toyama: "とやま", ishikawa: "いしかわ", fukui: "ふくい", yamanashi: "やまなし", nagano: "ながの",
    gifu: "ぎふ", shizuoka: "しずおか", aichi: "あいち", mie: "みえ", shiga: "しが",
    kyoto: "きょうと", osaka: "おおさか", hyogo: "ひょうご", nara: "なら", wakayama: "わかやま",
    tottori: "とっとり", shimane: "しまね", okayama: "おかやま", hiroshima: "ひろしま", yamaguchi: "やまぐち",
    tokushima: "とくしま", kagawa: "かがわ", ehime: "えひめ", kochi: "こうち", fukuoka: "ふくおか",
    saga: "さが", nagasaki: "ながさき", kumamoto: "くまもと", oita: "おおいた", miyazaki: "みやざき",
    kagoshima: "かごしま", okinawa: "おきなわ",
    overseas: "かいがい",
};

/** 県の読みの綴り（slug）→ 正規化済みの読み */
export function prefectureReading(slug: string): string {
    return foldSpotText(PREFECTURE_READING[slug]);
}

/** 語（2文字以上）が県の読み・英語名の前方なら、その県の正規化済みの名前（地域の文字を引くため） */
function prefectureNamesByReading(term: string): string[] {
    if (term.length < 2) return [];
    return PREFECTURES
        .filter((p) => prefectureReading(p.slug).startsWith(term) || foldSpotText(p.nameEn).startsWith(term))
        .map((p) => foldSpotText(p.name));
}

/** 行ごとに1回だけ折りたたんだ欄（毎キーで全件を折りたたまない） */
type Folded = { names: string[]; region: string };
const foldedCache = new WeakMap<SpotSearchRow, Folded>();
function foldedOf(row: SpotSearchRow): Folded {
    let f = foldedCache.get(row);
    if (!f) {
        f = {
            names: [row.n, row.e, row.r, ...(row.a ?? [])].map(foldSpotText).filter(Boolean),
            region: foldSpotText(row.g),
        };
        foldedCache.set(row, f);
    }
    return f;
}

/** 折りたたみ済みの名前の欄に対する1語の順位（完全 0・前方 1・部分 2・外れ -1） */
function foldedNameRank(names: readonly string[], term: string): number {
    let rank = -1;
    for (const f of names) {
        if (f === term) return 0;
        if (f.startsWith(term)) rank = rank < 0 ? 1 : Math.min(rank, 1);
        else if (f.includes(term) && rank < 0) rank = 2;
    }
    return rank;
}

/** 県の近道用（折りたたみは毎回）。完全 0・前方 1・部分 2・外れ -1 */
function nameRank(fields: readonly (string | undefined)[], term: string): number {
    return foldedNameRank(fields.map(foldSpotText).filter(Boolean), term);
}

/** 行の順位。外れなら -1（規則 3・4）。**先に、続けた1語として名前に当てる**（「嵐山 渡月橋」は名前の連続一致を優先） */
function rowRank(row: SpotSearchRow, terms: readonly string[]): number {
    const { names, region } = foldedOf(row);
    if (terms.length > 1) {
        const whole = foldedNameRank(names, terms.join(""));
        if (whole >= 0) return whole;
    }
    // 語ごと。**いちばん弱い語の順位**（全部の語が当たる必要がある）
    let worst = 0;
    for (const t of terms) {
        let r = foldedNameRank(names, t);
        if (r < 0 && (region.includes(t) || prefectureNamesByReading(t).some((n) => region.includes(n)))) r = 3;
        if (r < 0) return -1;
        worst = Math.max(worst, r);
    }
    return worst;
}

/** 名前の索引（`SpotSearchRow`）を語で絞る。空の入力は `[]`（検索なし）。並びは規則 4 */
export function searchSpotList(rows: readonly SpotSearchRow[], query: string): SpotSearchRow[] {
    const terms = splitSpotTerms(query);
    if (terms.length === 0) return [];
    const hits: Array<{ row: SpotSearchRow; rank: number; i: number }> = [];
    rows.forEach((row, i) => {
        const rank = rowRank(row, terms);
        if (rank >= 0) hits.push({ row, rank, i });
    });
    return hits.sort((a, b) => a.rank - b.rank || a.i - b.i).map((h) => h.row);
}

/** 県の一覧への近道に必要な項目（`SpotArea` の部分型） */
export type SpotAreaLike = { slug: string; name: string; nameEn: string; count: number };

/** 地域の名前で当たる県・「海外」（規則 5）。最大 8 */
export function matchSpotAreas<T extends SpotAreaLike>(areas: readonly T[], query: string): T[] {
    const terms = splitSpotTerms(query);
    if (terms.length === 0) return [];
    const hits: Array<{ area: T; rank: number; i: number }> = [];
    areas.forEach((area, i) => {
        const fields = [area.name, area.nameEn, area.slug, PREFECTURE_READING[area.slug]];
        let worst = 0;
        for (const t of terms) {
            const r = nameRank(fields, t);
            if (r < 0) return;
            worst = Math.max(worst, r);
        }
        hits.push({ area, rank: worst, i });
    });
    return hits.sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, 8).map((h) => h.area);
}
