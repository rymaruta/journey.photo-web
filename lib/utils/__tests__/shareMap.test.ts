import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findShareCountry, unwrapShareRings, type CountryOutline } from "../shareMap";

const mockCountry: CountryOutline = {
    n: "Testland",
    r: [[[139, 35], [141, 35], [141, 37], [139, 37], [139, 35]]],
};

describe("iOS share-card map parity", () => {
    it("bundles the same Natural Earth outline data as the iOS renderer", () => {
        const data = JSON.parse(readFileSync(resolve(process.cwd(), "public/maps/country-outlines.json"), "utf8")) as CountryOutline[];
        expect(data.length).toBeGreaterThan(150);
        expect(data.some(shape => shape.n === "Fiji")).toBe(true);
        expect(data.some(shape => shape.n === "Japan")).toBe(true);
        expect(data.every(shape => Array.isArray(shape.r))).toBe(true);
    });

    it("finds country containing a rounded GPS point, but not distant water", () => {
        expect(findShareCountry([mockCountry], { lat: 35.5, lng: 140 })).toEqual(mockCountry);
        expect(findShareCountry([mockCountry], { lat: 0, lng: 0 })).toBeNull();
        expect(findShareCountry([mockCountry], { lat: NaN, lng: 140 })).toBeNull();
    });

    it("unwraps date-line polygons without 358-degree horizontal segments", () => {
        const shape: CountryOutline = { n: "Fiji", r: [[[179, 0], [-179, 0], [-179, 1], [179, 1]]] };
        const unwrapped = unwrapShareRings(shape, 179.5)[0];
        const span = Math.max(...unwrapped.map(p => p[0])) - Math.min(...unwrapped.map(p => p[0]));
        expect(span).toBe(2);
    });
});
