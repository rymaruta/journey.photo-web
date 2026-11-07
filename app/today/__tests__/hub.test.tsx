import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { haversineKm } from "@/lib/utils/journey";
import { nearbyIndexRows } from "@/lib/data/todayPlaces";
import TodayHub, { NEARBY_INDEX_URL } from "../TodayHub";

/**
 * **「現在地で調べる」の約束**（頁にも書いてある）:
 *   - 位置は**ボタンを押したときだけ**聞く（開いただけでは聞かない）
 *   - 近くのスポットの索引は**位置が取れたあとにだけ**読む（押す前は読まない）
 *   - 座標は GA4 にもネットワークにも出ない（読む URL に座標は付かず、body も無い）・保存しない・URL に入れない
 *   - 断られた・取れない・日本の外のときは、県を選ぶ一覧に倒す
 */
const ROWS = nearbyIndexRows();
const TOKYO = { latitude: 35.6812, longitude: 139.7671 };

type PosCb = (p: { coords: { latitude: number; longitude: number } }) => void;
type ErrCb = (e: { code: number }) => void;

let getCurrentPosition: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;
let gtag: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;
let xhrOpen: ReturnType<typeof vi.spyOn>;
let setItem: ReturnType<typeof vi.spyOn>;

function geolocationReturns(pos: { latitude: number; longitude: number }) {
    getCurrentPosition = vi.fn((ok: PosCb) => { ok({ coords: pos }); });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
}
function geolocationFails(code: number) {
    getCurrentPosition = vi.fn((_ok: PosCb, ng: ErrCb) => { ng({ code }); });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
}

beforeEach(() => {
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ROWS }));
    vi.stubGlobal("fetch", fetchSpy);
    gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [];
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    xhrOpen = vi.spyOn(XMLHttpRequest.prototype, "open");
    setItem = vi.spyOn(Storage.prototype, "setItem");
    window.history.replaceState(null, "", "/today");
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as unknown as { gtag?: unknown }).gtag;
});

const press = () => fireEvent.click(screen.getByTestId("today-locate"));

describe("現在地で調べる", () => {
    it("開いただけでは位置を聞かず、索引も読まない（ボタンを押す前）", () => {
        geolocationReturns(TOKYO);
        render(<TodayHub />);
        expect(getCurrentPosition).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(screen.getByTestId("today-locate").textContent).toBe("現在地で調べる");
        expect(document.body.textContent).toContain("このボタンを押したときだけ");
    });

    it("押すと、今日の値と近くのスポット（距離つき・近い順）が出る", async () => {
        geolocationReturns(TOKYO);
        render(<TodayHub />);
        press();
        await screen.findByTestId("today-result");
        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // 今日の値（日本の日付で計算した値）
        const panel = screen.getByTestId("today-here");
        await waitFor(() => expect(panel.getAttribute("data-ready")).toBe("true"));
        expect(panel.textContent).toMatch(/日の出\d{2}:\d{2}/);
        expect(panel.textContent).toMatch(/日の入り\d{2}:\d{2}/);

        // 近くのスポット: 12件・距離つき・独立に計算した近い順と一致
        const links = [...screen.getByTestId("today-nearby").querySelectorAll("a")];
        expect(links).toHaveLength(12);
        const expected = [...ROWS]
            .map((r) => ({ slug: r[0], km: haversineKm({ lat: TOKYO.latitude, lng: TOKYO.longitude }, { lat: r[2], lng: r[3] }) }))
            .sort((a, b) => a.km - b.km)
            .slice(0, 12)
            .map((r) => r.slug);
        expect(links.map((a) => a.getAttribute("href"))).toEqual(expected.map((s) => `/spots/${s}`));
        for (const a of links) expect(a.textContent).toMatch(/(1km以内|約\d+(\.\d)?km)$/);
    });

    it("🔴 座標は GA4 にもネットワークにも出ない・保存しない・URL に入れない", async () => {
        geolocationReturns(TOKYO);
        render(<TodayHub />);
        press();
        await screen.findByTestId("today-result");

        // 通信は索引の取得1本だけ。URL は固定で、座標も body も付かない
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0]).toEqual([NEARBY_INDEX_URL]);
        expect(NEARBY_INDEX_URL).toBe("/app/data/nearby.json");
        expect(JSON.stringify(fetchSpy.mock.calls)).not.toMatch(/35\.68|139\.76/);
        // GA4・ビーコン・XHR・保存・URL
        expect(gtag).not.toHaveBeenCalled();
        expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toHaveLength(0);
        expect(beacon).not.toHaveBeenCalled();
        expect(xhrOpen).not.toHaveBeenCalled();
        expect(setItem).not.toHaveBeenCalled();
        expect(document.cookie).toBe("");
        expect(window.location.pathname + window.location.search + window.location.hash).toBe("/today");
        // 画面にも座標の数字を出さない
        expect(document.body.textContent).not.toMatch(/35\.68|139\.76/);
    });

    it("断られたら、索引を読まず、県を選ぶよう案内する", async () => {
        geolocationFails(1);
        render(<TodayHub />);
        press();
        expect((await screen.findByTestId("today-error")).textContent).toContain("許可されませんでした");
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(screen.getByTestId("today-error").textContent).toContain("下の一覧から県を選んで");
        expect(screen.queryByTestId("today-result")).toBeNull();
    });

    it("取得できない・時間切れ・非対応も案内に倒す", async () => {
        geolocationFails(2);
        const a = render(<TodayHub />);
        press();
        expect((await screen.findByTestId("today-error")).textContent).toContain("取得できませんでした");
        a.unmount();

        geolocationFails(3);
        const b = render(<TodayHub />);
        press();
        expect((await screen.findByTestId("today-error")).textContent).toContain("時間がかかりすぎました");
        b.unmount();

        Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
        render(<TodayHub />);
        press();
        expect((await screen.findByTestId("today-error")).textContent).toContain("このブラウザでは現在地を使えません");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("日本の外では索引も読まず、近くのスポットを作り話で出さない", async () => {
        geolocationReturns({ latitude: 48.8584, longitude: 2.2945 });   // パリ
        render(<TodayHub />);
        press();
        await screen.findByTestId("today-outside");
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(screen.queryByTestId("today-result")).toBeNull();
    });

    it("日本の外枠の中でも、近いスポットが200km より遠ければ日本の外と見る（ソウル）", async () => {
        geolocationReturns({ latitude: 37.5665, longitude: 126.978 });
        render(<TodayHub />);
        press();
        await screen.findByTestId("today-outside");
        expect(screen.queryByTestId("today-nearby")).toBeNull();
    });

    it("索引が読めなくても、今日の値は出し、県を選ぶよう案内する", async () => {
        geolocationReturns(TOKYO);
        fetchSpy.mockImplementation(async () => { throw new Error("offline"); });
        render(<TodayHub />);
        press();
        await screen.findByTestId("today-result");
        await waitFor(() => expect(screen.getByTestId("today-here").getAttribute("data-ready")).toBe("true"));
        expect(screen.getByTestId("today-nearby-failed").textContent).toContain("下の一覧から県を選んで");
    });

    it("壊れた索引（HTML など）は並べない", async () => {
        geolocationReturns(TOKYO);
        fetchSpy.mockImplementation(async () => ({ ok: true, json: async () => ({ not: "rows" }) }));
        render(<TodayHub />);
        press();
        await waitFor(() => expect(screen.getByTestId("today-nearby-failed")).toBeTruthy());
    });
});

/** コメントを落とす（説明文に書いた語に当たらないように） */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("座標を外に出す道具をそもそも使っていない（ソースの見張り）", () => {
    for (const file of ["app/today/TodayHub.tsx", "app/today/TodayLightPanel.tsx"]) {
        it(file, () => {
            const src = strip(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
            expect(src, "計測は使わない").not.toMatch(/lib\/utils\/analytics|\btrack\s*\(|gtag|dataLayer|TrackedLink/);
            expect(src, "保存しない").not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
            expect(src, "別の送り方をしない").not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|userFetch|new Image/);
            expect(src, "座標を URL に入れない").not.toMatch(/history\.(push|replace)State|router\.(push|replace)|location\.(href|search|hash)|URLSearchParams/);
            const fetches = src.match(/\bfetch\s*\(/g) ?? [];
            if (file.endsWith("TodayHub.tsx")) {
                expect(fetches).toHaveLength(1);
                expect(src).toContain("fetch(NEARBY_INDEX_URL)");
                expect(src.match(/getCurrentPosition/g)).toHaveLength(1);
            } else {
                expect(fetches).toHaveLength(0);
                expect(src).not.toMatch(/geolocation/);
            }
        });
    }
});
