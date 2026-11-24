import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { default: OpenInAppButton, appOpenHref, isIPhone } = await import("../OpenInAppButton");

// 「アプリで保存」（2026-11-18・札 journey.photo-ios#545）。iPhone で見ている人だけ。
// 押した先は「もう一方の本番のホスト」の同じ頁（同じドメインの中のリンクは Safari がアプリで開かないため）
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const STORE = "https://apps.apple.com/jp/app/id6814335283";

const gtag = vi.fn();
let uaSpy: ReturnType<typeof vi.spyOn> | null = null;
const setUA = (ua: string) => { uaSpy = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua); };

beforeEach(() => {
    gtag.mockReset();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
    window.history.replaceState(null, "", "/spots/abukumado");
});
afterEach(() => { uaSpy?.mockRestore(); uaSpy = null; vi.restoreAllMocks(); });

describe("appOpenHref", () => {
    it("journey-photo.com から見ていれば www へ、www からなら journey-photo.com へ（同じ頁に ?app=save）", () => {
        expect(appOpenHref("journey-photo.com", "abukumado")).toBe("https://www.journey-photo.com/spots/abukumado?app=save");
        expect(appOpenHref("www.journey-photo.com", "abukumado")).toBe("https://journey-photo.com/spots/abukumado?app=save");
    });
    it("本番のホストでなければ（staging・手元）App Store へ直に", () => {
        expect(appOpenHref("localhost", "abukumado")).toBe(STORE);
        expect(appOpenHref("d15fn3rcaiymu9.cloudfront.net", "abukumado")).toBe(STORE);
    });
    it("slug は URL に安全な形にする", () => {
        expect(appOpenHref("journey-photo.com", "a b")).toBe("https://www.journey-photo.com/spots/a%20b?app=save");
    });
});

describe("isIPhone", () => {
    it("iPhone だけ（iPad・Mac・Android は違う）", () => {
        expect(isIPhone(IPHONE)).toBe(true);
        for (const ua of [IPAD, MAC, ANDROID]) expect(isIPhone(ua), ua).toBe(false);
    });
});

describe("OpenInAppButton", () => {
    it("iPhone には「アプリで保存」を出し、押すと spot_open_app を1回送る", () => {
        setUA(IPHONE);
        render(<OpenInAppButton slug="abukumado" isJa />);
        const link = screen.getByRole("link", { name: "アプリで保存" });
        // jsdom のホストは localhost＝本番でないので App Store へ直に
        expect(link.getAttribute("href")).toBe(STORE);
        link.addEventListener("click", (e) => e.preventDefault());
        link.click();
        expect(gtag.mock.calls.filter((c) => c[1] === "app_store_click").map((c) => c[2]))
            .toEqual([expect.objectContaining({ placement: "spot_open_app" })]);
    });

    it("iPhone でなければ出さない", () => {
        for (const ua of [ANDROID, IPAD, MAC]) {
            setUA(ua);
            const { unmount } = render(<OpenInAppButton slug="abukumado" isJa />);
            expect(screen.queryByTestId("open-in-app"), ua).toBeNull();
            unmount();
            uaSpy?.mockRestore();
        }
    });

    it("?app=save で開いた iPhone（アプリが入っていない人）は App Store へ移す", () => {
        setUA(IPHONE);
        window.history.replaceState(null, "", "/spots/abukumado?app=save");
        const replace = vi.fn();
        const loc = window.location;
        vi.spyOn(window, "location", "get").mockReturnValue({ ...loc, href: loc.href, replace } as unknown as Location);
        render(<OpenInAppButton slug="abukumado" isJa />);
        expect(replace).toHaveBeenCalledWith(STORE);
    });

    it("?app=save でも iPhone でなければ移さず、印だけ URL から消す", () => {
        setUA(MAC);
        window.history.replaceState(null, "", "/spots/abukumado?app=save&x=1#top");
        render(<OpenInAppButton slug="abukumado" isJa />);
        expect(window.location.pathname + window.location.search + window.location.hash).toBe("/spots/abukumado?x=1#top");
    });

    it("印が無ければ何もしない", () => {
        setUA(IPHONE);
        const replace = vi.fn();
        const loc = window.location;
        vi.spyOn(window, "location", "get").mockReturnValue({ ...loc, href: loc.href, replace } as unknown as Location);
        render(<OpenInAppButton slug="abukumado" isJa />);
        expect(replace).not.toHaveBeenCalled();
    });
});
