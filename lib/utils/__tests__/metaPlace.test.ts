import { describe, it, expect } from "vitest";
import { metaPlace, titlePlaceTail, descriptionPlaceTail, placeForSentence } from "../metaPlace";

/**
 * 検索結果・SNS の題と説明に出す撮影地（2026-11-09・Web 入口ページ監査の案A）。
 * 本番の写真ページの実値: 題が「ひろめ市場, 追手筋, 追手筋一丁目, 廿代町, 高知市, 高知県, 780-8571, 日本」だった。
 */
const HIROME = "ひろめ市場, 追手筋, 追手筋一丁目, 廿代町, 高知市, 高知県, 780-8571, 日本";

describe("metaPlace（名前と市区町村だけを取り出す）", () => {
    it("地図の住所（小さい所から並ぶ）は、先頭の名前と市を取る。郵便番号・町名・丁目・国は取らない", () => {
        expect(metaPlace(HIROME)).toEqual({ head: "ひろめ市場", area: "高知市", pref: "高知県" });
    });

    it("市が無く区だけの住所は区", () => {
        expect(metaPlace("新宿御苑, 内藤町, 新宿区, 東京都, 160-0014, 日本")).toEqual({ head: "新宿御苑", area: "新宿区", pref: "東京都" });
    });

    it("町名（廿代町）は拾わない。次が郡か県の町村だけを市区町村と見る", () => {
        expect(metaPlace("ひろめ市場, 廿代町, 追手筋, 高知県, 日本").area).toBe("");
        expect(metaPlace("羊蹄山, ニセコ町, 虻田郡, 北海道, 日本").area).toBe("ニセコ町");
    });

    it("空白区切りの「県 市 場所」は、場所が名前・市が市区町村", () => {
        expect(metaPlace("茨城県 ひたちなか市 国営ひたち海浜公園")).toEqual({ head: "国営ひたち海浜公園", area: "ひたちなか市", pref: "茨城県" });
    });

    it("括弧の中の地域（オペラ・ガルニエ（パリ））は市区町村にする", () => {
        expect(metaPlace("オペラ・ガルニエ（パリ）")).toEqual({ head: "オペラ・ガルニエ", area: "パリ", pref: "" });
    });

    it("1語・国付きだけ・空は、名前だけ（市区町村なし）", () => {
        expect(metaPlace("山中湖")).toEqual({ head: "山中湖", area: "", pref: "" });
        expect(metaPlace("板橋区, 日本")).toEqual({ head: "板橋区", area: "", pref: "" });
        expect(metaPlace("")).toEqual({ head: "", area: "", pref: "" });
        expect(metaPlace(undefined)).toEqual({ head: "", area: "", pref: "" });
    });
});

describe("名前が切れ端のとき・県を添えるとき", () => {
    it("番地だけ・郵便番号・丁目の名前は飛ばして次のトークン。全部だめなら空", () => {
        expect(metaPlace("3, 丸の内一丁目, 千代田区, 東京都, 100-0005, 日本").head).toBe("千代田区");
        expect(metaPlace("100-0005, 1-2-3, 日本").head).toBe("");
    });
    it("名前が市区町村そのもの（自動入力の「渋谷区, 東京都, 日本」）は県を添える", () => {
        const p = metaPlace("渋谷区, 東京都, 日本");
        expect(titlePlaceTail("夜景", p)).toBe("渋谷区（東京都）");
        expect(titlePlaceTail("渋谷区の夜", p)).toBe("東京都");
        expect(placeForSentence(p)).toBe("渋谷区（東京都）");
    });
    it("名前に「・」が入っていても、区切りの「、」と取り違えない", () => {
        const p = metaPlace("オペラ・ガルニエ, パリ, フランス");
        expect(descriptionPlaceTail("朝。", p)).toBe("オペラ・ガルニエ、パリ");
    });
});

describe("題の後ろに足す撮影地", () => {
    const p = metaPlace(HIROME);
    it("題が名前を含めば市区町村だけ（本番の「ひろめ市場」の回）", () => {
        expect(titlePlaceTail("ひろめ市場", p)).toBe("高知市");
    });
    it("含まなければ「名前（市区町村）」", () => {
        expect(titlePlaceTail("カツオの塔", p)).toBe("ひろめ市場（高知市）");
    });
    it("題に市区町村まで入っていれば足さない", () => {
        expect(titlePlaceTail("ひろめ市場の夜（高知市）", p)).toBe("");
    });
    it("住所の断片（郵便番号・丁目・国）は、どの形でも出ない", () => {
        for (const t of ["ひろめ市場", "カツオの塔", "x"]) {
            expect(titlePlaceTail(t, p)).not.toMatch(/780|追手筋|廿代町|日本/);
        }
    });
});

describe("説明の後ろに足す撮影地", () => {
    const p = metaPlace(HIROME);
    it("説明に名前が入っていれば「県市」だけ", () => {
        expect(descriptionPlaceTail("ひろめ市場に来た。", p)).toBe("高知県高知市");
    });
    it("入っていなければ「名前・県市」", () => {
        expect(descriptionPlaceTail("炙りカツオを食べた。", p)).toBe("ひろめ市場、高知県高知市");
    });
    it("県しか分からないときは県", () => {
        expect(descriptionPlaceTail("朝。", metaPlace("山中湖, 山梨県, 日本"))).toBe("山中湖、山梨県");
    });
    it("組み立てる文の撮影地は「名前（市区町村）」", () => {
        expect(placeForSentence(p)).toBe("ひろめ市場（高知市）");
        expect(placeForSentence(metaPlace("パリ"))).toBe("パリ");
    });
});
