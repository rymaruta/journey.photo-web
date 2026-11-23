import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { usePhotoViewBeacon, shouldSendView, viewEligible, sendPhotoView, VIEW_DEDUP_MS, VIEW_DWELL_MS } from "../photoViews";

/**
 * 写真の閲覧数を送る条件（Web・札 journey.photo-ios#707）:
 * 1秒以上見えたら1回・同じ写真は30分以内に送らない・本人と圏外は送らない・ログインの確かめを待つ・裏に回ったら数えない
 */
const beacon = vi.fn((_url: string, _body?: BodyInit | null) => true);

beforeEach(() => {
    vi.useFakeTimers();
    beacon.mockClear();
    beacon.mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    localStorage.clear();
    sessionStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

const mount = (id: string | undefined, o: { isOwn?: boolean; authLoading?: boolean } = {}) =>
    renderHook((p: { id: string | undefined; isOwn: boolean; authLoading: boolean }) =>
        usePhotoViewBeacon(p.id, { isOwn: p.isOwn, authLoading: p.authLoading }),
    { initialProps: { id, isOwn: o.isOwn ?? false, authLoading: o.authLoading ?? false } });

describe("送る条件", () => {
    it("1秒見えたら1回だけ送る（宛先と本文）", async () => {
        mount("p1");
        vi.advanceTimersByTime(VIEW_DWELL_MS - 1);
        expect(beacon).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(beacon).toHaveBeenCalledTimes(1);
        expect(beacon.mock.calls[0][0]).toMatch(/\/photos\/p1\/view$/);
        const body = beacon.mock.calls[0][1] as Blob;
        expect(body.type).toBe("text/plain");
        expect(JSON.parse(await body.text())).toEqual({ via: "web" });
        vi.advanceTimersByTime(VIEW_DWELL_MS * 10);
        expect(beacon).toHaveBeenCalledTimes(1);
    });

    it("1秒より前に離れたら送らない", () => {
        const h = mount("p1");
        vi.advanceTimersByTime(VIEW_DWELL_MS - 100);
        h.unmount();
        vi.advanceTimersByTime(VIEW_DWELL_MS);
        expect(beacon).not.toHaveBeenCalled();
    });

    it("本人の写真では送らない", () => {
        mount("p1", { isOwn: true });
        vi.advanceTimersByTime(VIEW_DWELL_MS * 2);
        expect(beacon).not.toHaveBeenCalled();
    });

    it("ログインの確かめが終わるまで待ち、本人と分かったら送らない", () => {
        const h = mount("p1", { authLoading: true });
        vi.advanceTimersByTime(VIEW_DWELL_MS * 2);
        expect(beacon).not.toHaveBeenCalled();
        h.rerender({ id: "p1", isOwn: true, authLoading: false });
        vi.advanceTimersByTime(VIEW_DWELL_MS * 2);
        expect(beacon).not.toHaveBeenCalled();
    });

    it("ログインの確かめが済んで他人と分かったら送る", () => {
        const h = mount("p1", { authLoading: true });
        vi.advanceTimersByTime(VIEW_DWELL_MS * 2);
        h.rerender({ id: "p1", isOwn: false, authLoading: false });
        vi.advanceTimersByTime(VIEW_DWELL_MS);
        expect(beacon).toHaveBeenCalledTimes(1);
    });

    it("圏外では送らない（貯めない）", () => {
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        mount("p1");
        vi.advanceTimersByTime(VIEW_DWELL_MS * 2);
        expect(beacon).not.toHaveBeenCalled();
    });

    it("同じ写真は30分以内に送らない・30分たてば送る", () => {
        const t0 = Date.now();
        expect(sendPhotoView("p1", t0)).toBe(true);
        expect(sendPhotoView("p1", t0 + VIEW_DEDUP_MS - 1)).toBe(false);
        expect(sendPhotoView("p2", t0 + 1)).toBe(true);
        expect(sendPhotoView("p1", t0 + VIEW_DEDUP_MS)).toBe(true);
        expect(beacon).toHaveBeenCalledTimes(3);
    });

    it("送れなかった回は控えに残さない（次に開いたときに送る）", () => {
        beacon.mockReturnValueOnce(false);
        expect(sendPhotoView("p1", 1000)).toBe(false);
        expect(sendPhotoView("p1", 2000)).toBe(true);
    });

    it("保存領域が使えなくても頁は落ちずに送る", () => {
        const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
        const spy2 = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
        expect(() => sendPhotoView("p1", 1000)).not.toThrow();
        expect(beacon).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        spy2.mockRestore();
    });

    it("写真が替わったら、その写真の分を数え直す", () => {
        const h = mount("p1");
        vi.advanceTimersByTime(VIEW_DWELL_MS);
        h.rerender({ id: "p2", isOwn: false, authLoading: false });
        vi.advanceTimersByTime(VIEW_DWELL_MS);
        expect(beacon.mock.calls.map((c) => c[0].split("/photos/")[1])).toEqual(["p1/view", "p2/view"]);
    });

    it("純粋な判定", () => {
        expect(shouldSendView({ p1: 100 }, "p1", 100 + VIEW_DEDUP_MS - 1)).toBe(false);
        expect(shouldSendView({ p1: 100 }, "p1", 100 + VIEW_DEDUP_MS)).toBe(true);
        expect(shouldSendView({}, "p1", 0)).toBe(true);
        expect(viewEligible({ isOwn: false, authLoading: false, online: true })).toBe(true);
        expect(viewEligible({ isOwn: true, authLoading: false, online: true })).toBe(false);
        expect(viewEligible({ isOwn: false, authLoading: true, online: true })).toBe(false);
        expect(viewEligible({ isOwn: false, authLoading: false, online: false })).toBe(false);
    });
});

describe("写真の頁が使う", () => {
    it("PhotoPageClient が本人の判定とログインの確かめを渡して呼ぶ", () => {
        const src = readFileSync(join(process.cwd(), "app/photo/[id]/PhotoPageClient.tsx"), "utf8");
        expect(src).toContain("usePhotoViewBeacon(photo?.id, { isOwn: isOwnPhoto, authLoading });");
    });
});
