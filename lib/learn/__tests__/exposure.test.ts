import { describe, it, expect } from "vitest";
import {
    APERTURES, SHUTTERS, ISOS, SCENES,
    settingsEv, exposureOffset, roundToThird, autoShutterIndex, offsetText, meterPosition, sceneEffects,
} from "../exposure";

const idx = (list: { label: string }[], label: string) => list.findIndex((s) => s.label === label);

describe("段の並び", () => {
    it("F値・シャッター・ISO はカメラの表示どおりの1段刻み", () => {
        expect(APERTURES.map((a) => a.label)).toEqual(["F1.4", "F2", "F2.8", "F4", "F5.6", "F8", "F11", "F16"]);
        expect(SHUTTERS[0].label).toBe("1/4000秒");
        expect(SHUTTERS[SHUTTERS.length - 1].label).toBe("2秒");
        expect(ISOS.map((i) => i.exact)).toEqual([100, 200, 400, 800, 1600, 3200, 6400]);
    });

    it("隣どうしはどれも**ちょうど1段**（呼び名ではなく本当の値で計算している）", () => {
        for (let i = 1; i < APERTURES.length; i++) {
            expect(Math.log2(APERTURES[i].exact ** 2 / APERTURES[i - 1].exact ** 2)).toBeCloseTo(1, 9);
        }
        for (let i = 1; i < SHUTTERS.length; i++) {
            expect(Math.log2(SHUTTERS[i].exact / SHUTTERS[i - 1].exact)).toBeCloseTo(1, 9);
        }
        for (let i = 1; i < ISOS.length; i++) {
            expect(Math.log2(ISOS[i].exact / ISOS[i - 1].exact)).toBeCloseTo(1, 9);
        }
    });

    it("呼び名と本当の値は近い（F5.6 ≈ 5.66・1/60 ≈ 1/64）", () => {
        expect(APERTURES[idx(APERTURES, "F5.6")].exact).toBeCloseTo(5.657, 2);
        expect(1 / SHUTTERS[idx(SHUTTERS, "1/60秒")].exact).toBe(64);
    });
});

describe("明るさのずれ", () => {
    it("F値を1段絞る（F4 → F5.6）と1段暗くなり、シャッターを1段遅くすると戻る", () => {
        const ev = 12;
        const base = exposureOffset(ev, APERTURES[3].exact, SHUTTERS[5].exact, 100);
        const stoppedDown = exposureOffset(ev, APERTURES[4].exact, SHUTTERS[5].exact, 100);
        const compensated = exposureOffset(ev, APERTURES[4].exact, SHUTTERS[6].exact, 100);
        expect(stoppedDown - base).toBeCloseTo(-1, 9);
        expect(compensated - base).toBeCloseTo(0, 9);
    });

    it("ISO を2倍にすると1段明るくなる", () => {
        const a = exposureOffset(12, 4, 1 / 128, 100);
        const b = exposureOffset(12, 4, 1 / 128, 200);
        expect(b - a).toBeCloseTo(1, 9);
    });

    it("EV の式: F1 で 1秒・ISO 100 は EV 0", () => {
        expect(settingsEv(1, 1, 100)).toBe(0);
    });

    it("1/3 段に丸める（−0 を作らない）", () => {
        expect(roundToThird(0.32)).toBeCloseTo(1 / 3, 9);
        expect(Object.is(roundToThird(-0.01), 0)).toBe(true);
    });

    it("読み方", () => {
        expect(offsetText(0.05)).toBe("ちょうど良い明るさ");
        expect(offsetText(1)).toBe("1段 明るすぎ");
        expect(offsetText(-1 / 3)).toBe("⅓段 暗すぎ");
        expect(offsetText(-5 / 3)).toBe("1⅔段 暗すぎ");
    });

    it("露出計の針は ±3 段で端に止まる", () => {
        expect(meterPosition(0)).toBe(0.5);
        expect(meterPosition(3)).toBe(1);
        expect(meterPosition(10)).toBe(1);
        expect(meterPosition(-10)).toBe(0);
    });
});

describe("A（絞り優先）モードのシャッター", () => {
    const cloudy = SCENES.find((s) => s.id === "cloudy")!.ev;

    it("どの F値でも、範囲の中ならちょうど良い明るさ（±⅓段の内）に合わせる", () => {
        for (const a of APERTURES) {
            const s = autoShutterIndex(cloudy, a.exact, 100);
            const off = exposureOffset(cloudy, a.exact, SHUTTERS[s].exact, 100);
            expect(Math.abs(off)).toBeLessThanOrEqual(0.5);
        }
    });

    it("F値を1段絞ると、カメラはシャッターを1段遅くする（暗くはならない）", () => {
        const at4 = autoShutterIndex(cloudy, APERTURES[3].exact, 100);
        const at56 = autoShutterIndex(cloudy, APERTURES[4].exact, 100);
        expect(at56 - at4).toBe(1);
    });

    it("範囲を超えると端で止まり、ずれが残る（晴れに F1.4・ISO 6400）", () => {
        const sunny = SCENES.find((s) => s.id === "sunny")!.ev;
        const s = autoShutterIndex(sunny, APERTURES[0].exact, 6400);
        expect(s).toBe(0);
        expect(exposureOffset(sunny, APERTURES[0].exact, SHUTTERS[s].exact, 6400)).toBeGreaterThan(3);
    });
});

describe("絵の効き方", () => {
    it("F値が小さいほど背景がぼけ、F16 ではほぼ 0", () => {
        const blur = (a: number) => sceneEffects({ offset: 0, aperture: a, shutterSeconds: 1 / 125, isoIndex: 0, handheld: false }).backgroundBlur;
        expect(blur(1.4)).toBeGreaterThan(blur(4));
        expect(blur(16)).toBe(0);
    });

    it("シャッターが遅いほど動く被写体がぶれ、手持ちは 1/60 秒より遅いと画面全体もぶれる", () => {
        const fx = (t: number, handheld = true) => sceneEffects({ offset: 0, aperture: 4, shutterSeconds: t, isoIndex: 0, handheld });
        expect(fx(1 / 1000).motionBlur).toBeLessThan(1);
        expect(fx(1 / 4).motionBlur).toBeGreaterThan(fx(1 / 30).motionBlur);
        expect(fx(1 / 64).shake).toBe(0);
        expect(fx(1 / 8).shake).toBeGreaterThan(0);
        expect(fx(1 / 8, false).shake).toBe(0);
    });

    it("ISO 100 はざらつき 0、上げるほど濃い", () => {
        const g = (i: number) => sceneEffects({ offset: 0, aperture: 4, shutterSeconds: 1 / 125, isoIndex: i, handheld: false }).grain;
        expect(g(0)).toBe(0);
        expect(g(6)).toBeGreaterThan(g(3));
    });

    it("明るすぎ・暗すぎで明るさが変わり、ちょうど良いときは 1", () => {
        const b = (o: number) => sceneEffects({ offset: o, aperture: 4, shutterSeconds: 1 / 125, isoIndex: 0, handheld: false }).brightness;
        expect(b(0)).toBe(1);
        expect(b(2)).toBeGreaterThan(1);
        expect(b(-2)).toBeLessThan(1);
    });
});
