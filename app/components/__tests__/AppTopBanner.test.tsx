import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const AppTopBanner = (await import("../AppTopBanner")).default;
const HeaderAppLink = (await import("../HeaderAppLink")).default;
const { APP_TOP_BANNER_CLOSED_KEY } = await import("../../../lib/utils/appBanner");
const { UA } = await import("../../../lib/utils/__tests__/appBannerUA");

// 2026-11-20 owner 判断（札 journey.photo-ios#666）: iPhone の Safari 以外の頁のいちばん上にアプリの帯。
// ヘッダーの「アプリ」は iPhone なら Safari にも出す
const gtag = vi.fn();
const clicks = () => gtag.mock.calls.filter((c) => c[1] === "app_store_click").map((c) => c[2]);
let uaSpy: ReturnType<typeof vi.spyOn> | undefined;
const setUA = (ua: string, touch = 5) => {
    uaSpy = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
    Object.defineProperty(window.navigator, "maxTouchPoints", { value: touch, configurable: true });
};
const mount = async (ui: React.ReactElement) => {
    const r = render(ui);
    // 帯は描いたあとで端末を読み、次の描画の枠で広げる
    await act(async () => { await new Promise((res) => requestAnimationFrame(() => res(null))); });
    return r;
};

beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});
afterEach(() => {
    cleanup();
    uaSpy?.mockRestore();
    document.documentElement.style.removeProperty("--app-banner-h");
});

describe("AppTopBanner（上の帯）", () => {
    it.each([
        ["iOS の Chrome", UA.chrome],
        ["iOS の Firefox", UA.firefox],
        ["iOS の Edge", UA.edge],
        ["LINE", UA.line],
        ["Instagram", UA.instagram],
        ["Facebook", UA.facebook],
        ["X", UA.x],
    ])("出す: %s（アイコン・名前・一言・入手・×）", async (_n, ua) => {
        setUA(ua);
        await mount(<AppTopBanner />);
        const banner = screen.getByTestId("app-top-banner");
        expect(banner.textContent).toContain("Journey Photo");
        expect(banner.textContent).toContain("旅先でも、アプリで。");
        expect(screen.getByRole("link", { name: "App Storeで入手" }).getAttribute("href")).toBe("https://apps.apple.com/jp/app/id6814335283");
        expect(screen.getByRole("link", { name: "App Storeで入手" }).textContent).toBe("入手");
        const close = screen.getByRole("button", { name: "閉じる" });
        expect(close.style.width).toBe("44px");
        expect(close.style.height).toBe("44px");
        // 上から滑り込んで高さ 60
        expect(banner.style.height).toBe("60px");
    });

    it.each([
        ["iPhone の Safari（Apple の帯が出る）", UA.safari, 5],
        ["iPad の Safari", UA.ipadSafari, 5],
        ["PC", UA.pcChrome, 0],
        ["Mac", UA.macSafari, 0],
        ["Android", UA.android, 5],
        ["自分のアプリの中", UA.ownApp, 5],
    ])("出さない: %s", async (_n, ua, touch) => {
        setUA(ua, touch);
        await mount(<AppTopBanner />);
        expect(screen.queryByTestId("app-top-banner")).toBeNull();
    });

    it("最初の描画（静的な HTML と同じ）では何も描かず、場所も空けない", () => {
        setUA(UA.chrome);
        const html = (async () => (await import("react-dom/server")).renderToString(<AppTopBanner />))();
        return html.then((h) => expect(h).toBe(""));
    });

    it("× で閉じたら、その訪問の間は出ない（sessionStorage）。次の訪問（新しいタブ）ではまた出る", async () => {
        setUA(UA.chrome);
        const first = await mount(<AppTopBanner />);
        await userEvent.setup().click(screen.getByRole("button", { name: "閉じる" }));
        expect(screen.queryByTestId("app-top-banner")).toBeNull();
        expect(sessionStorage.getItem(APP_TOP_BANNER_CLOSED_KEY)).toBe("1");
        // 7日などの長い記憶は使わない
        expect(localStorage.length).toBe(0);
        first.unmount();

        // 同じ訪問の別の頁（作り直し）でも出ない
        await mount(<AppTopBanner />);
        expect(screen.queryByTestId("app-top-banner")).toBeNull();
        cleanup();

        // 次の訪問（sessionStorage は空）ではまた出る
        sessionStorage.clear();
        await mount(<AppTopBanner />);
        expect(screen.getByTestId("app-top-banner")).toBeTruthy();
    });

    it("sessionStorage が読めないときも出す（毎回出してよい）", async () => {
        setUA(UA.chrome);
        const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
        try {
            await mount(<AppTopBanner />);
            expect(screen.getByTestId("app-top-banner")).toBeTruthy();
        } finally {
            spy.mockRestore();
        }
    });

    it("「入手」を押すと app_store_click（placement=top_banner）を1回", async () => {
        setUA(UA.chrome);
        await mount(<AppTopBanner />);
        const link = screen.getByRole("link", { name: "App Storeで入手" });
        link.addEventListener("click", (e) => e.preventDefault());
        await userEvent.setup().click(link);
        expect(clicks()).toEqual([expect.objectContaining({ placement: "top_banner" })]);
    });

    it("星・評価・ダウンロード数のような確かめられない数を出さない（字に数字が無い）", async () => {
        setUA(UA.chrome);
        await mount(<AppTopBanner />);
        const text = screen.getByTestId("app-top-banner").textContent ?? "";
        expect(text).not.toMatch(/[0-9０-９★☆⭐]|評価|レビュー|ダウンロード|万/);
        const src = fs.readFileSync(path.resolve(__dirname, "../AppTopBanner.tsx"), "utf8");
        expect(src).not.toMatch(/StarIcon|rating|★/);
    });

    it("動きを減らす設定では動かさない（motion-reduce）", async () => {
        setUA(UA.chrome);
        await mount(<AppTopBanner />);
        const banner = screen.getByTestId("app-top-banner");
        expect(banner.className).toContain("motion-reduce:transition-none");
        expect((banner.firstElementChild as HTMLElement).className).toContain("motion-reduce:transition-none");
    });

    it("見えている高さを --app-banner-h に渡し、閉じたら消す（メニューの板がヘッダーに重ならない）", async () => {
        setUA(UA.chrome);
        await mount(<AppTopBanner />);
        expect(document.documentElement.style.getPropertyValue("--app-banner-h")).toMatch(/^\d+px$/);
        await userEvent.setup().click(screen.getByRole("button", { name: "閉じる" }));
        expect(document.documentElement.style.getPropertyValue("--app-banner-h")).toBe("");
    });
});

describe("HeaderAppLink（ヘッダーの「アプリ」）", () => {
    it.each([["Safari", UA.safari], ["Chrome", UA.chrome], ["LINE", UA.line]])("iPhone の %s に出し、押すと App Store", async (_n, ua) => {
        setUA(ua);
        await mount(<HeaderAppLink />);
        const link = screen.getByTestId("header-app");
        expect(link.textContent).toBe("アプリ");
        expect(link.getAttribute("href")).toBe("https://apps.apple.com/jp/app/id6814335283");
        link.addEventListener("click", (e) => e.preventDefault());
        await userEvent.setup().click(link);
        expect(clicks()).toEqual([expect.objectContaining({ placement: "header" })]);
    });

    it.each([["iPad", UA.ipadSafari, 5], ["PC", UA.pcChrome, 0], ["Android", UA.android, 5], ["アプリの入らない iOS 15 の iPhone", UA.safariIOS15, 5]])("%s には出さない", async (_n, ua, touch) => {
        setUA(ua, touch);
        await mount(<HeaderAppLink />);
        expect(screen.queryByTestId("header-app")).toBeNull();
    });

    it("× で帯を閉じた後も出ている", async () => {
        setUA(UA.chrome);
        await mount(<><AppTopBanner /><HeaderAppLink /></>);
        await userEvent.setup().click(screen.getByRole("button", { name: "閉じる" }));
        expect(screen.queryByTestId("app-top-banner")).toBeNull();
        expect(screen.getByTestId("header-app")).toBeTruthy();
    });
});
