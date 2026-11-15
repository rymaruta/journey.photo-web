import { describe, it, expect } from "vitest";
import { nextBarHidden, hidesBarOnScroll, BAR_SHOW_TOP } from "@/app/components/BottomNav";
import { shortPlaceLine } from "@/lib/utils/metaPlace";

// 2026-11-15（札 journey.photo-ios#625）: 写真の頁（スマホ）は、下へ送ると下の帯を隠し、上へ戻すと出す
describe("下の帯を送ると隠す", () => {
    it("写真の頁だけ", () => {
        expect(hidesBarOnScroll("/photo/abc")).toBe(true);
        expect(hidesBarOnScroll("/")).toBe(false);
        expect(hidesBarOnScroll("/spots/x")).toBe(false);
        expect(hidesBarOnScroll("/users/u1")).toBe(false);
    });
    it("下へ送ると隠し、上へ戻すと出す", () => {
        expect(nextBarHidden(200, 260, false)).toBe(true);
        expect(nextBarHidden(260, 240, true)).toBe(false);
    });
    it("小さな揺れでは今のまま", () => {
        expect(nextBarHidden(200, 203, false)).toBe(false);
        expect(nextBarHidden(200, 197, true)).toBe(true);
    });
    it("頁の上の方では必ず出す", () => {
        expect(nextBarHidden(0, BAR_SHOW_TOP - 1, true)).toBe(false);
        expect(nextBarHidden(0, BAR_SHOW_TOP + 40, false)).toBe(true);
    });
});

describe("写真の裾の撮影地の1行", () => {
    it("名前と市区町村だけ（住所の全文・国は出さない）", () => {
        expect(shortPlaceLine("国営昭和記念公園, 立川市, 東京, 日本")).toBe("国営昭和記念公園、立川市");
        expect(shortPlaceLine("ひろめ市場, 追手筋, 追手筋一丁目, 廿代町, 高知市, 高知県, 780-8571, 日本")).toBe("ひろめ市場、高知市");
        expect(shortPlaceLine("香川県 観音寺市 高屋神社")).toBe("高屋神社、観音寺市");
    });
    it("切れない名前はそのまま・空は空", () => {
        expect(shortPlaceLine("山中湖")).toBe("山中湖");
        expect(shortPlaceLine("")).toBe("");
        expect(shortPlaceLine(undefined)).toBe("");
    });
    it("中黒を使わない", () => {
        expect(shortPlaceLine("国営昭和記念公園, 立川市, 東京, 日本")).not.toMatch(/[·・]/);
    });
});
