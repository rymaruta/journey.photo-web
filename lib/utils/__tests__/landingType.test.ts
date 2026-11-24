import { describe, it, expect, beforeEach } from "vitest";
import { landingTypeOf, recordLanding, getLandingType, LANDING_STORAGE_KEY } from "../landingType";

describe("landingTypeOf（頁の種類）", () => {
    it.each([
        ["/", "home"],
        ["/learn", "learn"],
        ["/learn/", "learn"],
        ["/learn/camera-basics", "learn"],
        ["/learn/camera-brands/", "learn"],
        ["/composition", "composition"],
        ["/spots", "spot"],
        ["/spots/hanauma-bay", "spot"],
        ["/spots/area/okinawa", "spot"],
        ["/spots/theme/waterfall/okinawa", "spot"],
        ["/spots/season/spring", "spot"],
        ["/photo/abc123", "photo"],
        ["/photo/abc123.html", "photo"],
        ["/location/Tokyo", "location"],
        ["/tag/sunset", "tag"],
        ["/category/landscape", "category"],
        ["/signup", "other"],
        ["/login", "other"],
        ["/map", "other"],
        ["/users/abc", "other"],
        ["/learning", "other"],
        ["/photography", "other"],
        ["/spotsx", "other"],
        ["", "other"],
        ["learn", "other"],
    ] as const)("%s → %s", (path, expected) => {
        expect(landingTypeOf(path)).toBe(expected);
    });

    it("ホームの ?photo= は写真（静的ページが無い新着写真の落ち先）", () => {
        expect(landingTypeOf("/", "?photo=abc")).toBe("photo");
        expect(landingTypeOf("/", "?other=1")).toBe("home");
        expect(landingTypeOf("/learn", "?photo=abc")).toBe("learn");
    });

    it("文字列でない入力は other", () => {
        expect(landingTypeOf(undefined)).toBe("other");
        expect(landingTypeOf(null)).toBe("other");
    });
});

describe("最初の着地の記録", () => {
    beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, "", "/"); });

    it("最初の1回だけ書く。頁を移っても変わらない", () => {
        window.history.replaceState({}, "", "/learn/camera-basics");
        recordLanding();
        window.history.replaceState({}, "", "/spots/hanauma-bay");
        recordLanding();
        expect(sessionStorage.getItem(LANDING_STORAGE_KEY)).toBe("learn");
        expect(getLandingType()).toBe("learn");
    });

    it("書いたのは種類の語だけ（URL・slug は入らない）", () => {
        window.history.replaceState({}, "", "/spots/hanauma-bay?email=a@example.com");
        recordLanding();
        expect(sessionStorage.getItem(LANDING_STORAGE_KEY)).toBe("spot");
        expect(JSON.stringify(Object.entries(sessionStorage))).not.toMatch(/hanauma|example/);
    });

    it("まだ書いていないうちに読まれたら、いまの頁を最初の着地にする", () => {
        window.history.replaceState({}, "", "/signup");
        expect(getLandingType()).toBe("other");
        window.history.replaceState({}, "", "/learn");
        expect(getLandingType()).toBe("other");   // 最初の着地は /signup のまま
    });

    it("壊れた値は other。上書きしない", () => {
        sessionStorage.setItem(LANDING_STORAGE_KEY, "https://evil.example/?a=1");
        recordLanding();
        expect(getLandingType()).toBe("other");
        expect(sessionStorage.getItem(LANDING_STORAGE_KEY)).toBe("https://evil.example/?a=1");
    });

    it("ストレージが使えなければ other（例外を出さない）", () => {
        const orig = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
        Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("denied"); } });
        try {
            expect(() => recordLanding()).not.toThrow();
            expect(getLandingType()).toBe("other");
        } finally {
            Object.defineProperty(window, "sessionStorage", orig);
        }
    });
});
