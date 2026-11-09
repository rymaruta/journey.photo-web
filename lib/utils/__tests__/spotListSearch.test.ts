import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../../data/spots";
import { buildSpotSearchRows } from "../../data/spotSearchFeed";
import { spotAreas } from "../../data/spotLink";
import { PREFECTURES } from "../../data/prefectures";
import type { SpotSearchRow } from "../spots";
import {
    nameIn, foldSpotText, splitSpotTerms, searchSpotList, matchSpotAreas, prefectureReading, SPOT_LIST_MAX_TERMS,
} from "../spotListSearch";

/**
 * **撮影スポット一覧の検索窓の規則**（2026-11-09・`docs/spot-list-search.md`）。iOS はこの規則に合わせるので、
 * 規則の1つ1つを値で固定する。直しを戻すと落ちる。
 */
const ROWS: SpotSearchRow[] = [
    { s: "ginzan-onsen", n: "銀山温泉", e: "Ginzan Onsen", r: "ぎんざんおんせん", g: "山形県 尾花沢市" },
    { s: "zao-okama", n: "蔵王のお釜", r: "ざおうのおかま", a: ["御釜"], g: "山形県 山形市" },
    { s: "yamadera", n: "山寺", r: "やまでら", g: "山形県 山形市" },
    { s: "kiyomizu", n: "清水寺", e: "Kiyomizu-dera", r: "きよみずでら", g: "京都府 京都市" },
    { s: "opera-garnier", n: "オペラ・ガルニエ", g: "フランス パリ" },
    { s: "yamashina", n: "山科の景色", g: "京都府 京都市" },
    { s: "mt-fuji", n: "Mt.Fuji 展望台", g: "静岡県 富士市" },
    { s: "tokyo-tower", n: "東京タワー", g: "東京都 港区" },
    { s: "kokyo", n: "皇居外苑", g: "東京都 千代田区" },
    { s: "hakone", n: "芦ノ湖", g: "神奈川県 足柄下郡箱根町" },
];
const slugs = (q: string) => searchSpotList(ROWS, q).map((r) => r.s);

describe("正規化（foldSpotText）", () => {
    it("カタカナ→ひらがな・全角半角・大文字小文字・空白と中黒を同じにする", () => {
        expect(foldSpotText("ギンザン")).toBe("ぎんざん");
        expect(foldSpotText("ｷﾞﾝｻﾞﾝ")).toBe("ぎんざん");   // 半角カナ
        expect(foldSpotText("ＧＩＮＺＡＮ　Ｏｎｓｅｎ")).toBe("ginzanonsen"); // 全角英数と全角空白
        expect(foldSpotText("オペラ・ガルニエ")).toBe(foldSpotText("おぺらがるにえ"));
        expect(foldSpotText("Mt.Fuji")).toBe("mtfuji");
        expect(foldSpotText(undefined)).toBe("");
    });

    it("長音は残す（別の語と混ざらない）", () => {
        expect(foldSpotText("ラーメン")).toBe("らーめん");
        expect(foldSpotText("らめん")).not.toBe(foldSpotText("ラーメン"));
    });
});

describe("語の分け方（splitSpotTerms）", () => {
    it("全角空白・連続する空白で分け、空は捨てる", () => {
        expect(splitSpotTerms("  山形　銀山  ")).toEqual(["山形", "銀山"]);
        expect(splitSpotTerms("   ")).toEqual([]);
        expect(splitSpotTerms("")).toEqual([]);
    });
    it("語は最大 6 つ", () => {
        expect(splitSpotTerms("a b c d e f g h")).toHaveLength(SPOT_LIST_MAX_TERMS);
    });
});

describe("絞り込み（searchSpotList）", () => {
    it("空・空白だけは検索なし（0件を返す）", () => {
        expect(slugs("")).toEqual([]);
        expect(slugs("　 ")).toEqual([]);
    });

    it("ひらがな・カタカナ・半角カナ・英字（大文字小文字）のどれでも同じスポットに当たる", () => {
        expect(slugs("ぎんざん")).toEqual(["ginzan-onsen"]);
        expect(slugs("ギンザン")).toEqual(["ginzan-onsen"]);
        expect(slugs("ｷﾞﾝｻﾞﾝ")).toEqual(["ginzan-onsen"]);
        expect(slugs("GINZAN")).toEqual(["ginzan-onsen"]);
        expect(slugs("ＧＩＮＺＡＮ")).toEqual(["ginzan-onsen"]);
    });

    it("部分一致（名前の途中・別名）", () => {
        expect(slugs("温泉")).toEqual(["ginzan-onsen"]);
        expect(slugs("御釜")).toEqual(["zao-okama"]);       // 別名
        expect(slugs("がるにえ")).toEqual(["opera-garnier"]); // カタカナ名をひらがなで
    });

    it("県名・市区町村名でも当たる（地域の欄）", () => {
        expect(slugs("尾花沢")).toEqual(["ginzan-onsen"]);
        expect(slugs("京都市")).toEqual(["kiyomizu", "yamashina"]);
        expect(slugs("フランス")).toEqual(["opera-garnier"]);
    });

    it("県の読み・英語名（前方・2文字以上）で、その県のスポットが出る", () => {
        expect(slugs("やまがた")).toEqual(["ginzan-onsen", "zao-okama", "yamadera"]);
        expect(slugs("Yamagata")).toEqual(["ginzan-onsen", "zao-okama", "yamadera"]);
        expect(slugs("きょうと")).toEqual(["kiyomizu", "yamashina"]);
        // 1文字では読みから県を引かない（「や」で山形の全部を引かない。名前の読みに「や」がある山寺だけ）
        expect(slugs("や")).toEqual(["yamadera"]);
    });

    it("🔴 地域は前方一致か「名前として」だけ。「京都」で東京都を拾わない（iOS 2026-10-07 の不具合と同じ規則）", () => {
        expect(slugs("京都")).toEqual(["kiyomizu", "yamashina"]);       // 東京都の2件は出ない
        expect(slugs("京都府")).toEqual(["kiyomizu", "yamashina"]);
        expect(slugs("東京")).toEqual(["tokyo-tower", "kokyo"]);        // 東京都は前方一致で当たる
        expect(slugs("千代田")).toEqual(["kokyo"]);
        expect(slugs("箱根")).toEqual(["hakone"]);                      // 足柄下郡「箱根」町: 名前として入っている
        expect(slugs("柄下")).toEqual([]);                              // 名前の途中（前が「足」）は外れ
        expect(slugs("京都 東京")).toEqual([]);
    });

    it("県の読み: 「とう」で東京都（2文字以上）。英語は 3 文字以上（「to」では引かない・「tok」で引く）", () => {
        expect(slugs("とう")).toEqual(["tokyo-tower", "kokyo"]);
        expect(slugs("とうきょう")).toEqual(["tokyo-tower", "kokyo"]);
        expect(slugs("to")).toEqual([]);
        expect(slugs("tok")).toEqual(["tokyo-tower", "kokyo"]);
    });

    it("複数の語は AND（全部が当たる行だけ）", () => {
        expect(slugs("山形 温泉")).toEqual(["ginzan-onsen"]);
        expect(slugs("山形　ぎんざん")).toEqual(["ginzan-onsen"]);
        expect(slugs("山形 京都")).toEqual([]);
        expect(slugs("ginzan 山形 おんせん")).toEqual(["ginzan-onsen"]);
    });

    it("スポット名の前方一致が先・名前の部分一致・地域だけ、の順（同じ順位は索引の順）", () => {
        // 「山」: 前方 = 山寺・山科の景色（索引の順）、部分 = 銀山温泉、蔵王のお釜は名前に無く地域（山形）で最後
        expect(slugs("山")).toEqual(["yamadera", "yamashina", "ginzan-onsen", "zao-okama"]);
        // 完全一致は前方一致より先
        expect(slugs("山寺")).toEqual(["yamadera"]);
        const rows: SpotSearchRow[] = [
            { s: "b", n: "海の山" }, { s: "a", n: "山" }, { s: "c", n: "山の海" },
        ];
        expect(searchSpotList(rows, "山").map((r) => r.s)).toEqual(["a", "c", "b"]);
    });

    it("複数語の順位は、いちばん弱い語の順位（iOS と同じ）", () => {
        const rows: SpotSearchRow[] = [
            { s: "weak", n: "山形駅の夕景", g: "山形県 山形市" },       // 「山形」前方 1・「夕景」部分 2 → 2
            { s: "strong", n: "夕景の山形駅", g: "山形県 山形市" },     // 「夕景」前方 1・「山形」部分 2 → 2
            { s: "region", n: "夕景", g: "山形県 山形市" },             // 「夕景」完全 0・「山形」地域 3 → 3
        ];
        expect(searchSpotList(rows, "山形 夕景").map((r) => r.s)).toEqual(["weak", "strong", "region"]);
    });

    it("先に続けた1語として名前に当てる（「嵐山 渡月橋」は名前の連続一致が先）。外れたら語ごと", () => {
        const rows: SpotSearchRow[] = [
            { s: "split", n: "渡月橋と嵐山", g: "京都府 京都市" },          // 連続では当たらない・語ごとなら 嵐山=部分2 渡月橋=前方1 → 2
            { s: "exact", n: "嵐山 渡月橋", g: "京都府 京都市" },           // 連続一致（完全）→ 0
            { s: "prefix", n: "嵐山渡月橋の夕景", g: "京都府 京都市" },     // 連続の前方 → 1
        ];
        expect(searchSpotList(rows, "嵐山 渡月橋").map((r) => r.s)).toEqual(["exact", "prefix", "split"]);
    });

    it("読点でも語に分ける", () => {
        expect(splitSpotTerms("山形、温泉,銀山")).toEqual(["山形", "温泉", "銀山"]);
        expect(slugs("山形、温泉")).toEqual(["ginzan-onsen"]);
    });

    it("当たらない語は 0件", () => {
        expect(slugs("存在しないばしょ")).toEqual([]);
    });

    it("実際の台帳: 銀山温泉が、ひらがな・カタカナ・英字・県名のどれでも先頭付近に出る", () => {
        const rows = buildSpotSearchRows(rawLedger as unknown as Spot[]);
        for (const q of ["銀山温泉", "ぎんざんおんせん", "ギンザンオンセン", "ginzan"]) {
            expect(searchSpotList(rows, q).map((r) => r.s), q).toContain("ginzan-onsen");
        }
        const pref = searchSpotList(rows, "やまがた");
        expect(pref.length).toBeGreaterThan(0);
        for (const r of pref) expect(r.g ?? "", r.s).toContain("山形県");
    });
});

describe("県の一覧への近道（matchSpotAreas）", () => {
    const AREAS = [
        { slug: "yamagata", name: "山形県", nameEn: "Yamagata", count: 3 },
        { slug: "yamanashi", name: "山梨県", nameEn: "Yamanashi", count: 2 },
        { slug: "kyoto", name: "京都府", nameEn: "Kyoto", count: 5 },
        { slug: "tokyo", name: "東京都", nameEn: "Tokyo", count: 6 },
        { slug: "overseas", name: "海外", nameEn: "Outside Japan", count: 4 },
    ];
    it("名前・英語名・読み・綴りで当たる（ひらがな・カタカナも同じ）", () => {
        expect(matchSpotAreas(AREAS, "山形").map((a) => a.slug)).toEqual(["yamagata"]);
        expect(matchSpotAreas(AREAS, "やまがた").map((a) => a.slug)).toEqual(["yamagata"]);
        expect(matchSpotAreas(AREAS, "ヤマガタ").map((a) => a.slug)).toEqual(["yamagata"]);
        expect(matchSpotAreas(AREAS, "kyoto").map((a) => a.slug)).toEqual(["kyoto"]);
        expect(matchSpotAreas(AREAS, "かいがい").map((a) => a.slug)).toEqual(["overseas"]);
    });
    it("名前の前方一致が先・語は AND・空は何も返さない", () => {
        expect(matchSpotAreas(AREAS, "やま").map((a) => a.slug)).toEqual(["yamagata", "yamanashi"]);
        expect(matchSpotAreas(AREAS, "山形 yamagata").map((a) => a.slug)).toEqual(["yamagata"]);
        expect(matchSpotAreas(AREAS, "")).toEqual([]);
        expect(matchSpotAreas(AREAS, "大阪")).toEqual([]);
    });
    it("🔴 「京都」で東京都を出さない。「とう」は東京都・英語は 3 文字以上", () => {
        expect(matchSpotAreas(AREAS, "京都").map((a) => a.slug)).toEqual(["kyoto"]);
        expect(matchSpotAreas(AREAS, "東京").map((a) => a.slug)).toEqual(["tokyo"]);
        expect(matchSpotAreas(AREAS, "とう").map((a) => a.slug)).toEqual(["tokyo"]);
        expect(matchSpotAreas(AREAS, "to")).toEqual([]);
        expect(matchSpotAreas(AREAS, "tok").map((a) => a.slug)).toEqual(["tokyo"]);
    });
    it("最大 8 つ", () => {
        const many = PREFECTURES.map((p) => ({ slug: p.slug, name: p.name, nameEn: p.nameEn, count: 1 }));
        expect(matchSpotAreas(many, "県").length).toBeLessThanOrEqual(8);
    });
});

describe("県の読みの表", () => {
    it("47 都道府県と海外の全部に読みがあり、ひらがなだけでできている", () => {
        for (const p of PREFECTURES) {
            expect(prefectureReading(p.slug), p.slug).toMatch(/^[ぁ-ゖー]+$/);
        }
        expect(prefectureReading("overseas")).toBe("かいがい");
    });
    it("台帳の全地域（spotAreas）に読みがある", () => {
        for (const a of spotAreas()) expect(prefectureReading(a.slug), a.slug).not.toBe("");
    });
});

describe("名前として入っているか（nameIn・iOS の LocationMatch.nameIn と同じ）", () => {
    it("前後が端か行政区分の字（都道府県市区町村郡）。「東京都」の中の「京都」は外れ", () => {
        expect(nameIn("東京都", "京都")).toBe(false);
        expect(nameIn("京都府", "京都")).toBe(true);
        expect(nameIn("足柄下郡箱根町", "箱根")).toBe(true);
        expect(nameIn("京都市東山区", "東山")).toBe(true);
        expect(nameIn("東京都中央区", "京都")).toBe(false);
    });
    it("海外の「州」「地方」も切れ目", () => {
        expect(nameIn("ふらんす地方ぷろばんす", "ぷろばんす")).toBe(true);
        expect(nameIn("とすかーな州ふぃれんつぇ", "ふぃれんつぇ")).toBe(true);
        expect(nameIn("とすかーな州ふぃれんつぇ", "すかー")).toBe(false);
    });
});
