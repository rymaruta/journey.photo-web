import { describe, expect, it } from "vitest";
import {
    approximateShareCoordinate, initialShareCardStyle, SHARE_CARD_FIRST_STYLE, SHARE_CARD_HEIGHT, SHARE_CARD_STYLES,
    SHARE_CARD_WIDTH, shareCardPlace, shareCardRatioLabel, shareCardStyleName,
} from "../signatureShareCard";
import {
    dottedDate, englishMonthYear, instantLayout, isUprightVertical, kanjiYearMonth, rotatesInVertical, takenDate, tateLayout,
} from "../shareCardStyles";
import { neighborStyle } from "../../../app/photo/[id]/ShareCardDialog";

describe("Signature share card iOS parity", () => {
    it("uses exact 1080px iOS output ratios", () => {
        expect(SHARE_CARD_WIDTH).toBe(1080);
        expect(SHARE_CARD_HEIGHT).toEqual({ "4:5": 1350, "9:16": 1920, "1:1": 1080 });
    });
    it("rounds GPS to the same 0.5 degree privacy grid as iOS", () => {
        expect(approximateShareCoordinate({ lat: 35.68, lng: 139.77 })).toEqual({ lat: 35.5, lng: 140 });
        expect(approximateShareCoordinate({ lat: -35.68, lng: -139.77 })).toEqual({ lat: -35.5, lng: -140 });
    });
    it("does not render invalid or non-finite coordinates", () => {
        expect(approximateShareCoordinate()).toBeNull();
        expect(approximateShareCoordinate({ lat: NaN, lng: 10 })).toBeNull();
        expect(approximateShareCoordinate({ lat: 91, lng: 10 })).toBeNull();
        expect(approximateShareCoordinate({ lat: 10, lng: -181 })).toBeNull();
    });
});

// 2026-11-12 デザインの案 第8章: 縦書き・インスタント（iOS の ShareCardMap と同じ寸法）
describe("share card styles (chapter 8)", () => {
    it("offers vertical, instant and band, starting from the last used style", () => {
        expect(SHARE_CARD_STYLES).toEqual(["tate", "instant", "band"]);
        expect(SHARE_CARD_FIRST_STYLE).toBe("tate");
        expect(initialShareCardStyle(null)).toBe("tate");
        expect(initialShareCardStyle("band")).toBe("band");
        // iOS にしか無い型・読めない値は初めてと同じ
        expect(initialShareCardStyle("cover")).toBe("tate");
        expect(initialShareCardStyle("x")).toBe("tate");
        expect(neighborStyle("tate", 1)).toBe("instant");
        expect(neighborStyle("tate", -1)).toBe("band");
        expect(neighborStyle("band", 1)).toBe("tate");
        expect(shareCardStyleName("tate", "ja")).toBe("縦書き");
        expect(shareCardStyleName("instant", "en")).toBe("Instant");
        expect(shareCardRatioLabel("9:16", "ja")).toBe("ストーリー");
        expect(shareCardRatioLabel("4:5", "ja")).toBe("投稿");
    });
    it("reads the taken date from EXIF or the date field", () => {
        expect(takenDate("2026:10:25 14:03:00")).toEqual({ year: 2026, month: 10, day: 25 });
        expect(takenDate("0000:00:00 00:00:00", "2026-01-18")).toEqual({ year: 2026, month: 1, day: 18 });
        expect(takenDate(undefined, undefined)).toBeNull();
        expect(takenDate("", "2026-13-01")).toBeNull();
        expect(dottedDate({ year: 2026, month: 1, day: 8 })).toBe("2026.01.08");
        expect(kanjiYearMonth({ year: 2026, month: 10, day: 25 })).toBe("二〇二六年十月");
        expect(kanjiYearMonth({ year: 2026, month: 11, day: 7 })).toBe("二〇二六年十一月");
        expect(kanjiYearMonth({ year: 2026, month: 1, day: 18 })).toBe("二〇二六年一月");
        expect(englishMonthYear({ year: 2026, month: 5, day: 17 })).toBe("MAY 2026");
    });
    it("stands Japanese upright and turns Latin sideways", () => {
        expect(isUprightVertical("滋賀県")).toBe(true);
        expect(isUprightVertical("Shiga")).toBe(false);
        expect(rotatesInVertical("ー")).toBe(true);
        expect(rotatesInVertical("県")).toBe(false);
    });
    it("splits the place into prefecture and city", () => {
        expect(shareCardPlace("ひろめ市場, 追手筋, 高知市, 高知県, 780-8571, 日本")).toEqual({ big: "高知県", sub: "高知市" });
        expect(shareCardPlace(undefined)).toEqual({ big: "", sub: "" });
    });
    it("keeps the vertical column inside and clear of the story bars", () => {
        for (const ratio of ["4:5", "9:16", "1:1"] as const) {
            const l = tateLayout(ratio);
            expect(l.top).toBe(ratio === "9:16" ? 140 : 0);
            expect(l.height - l.base).toBe(ratio === "9:16" ? 170 : 0);
            expect(l.fittedPlaceSize(4)).toBe(l.placeFontSize);
            const long = l.fittedPlaceSize(10);
            expect(long).toBeGreaterThanOrEqual(72);
            expect(l.placeTop + 10 * long * 1.04 + 28 + l.sealSize).toBeLessThanOrEqual(l.columnBottom);
            expect(l.usernameFontSize * 390 / 1080).toBeCloseTo(10.8, 1);
        }
        expect([tateLayout("4:5").placeFontSize, tateLayout("9:16").placeFontSize, tateLayout("1:1").placeFontSize])
            .toEqual([156, 184, 128]);
    });
    it("keeps the instant paper, text and logo inside the card", () => {
        for (const ratio of ["4:5", "9:16", "1:1"] as const) {
            const l = instantLayout(ratio);
            expect(l.paper.x + l.paper.width / 2).toBe(540);
            expect(l.metaTop + 28 * 1.35).toBeLessThan(l.paper.y + l.paper.height);
            expect(l.photo.x + l.textWidth).toBeLessThanOrEqual(l.map.x);
            expect(l.addressTop + 24 * 1.35).toBeLessThanOrEqual(l.base);
        }
        expect(instantLayout("9:16").photo.height).toBeCloseTo(800 * 4 / 3);
    });
});
