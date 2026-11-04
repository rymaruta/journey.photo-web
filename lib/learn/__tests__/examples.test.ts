import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/data/photos";
import { parseAperture, parseShutter, parseIso, parseFocal, parseSettings, pickExamples } from "../examples";
import { EXAMPLE_RULES, exampleRule, LESSONS } from "@/lib/data/learn/cameraBasics";
import { coverPhotos } from "../covers";

const photo = (id: string, exif: Record<string, unknown>, extra: Partial<Photo> = {}): Photo => ({
    id,
    src: `https://example.com/${id}.jpg`,
    thumbSrc: `https://example.com/${id}-t.webp`,
    published: true,
    createdAt: `2026-01-${id.padStart(2, "0")}`,
    exif,
    ...extra,
} as unknown as Photo);

describe("EXIF の書き方の揺れを数に直す", () => {
    it("F値", () => {
        expect(parseAperture("f/2.8")).toBe(2.8);
        expect(parseAperture("F8")).toBe(8);
        expect(parseAperture("5.6")).toBe(5.6);
        expect(parseAperture("f/0")).toBeUndefined();
        expect(parseAperture("abc")).toBeUndefined();
    });
    it("シャッター（Web は 1/125s、アプリは 1/125）", () => {
        expect(parseShutter("1/1000s")).toBeCloseTo(0.001, 9);
        expect(parseShutter("1/125")).toBeCloseTo(1 / 125, 9);
        expect(parseShutter("30s")).toBe(30);
        expect(parseShutter("0.5")).toBe(0.5);
        expect(parseShutter("2秒")).toBe(2);
        expect(parseShutter("1/0")).toBeUndefined();
    });
    it("ISO と焦点距離", () => {
        expect(parseIso(2000)).toBe(2000);
        expect(parseIso("ISO 100")).toBe(100);
        expect(parseIso("0")).toBeUndefined();
        expect(parseFocal("28mm")).toBe(28);
        expect(parseFocal("7 mm")).toBe(7);
    });
    it("機種は重なったメーカー名を畳む", () => {
        expect(parseSettings({ camera: "Hasselblad Hasselblad X2D II 100C" } as Photo["exif"]).camera).toBe("Hasselblad X2D II 100C");
    });
});

describe("実例の選び方", () => {
    const photos = [
        photo("1", { aperture: "f/1.8", exposure: "1/7000s", iso: 80, focalLength: "7mm", camera: "Apple iPhone 14 Pro" }),
        photo("2", { aperture: "f/18", exposure: "30s", iso: 100 }),
        photo("3", { aperture: "f/7.1", exposure: "1/15s", iso: 2000 }),
        photo("4", { aperture: "f/2.8", exposure: "1/1000s", iso: 100, focalLength: "28mm" }),
        photo("5", { aperture: "f/1.4", exposure: "1/8000s", iso: 100, focalLength: "50mm" }, { published: false }),
        photo("8", { aperture: "f/1.4", exposure: "1/500s", iso: 100, focalLength: "14mm" }),
        photo("6", {}),
    ];

    it("条件を強く満たす順（F値の小さい順）・非公開は出さない", () => {
        expect(pickExamples(photos, exampleRule("wide-aperture")).map((p) => p.id)).toEqual(["4"]);
    });
    it("遅いシャッターは遅い順（30 秒が先）", () => {
        expect(pickExamples(photos, exampleRule("slow-shutter")).map((p) => p.id)).toEqual(["2", "3"]);
    });
    it("速いシャッター・高い ISO・F8 以上・スマホ", () => {
        expect(pickExamples(photos, exampleRule("fast-shutter")).map((p) => p.id)).toEqual(["4"]);
        expect(pickExamples(photos, exampleRule("high-iso")).map((p) => p.id)).toEqual(["3"]);
        expect(pickExamples(photos, exampleRule("narrow-aperture")).map((p) => p.id)).toEqual(["2"]);
        expect(pickExamples(photos, exampleRule("smartphone")).map((p) => p.id)).toEqual(["1"]);
    });
    it("**スマホは F値・シャッター・ISO の実例に出さない**（F値固定・設定はカメラ任せ。iPhone の f/1.8・7mm はぼけない）", () => {
        const phone = photo("20", { aperture: "f/1.8", exposure: "1/2000s", iso: 3200, focalLength: "26mm", camera: "Apple iPhone 15" });
        for (const id of ["wide-aperture", "narrow-aperture", "fast-shutter", "slow-shutter", "high-iso"]) {
            expect(pickExamples([phone], exampleRule(id)), id).toEqual([]);
        }
        expect(pickExamples([phone], exampleRule("smartphone"))).toHaveLength(1);
    });
    it("F値の小さい実例は焦点距離 20mm 以上（広角すぎるとぼけが見えない）", () => {
        expect(pickExamples([photo("8", { aperture: "f/1.4", focalLength: "14mm" })], exampleRule("wide-aperture"))).toEqual([]);
        expect(pickExamples([photo("8", { aperture: "f/1.4", focalLength: "20mm" })], exampleRule("wide-aperture"))).toHaveLength(1);
        expect(pickExamples([photo("8", { aperture: "f/1.4" })], exampleRule("wide-aperture")), "焦点距離が分からない").toEqual([]);
    });
    it("境目の値は見出しの言葉どおり含む（以下・以上・「か、それより」）", () => {
        const at = (exif: Record<string, unknown>, id: string) => pickExamples([photo("30", { focalLength: "50mm", ...exif })], exampleRule(id)).length;
        expect(at({ aperture: "f/2.8" }, "wide-aperture")).toBe(1);
        expect(at({ aperture: "f/3.2" }, "wide-aperture")).toBe(0);
        expect(at({ aperture: "f/8" }, "narrow-aperture")).toBe(1);
        expect(at({ aperture: "f/7.1" }, "narrow-aperture")).toBe(0);
        expect(at({ exposure: "1/1000s" }, "fast-shutter")).toBe(1);
        expect(at({ exposure: "1/800s" }, "fast-shutter")).toBe(0);
        expect(at({ exposure: "1/15s" }, "slow-shutter")).toBe(1);
        expect(at({ exposure: "1/20s" }, "slow-shutter")).toBe(0);
        expect(at({ iso: 1600 }, "high-iso")).toBe(1);
        expect(at({ iso: 1250 }, "high-iso")).toBe(0);
        expect(exampleRule("fast-shutter").heading).toContain("1/1000 秒か、それより速い");
        expect(exampleRule("slow-shutter").heading).toContain("1/15 秒か、それより遅い");
    });
    it("**合う写真が無ければ空**（画面は塊ごと出さない）", () => {
        expect(pickExamples([photo("9", { aperture: "f/5.6", exposure: "1/125s", iso: 100 })], exampleRule("high-iso"))).toEqual([]);
        expect(pickExamples([], exampleRule("wide-aperture"))).toEqual([]);
    });
    it("最大 4 枚", () => {
        const many = Array.from({ length: 9 }, (_, i) => photo(String(i + 10), { aperture: "f/2", focalLength: "50mm" }));
        expect(pickExamples(many, exampleRule("wide-aperture"))).toHaveLength(4);
    });
    it("画像の無い写真は出さない", () => {
        expect(pickExamples([photo("7", { aperture: "f/2" }, { src: undefined, thumbSrc: undefined } as Partial<Photo>)], exampleRule("wide-aperture"))).toEqual([]);
    });
    it("一覧のカードの写真は記事どうしで重ならない", () => {
        const c = coverPhotos(photos);
        const ids = Object.values(c).filter((p) => !!p).map((p) => p!.id);
        expect(ids.length).toBeGreaterThanOrEqual(2);
        expect(new Set(ids).size).toBe(ids.length);
        expect(c["camera-basics"]?.id).toBe("4");
        // どの表紙にもスマホの写真を使わない
        expect(ids).not.toContain("1");
    });
});

describe("レッスンの台帳", () => {
    it("id は重ならず、実例の条件は全部在る", () => {
        expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
        expect(new Set(EXAMPLE_RULES.map((r) => r.id)).size).toBe(EXAMPLE_RULES.length);
        for (const l of LESSONS) for (const id of l.examples ?? []) expect(() => exampleRule(id)).not.toThrow();
    });
    it("表の列の数は見出しとそろう", () => {
        for (const l of LESSONS) {
            if (!l.table) continue;
            for (const r of l.table.rows) expect(r, `${l.id} の表`).toHaveLength(l.table.head.length);
        }
    });
    it("「今日の練習」で A モードの F8 を「暗くなる」と書かない（カメラがシャッターで明るさを保つ）", () => {
        const practice = LESSONS.find((l) => l.id === "practice")!.body.join("");
        expect(practice).not.toMatch(/F8[^。]*暗くな/);
        expect(practice).toContain("明るさはほぼ同じ");
    });
});
