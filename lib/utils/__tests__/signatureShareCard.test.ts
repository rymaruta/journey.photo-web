import { describe, expect, it } from "vitest";
import { approximateShareCoordinate, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from "../signatureShareCard";

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
