import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// 2026-11-20: 頁を離れる途中（WebKit が読み込み中のチャンクを打ち切って error を出す）では読み直さない。
// 読み直すと移動が割り込まれて元の頁に戻される（本番の Deploy Site run 44815049595 の2回目の smoke）
const reloadSpy = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/assetRecovery", async (orig) => {
    const m = await orig<typeof import("../../../lib/utils/assetRecovery")>();
    return { ...m, markReloaded: (...a: Parameters<typeof m.markReloaded>) => { reloadSpy(); return m.markReloaded(...a); } };
});
const { default: AssetRecovery } = await import("../AssetRecovery");

const chunkError = () => {
    const s = document.createElement("script");
    s.src = `${window.location.origin}/_next/static/chunks/a.js`;
    document.body.appendChild(s);
    s.dispatchEvent(new Event("error"));
};

beforeEach(() => {
    sessionStorage.clear();
    reloadSpy.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => { });
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

describe("AssetRecovery: 頁を離れる途中", () => {
    it("ふだんの自分のチャンクの失敗では読み直す", () => {
        render(<AssetRecovery />);
        chunkError();
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    it.each(["beforeunload", "pagehide"])("%s のあとの失敗では読み直さない", (ev) => {
        render(<AssetRecovery />);
        window.dispatchEvent(new Event(ev));
        chunkError();
        expect(reloadSpy).not.toHaveBeenCalled();
    });
    it("pageshow で元に戻る", () => {
        render(<AssetRecovery />);
        window.dispatchEvent(new Event("beforeunload"));
        window.dispatchEvent(new Event("pageshow"));
        chunkError();
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
});
