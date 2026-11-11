import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// みんなの「行きたい」（2026-11-11・撮影スポットを払うの②）。送るのは端末のでたらめな ID と撮影スポットの鍵だけ・
// まとめて送る・10未満は出さない・数の無い撮影スポットには何も出さない
const mockPublic = vi.hoisted(() => vi.fn());
vi.mock("../api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), userPublicFetch: (...a: unknown[]) => mockPublic(...a) }));
vi.mock("../../../app/i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));

const W = await import("../spotWants");
const { SpotWantsLine, AreaWantsTop, HomeWantsStrip } = await import("../../../app/components/SpotWants");

const FILE = {
    month: "2026-11", updatedAt: "x",
    spots: [
        { slug: "shirakawago", name: "白川郷", n: 1284, rank: 1 },
        { slug: "kawaguchiko", name: "河口湖", n: 900, rank: 2 },
        { slug: "miyakojima", name: "宮古島", n: 512, rank: 3 },
        { slug: "arashiyama", name: "嵐山", n: 230, rank: 4 },
        { slug: "monet", name: "モネの池", n: 12, rank: 5 },
        { slug: "few", name: "少ない", n: 9, rank: 6 },
    ],
};

beforeEach(() => {
    window.localStorage.clear();
    W.resetSpotWantsCache();
    mockPublic.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => FILE })));
});

describe("送る", () => {
    it("5件たまったら端末の ID と鍵だけを送り、送れたものを消す", async () => {
        for (const s of ["a", "b", "c", "d"]) W.queueSpotWant(s);
        expect(mockPublic).not.toHaveBeenCalled();
        W.queueSpotWant("e");
        await waitFor(() => expect(mockPublic).toHaveBeenCalledTimes(1));
        const [path, init] = mockPublic.mock.calls[0] as [string, RequestInit];
        expect(path).toBe("/spots/wants");
        const body = JSON.parse(String(init.body));
        expect(Object.keys(body).sort()).toEqual(["device", "slugs"]);
        expect(body.slugs).toEqual(["SPOT-a", "SPOT-b", "SPOT-c", "SPOT-d", "SPOT-e"]);
        expect(body.device).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
        await waitFor(() => expect(W.readWantQueue()).toEqual([]));
    });

    it("同じ鍵は1つ・ひとつ戻したら外す・送れなかったら残す", async () => {
        W.queueSpotWant("a");
        W.queueSpotWant("a");
        W.queueSpotWant("b");
        W.unqueueSpotWant("b");
        expect(W.readWantQueue()).toEqual(["SPOT-a"]);
        mockPublic.mockResolvedValue({ ok: false });
        await W.flushSpotWants();
        expect(W.readWantQueue()).toEqual(["SPOT-a"]);
    });

    it("端末の ID は一度作ったら同じ", () => {
        const a = W.wantDeviceId();
        expect(a).toBeTruthy();
        expect(W.wantDeviceId()).toBe(a);
    });
});

describe("出す", () => {
    it("10未満は読まない", () => {
        expect(W.parseSpotWants(FILE)!.spots.map((s) => s.slug)).not.toContain("few");
        expect(W.parseSpotWants({ nope: 1 })).toBeNull();
    });

    it("撮影スポットの頁の題の下: 「今月の行きたい 1,284 · 全国1位」。数の無い撮影スポットは出さない", async () => {
        const { unmount } = render(<SpotWantsLine slug="shirakawago" />);
        const line = await screen.findByTestId("spot-wants-line");
        expect(line.textContent).toContain("今月の行きたい");
        expect(line.textContent).toContain("1,284");
        expect(line.textContent).toContain("全国1位");
        unmount();
        render(<SpotWantsLine slug="few" />);
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByTestId("spot-wants-line")).toBeNull();
    });

    it("県の一覧の頭: その県の撮影スポットから3つ", async () => {
        render(<AreaWantsTop spots={[{ slug: "monet", name: "モネの池", city: "関市" }, { slug: "shirakawago", name: "白川郷" }, { slug: "nothing", name: "数なし" }]} />);
        const top = await screen.findByTestId("area-wants-top");
        const rows = [...top.querySelectorAll("li")].map((li) => li.textContent);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain("白川郷");
        expect(rows[1]).toContain("モネの池");
        expect(top.querySelector("a")!.getAttribute("href")).toBe("/spots/shirakawago");
    });

    it("トップ: 今月の上位4つ（押すとその頁）", async () => {
        render(<HomeWantsStrip />);
        const strip = await screen.findByTestId("home-wants-strip");
        expect([...strip.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(
            ["/spots/shirakawago", "/spots/kawaguchiko", "/spots/miyakojima", "/spots/arashiyama"]);
        expect(strip.textContent).toContain("今月いちばん行きたい · 11月");
    });

    it("ファイルが無い・読めないときは何も出さない", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
        render(<HomeWantsStrip />);
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByTestId("home-wants-strip")).toBeNull();
    });
});
