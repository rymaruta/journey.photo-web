import { describe, it, expect } from "vitest";
import {
    APP_TOP_BANNER_CLOSED_KEY, canInstallAppUA, isIPhoneUA, readTopBannerClosed, shouldShowAppTopBanner, writeTopBannerClosed,
} from "../appBanner";
import { UA } from "./appBannerUA";

// 2026-11-20 owner 判断（札 journey.photo-ios#666）: Apple の帯が出ない iPhone のブラウザにだけ、自前の帯を出す

const show = (userAgent: string, extra: Partial<{ standalone: boolean; closed: boolean; maxTouchPoints: number }> = {}) =>
    shouldShowAppTopBanner({ userAgent, standalone: false, closed: false, maxTouchPoints: 5, ...extra });

describe("shouldShowAppTopBanner（上の帯を出すか）", () => {
    it.each([
        ["iOS の Chrome", UA.chrome],
        ["iOS の Firefox", UA.firefox],
        ["iOS の Edge", UA.edge],
        ["LINE の中のブラウザ", UA.line],
        ["Instagram の中のブラウザ", UA.instagram],
        ["Facebook の中のブラウザ", UA.facebook],
        ["X の中のブラウザ", UA.x],
        ["DuckDuckGo（Safari と同じ形の UA）", UA.ddg],
    ])("出す: %s", (_name, ua) => {
        expect(show(ua)).toBe(true);
    });

    it.each([
        ["iPhone の Safari（Apple の帯が出る）", UA.safari, 5],
        ["iPad の Safari", UA.ipadSafari, 5],
        ["iPad の Chrome（アプリは iPhone 用）", UA.ipadChrome, 5],
        ["Mac を名乗る iPad", UA.macSafari, 5],
        ["Mac", UA.macSafari, 0],
        ["PC", UA.pcChrome, 0],
        ["Android", UA.android, 5],
        ["Android の LINE", UA.androidLine, 5],
        ["自分のアプリの中（UA の印）", UA.ownApp, 5],
        ["アプリの入らない iOS 16 の Chrome", UA.chromeIOS16, 5],
    ])("出さない: %s", (_name, ua, touch) => {
        expect(show(ua, { maxTouchPoints: touch })).toBe(false);
    });

    it("ホーム画面から開いた全画面と、この訪問で × を押した後は出さない", () => {
        expect(show(UA.chrome, { standalone: true })).toBe(false);
        expect(show(UA.chrome, { closed: true })).toBe(false);
    });
});

describe("isIPhoneUA（ヘッダーの「アプリ」）", () => {
    it("iPhone なら Safari にも出す。iPad・Mac・PC・Android には出さない", () => {
        expect(isIPhoneUA(UA.safari)).toBe(true);
        expect(isIPhoneUA(UA.chrome)).toBe(true);
        expect(isIPhoneUA(UA.line)).toBe(true);
        for (const ua of [UA.ipadSafari, UA.macSafari, UA.pcChrome, UA.android]) expect(isIPhoneUA(ua)).toBe(false);
    });
});

describe("× の覚え方（その訪問の間だけ）", () => {
    it("書いたら読める。鍵は1つ", () => {
        const store = new Map<string, string>();
        const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
        expect(readTopBannerClosed(s)).toBe(false);
        writeTopBannerClosed(s);
        expect(readTopBannerClosed(s)).toBe(true);
        expect([...store.keys()]).toEqual([APP_TOP_BANNER_CLOSED_KEY]);
    });

    it("読めない・書けないときは投げず、「押していない」（毎回出してよい）", () => {
        const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
        expect(readTopBannerClosed(broken)).toBe(false);
        expect(() => writeTopBannerClosed(broken)).not.toThrow();
        expect(readTopBannerClosed(undefined)).toBe(false);
    });
});

describe("canInstallAppUA（アプリを入れられる iPhone か・iOS 17 以上）", () => {
    it("iOS 17 以上の iPhone は true、iOS 15・16 と iPhone でない端末は false。版が読めなければ true", () => {
        expect(canInstallAppUA(UA.safari)).toBe(true);
        expect(canInstallAppUA(UA.instagram)).toBe(true);
        expect(canInstallAppUA(UA.chromeIOS16)).toBe(false);
        expect(canInstallAppUA(UA.safariIOS15)).toBe(false);
        expect(canInstallAppUA(UA.ipadSafari)).toBe(false);
        expect(canInstallAppUA("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148")).toBe(true);
    });
});
