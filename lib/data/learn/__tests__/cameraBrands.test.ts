import { describe, it, expect } from "vitest";
import { BRANDS, USE_CASES, BUYING_CHECKLIST, brandOfCamera } from "../cameraBrands";
import { LEARN_ARTICLES } from "../articles";

describe("メーカーの台帳", () => {
    it("id は重ならず、頁内リンクに使える形（英小文字）", () => {
        expect(new Set(BRANDS.map((b) => b.id)).size).toBe(BRANDS.length);
        for (const b of BRANDS) expect(b.id).toMatch(/^[a-z]+$/);
    });

    it("公式サイトは https。2026-11-04 に開けた URL（404・転送だった旧 URL に戻さない）", () => {
        for (const b of BRANDS) expect(new URL(b.official).protocol).toBe("https:");
        const urls = BRANDS.map((b) => b.official);
        expect(urls).not.toContain("https://explore.omsystem.com/jp/ja/");
        expect(urls).not.toContain("https://www.nikon-image.com/products/");
        expect(BRANDS.find((b) => b.id === "omsystem")!.official).toBe("https://jp.omsystem.com/");
        expect(BRANDS.find((b) => b.id === "nikon")!.official).toBe("https://nij.nikon.com/products/");
    });

    it("どのメーカーも、マウント・センサー・向く人・気をつけたい点を持つ", () => {
        for (const b of BRANDS) {
            for (const k of ["mounts", "sensors", "forWhom", "caution", "detail", "character", "series"] as const) {
                expect(b[k].trim().length, `${b.id}.${k}`).toBeGreaterThan(0);
            }
        }
    });

    it("このサイトの機種名からメーカーを当てる（大文字小文字を問わない）", () => {
        expect(brandOfCamera("SONY ILCE-7M3")?.id).toBe("sony");
        expect(brandOfCamera("Hasselblad X2D II 100C")?.id).toBe("hasselblad");
        expect(brandOfCamera("OLYMPUS E-M1")?.id).toBe("omsystem");
        expect(brandOfCamera("PENTAX K-1")?.id).toBe("ricoh");
        expect(brandOfCamera("Apple iPhone 14 Pro")).toBeUndefined();
        expect(brandOfCamera(undefined)).toBeUndefined();
    });

    it("用途・買う前の確認は空でない", () => {
        expect(USE_CASES.length).toBeGreaterThanOrEqual(5);
        expect(BUYING_CHECKLIST).toHaveLength(5);
    });
});

describe("記事の台帳", () => {
    it("既存の3本（入門・メーカー・構図）が台帳にあり、構図は既存の /composition。順は教科書の順", () => {
        const hrefs = LEARN_ARTICLES.map((a) => a.href);
        expect(hrefs).toEqual(expect.arrayContaining(["/learn/camera-basics", "/learn/camera-brands", "/composition"]));
        expect(hrefs[0]).toBe("/learn/camera-basics");
        expect(new Set(hrefs).size).toBe(hrefs.length);
    });
});
