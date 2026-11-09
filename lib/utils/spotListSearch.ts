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
// ### 3. 1語が1行に当たる条件
//   名前の欄 = スポット名・英語名・読み・別名（どれか1つ）に語が**含まれる**: 完全一致 0／前方一致 1／部分一致 2
//   地域の欄（順位 3）= **字の部分一致にしない**（「京都」で東京都を拾っていた・2026-11-09 レビュー。iOS は 2026-10-07 に直し済み）。
//   - 欄は 国（日本以外）・県・市区町村・つないだ字 を別々に持つ。語が欄で**始まる**、または欄の中に**名前として**入っている（`nameIn`）
//   - 語が**県の読み（ひらがな・2文字以上）・英語名（3文字以上）の前方**なら、その県の名前を地域の欄に当てる（「やまがた」「yamagata」「とう」）
//   当たらない語が1つでもあれば、その行は結果に出さない。
//   詳しい規則と「入力→期待」の表は `docs/spot-list-search.md`（iOS はこの表を通す）
//
// ### 4. 並び順
//   行の順位 = 語ごとに当てたときは各語の順位のうち**いちばん弱い（大きい）もの**（iOS と同じ）。
//   順位の小さい順、同じ順位は渡された順（台帳の順）。語が無いときは並べ替えない（ふだんの並びのまま）。
//   つまり**スポット名の前方一致が先**、名前の部分一致が次、地域だけで当たったものが最後。
//   枚数・人気・評価では並べない。
//
// ### 5. 県の一覧への導線（`matchSpotAreas`）
//   地域（県・「海外」）の名前（前方一致か名前として）・英語名・綴り・読み（前方一致）に**全部の語**が当たる地域を、
//   県の一覧（`/spots/area/<slug>`）への近道として出す。最大 8。
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

/** 県の折りたたみ済みの値。**モジュールで1回だけ作る**（毎キー・全件で折りたたまない） */
const PREFS_FOLDED = PREFECTURES.map((p) => ({
    name: foldSpotText(p.name),
    en: foldSpotText(p.nameEn),
    reading: foldSpotText(PREFECTURE_READING[p.slug]),
}));

/** 読み（かな）の前方一致に使う最小の字数 */
export const PREFECTURE_READING_MIN = 2;
/** 英語名（ローマ字）の前方一致に使う最小の字数。「to」で Tokyo・Tottori・Toyama…を全部引かない */
export const PREFECTURE_LATIN_MIN = 3;

const isLatin = (t: string) => /^[\x00-\x7f]+$/.test(t);

/** 語が県の読み・英語名の前方なら、その県の折りたたみ済みの名前（地域の欄を引くため）。**語ごとに1回** */
function prefectureNamesByReading(term: string): string[] {
    const latin = isLatin(term);
    if (latin ? term.length < PREFECTURE_LATIN_MIN : term.length < PREFECTURE_READING_MIN) return [];
    return PREFS_FOLDED
        .filter((p) => (latin ? p.en.startsWith(term) : p.reading.startsWith(term)))
        .map((p) => p.name);
}

/** 行ごとに1回だけ折りたたんだ欄（毎キーで全件を折りたたまない） */
type Folded = { names: string[]; region: string[] };
const foldedCache = new WeakMap<SpotSearchRow, Folded>();

/**
 * 地域の欄（折りたたみ済み・空は除く）。`g` は「県 市」（海外は「国 市」）を空白でつないだ字なので、
 * **折りたたむ前に**空白で割る。欄 = 各部分＋つないだ字（iOS の `regionFields` と同じ）
 */
function regionFieldsOf(g?: string): string[] {
    const parts = (g ?? "").normalize("NFKC").split(/\s+/).map(foldSpotText).filter(Boolean);
    return parts.length > 1 ? [...parts, parts.join("")] : parts;
}

function foldedOf(row: SpotSearchRow): Folded {
    let f = foldedCache.get(row);
    if (!f) {
        f = {
            names: [row.n, row.e, row.r, ...(row.a ?? [])].map(foldSpotText).filter(Boolean),
            region: regionFieldsOf(row.g),
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

/** 名前の切れ目になる字: 行政区分（iOS の `adminSuffix`） */
const ADMIN_SUFFIX = new Set(["都", "道", "府", "県", "市", "区", "町", "村", "郡"]);
/** 海外の地域名の切れ目（iOS の `regionMarks`） */
const REGION_MARKS = ["州", "地方"];

/**
 * 字 `text` の中に `name` が**名前として**入っているか（iOS `LocationMatch.nameIn` と同じ）。
 * 前が端・行政区分の字・（海外の）「州」「地方」で、後ろが端・行政区分の字・「州」「地方」（または name 自身が行政区分の字で終わる）。
 * 「東京都」の中の「京都」は外れ（前が「東」）、「京都府」の中の「京都」・「足柄下郡箱根町」の中の「箱根」は当たり
 */
export function nameIn(text: string, name: string): boolean {
    if (!name || name.length > text.length) return false;
    const endsWithMark = (upTo: number) => REGION_MARKS.some((m) => m.length <= upTo && text.slice(upTo - m.length, upTo) === m);
    const startsWithMark = (from: number) => REGION_MARKS.some((m) => text.startsWith(m, from));
    for (let k = text.indexOf(name); k >= 0; k = text.indexOf(name, k + 1)) {
        const end = k + name.length;
        const before = k === 0 || ADMIN_SUFFIX.has(text[k - 1]) || endsWithMark(k);
        const after = end === text.length || ADMIN_SUFFIX.has(text[end]) || ADMIN_SUFFIX.has(name[name.length - 1]) || startsWithMark(end);
        if (before && after) return true;
    }
    return false;
}

/** 1語（折りたたみ済み）が地域の欄のどれかに当たるか: 欄が語で始まる、または語が欄の中に名前として入っている */
function regionHit(fields: readonly string[], word: string): boolean {
    return !!word && fields.some((f) => f.startsWith(word) || nameIn(f, word));
}

/** 1回の検索で語ごとに1度だけ作るもの（毎行・毎キーで作り直さない） */
type TermInfo = { term: string; prefNames: string[] };

/** 行の順位。外れなら -1（規則 3・4）。**先に、続けた1語として名前に当てる**（「嵐山 渡月橋」は名前の連続一致を優先） */
function rowRank(row: SpotSearchRow, infos: readonly TermInfo[], joined: string): number {
    const { names, region } = foldedOf(row);
    if (infos.length > 1) {
        const whole = foldedNameRank(names, joined);
        if (whole >= 0) return whole;
    }
    // 語ごと。**いちばん弱い語の順位**（全部の語が当たる必要がある）
    let worst = 0;
    for (const { term, prefNames } of infos) {
        let r = foldedNameRank(names, term);
        if (r < 0 && (regionHit(region, term) || prefNames.some((n) => regionHit(region, n)))) r = 3;
        if (r < 0) return -1;
        worst = Math.max(worst, r);
    }
    return worst;
}

/** 名前の索引（`SpotSearchRow`）を語で絞る。空の入力は `[]`（検索なし）。並びは規則 4 */
export function searchSpotList(rows: readonly SpotSearchRow[], query: string): SpotSearchRow[] {
    const terms = splitSpotTerms(query);
    if (terms.length === 0) return [];
    const infos: TermInfo[] = terms.map((term) => ({ term, prefNames: prefectureNamesByReading(term) }));
    const joined = terms.join("");
    const hits: Array<{ row: SpotSearchRow; rank: number; i: number }> = [];
    rows.forEach((row, i) => {
        const rank = rowRank(row, infos, joined);
        if (rank >= 0) hits.push({ row, rank, i });
    });
    return hits.sort((a, b) => a.rank - b.rank || a.i - b.i).map((h) => h.row);
}

/** 県の一覧への近道に必要な項目（`SpotArea` の部分型） */
export type SpotAreaLike = { slug: string; name: string; nameEn: string; count: number };

/**
 * 地域の名前で当たる県・「海外」（規則 5）。最大 8。
 * 🔴 **字の部分一致にしない**（「京都」で東京都を拾っていた）。名前は 前方一致・または名前として入っている（`nameIn`）、
 * 英語名・綴り・読みは 前方一致（英語は 3 文字以上・読みは 2 文字以上。完全一致は何字でも）
 */
export function matchSpotAreas<T extends SpotAreaLike>(areas: readonly T[], query: string): T[] {
    const terms = splitSpotTerms(query);
    if (terms.length === 0) return [];
    const hits: Array<{ area: T; rank: number; i: number }> = [];
    areas.forEach((area, i) => {
        const name = foldSpotText(area.name);
        const en = [foldSpotText(area.nameEn), foldSpotText(area.slug)];
        const reading = foldSpotText(PREFECTURE_READING[area.slug]);
        let worst = 0;
        for (const t of terms) {
            let r = -1;
            if (name === t) r = 0;
            else if (name.startsWith(t)) r = 1;
            else if (nameIn(name, t)) r = 2;
            else if (en.includes(t)) r = 0;
            else if (isLatin(t) ? t.length >= PREFECTURE_LATIN_MIN && en.some((e) => e.startsWith(t))
                : t.length >= PREFECTURE_READING_MIN && reading.startsWith(t)) r = 1;
            if (r < 0) return;
            worst = Math.max(worst, r);
        }
        hits.push({ area, rank: worst, i });
    });
    return hits.sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, 8).map((h) => h.area);
}
