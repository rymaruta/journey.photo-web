import { describe, it, expect, beforeEach } from "vitest";
import { MAP_RETURN_KEY, clearMapReturn, readMapReturn, saveMapReturn } from "../mapReturn";
import { withNextHistoryState } from "../historyState";

/**
 * 2026-11-09: 地図から県の頁へ進んで戻ったとき、地図の位置（スクロール）と選んだ県へ帰るための覚え。
 */
beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, "", "/"); });

describe("mapReturn（sessionStorage の覚え）", () => {
    it("県とスクロール位置を覚えて読める（位置は整数に丸める）", () => {
        saveMapReturn("kanagawa", 398.4, 1_000);
        expect(readMapReturn(2_000)).toEqual({ pref: "kanagawa", y: 398, t: 1_000 });
    });
    it("1時間たつと失効・時計が戻っていても読まない・消せる", () => {
        saveMapReturn("osaka", 100, 1_000);
        expect(readMapReturn(1_000 + 60 * 60 * 1000)).not.toBeNull();
        expect(readMapReturn(1_000 + 60 * 60 * 1000 + 1)).toBeNull();
        expect(readMapReturn(500)).toBeNull();
        clearMapReturn();
        expect(readMapReturn(1_500)).toBeNull();
    });
    it("形の違う・壊れた値は読まない（県は小文字の英字だけ・位置は0以上の数）", () => {
        for (const v of ["{", "null", '{"pref":"../x","y":1,"t":1}', '{"pref":"osaka","y":-5,"t":1}', '{"pref":"osaka","y":"1","t":1}', '{"pref":1,"y":1,"t":1}']) {
            sessionStorage.setItem(MAP_RETURN_KEY, v);
            expect(readMapReturn(2), v).toBeNull();
        }
    });
    it("sessionStorage が使えなくても投げない", () => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error("quota"); };
        try { expect(() => saveMapReturn("osaka", 1)).not.toThrow(); } finally { Storage.prototype.setItem = orig; }
    });
});

describe("historyState: 地図の印（jmPref）を持ち越す", () => {
    it("ほかの書き戻しが state を作り直しても jmPref は残る。明示したときはそちらが勝つ", () => {
        window.history.replaceState({ jmPref: 1, __NA: true }, "", "/");
        expect(withNextHistoryState({}).jmPref).toBe(1);
        expect(withNextHistoryState({ photoModal: "x" }).jmPref).toBe(1);
        expect(withNextHistoryState({ jmPref: 0 }).jmPref).toBe(0);
        window.history.replaceState({}, "", "/");
        expect("jmPref" in withNextHistoryState({})).toBe(false);
    });
});
