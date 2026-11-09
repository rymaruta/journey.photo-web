import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeTip, TIP_GAP, TIP_H, type Rect } from "../japanMapTip";
import {
    HINT_DURATION_MS, HINT_KEY, HINT_MAX_SHOWN, HINT_PATH, countVisit, ghostAt, ghostPlayed, readHint, shouldPlayGhost, shouldShowCaption, tracedOnce, writeHint,
} from "../japanMapHint";

const SAFE: Rect = { left: 0, top: 63, right: 390, bottom: 752 };

describe("名前の札の置き場所（仕様 v4「3 · LABEL」）", () => {
    it("指の真上: 輪の上端（指から 27px）から 20px 空ける・指の真上の中央", () => {
        const p = placeTip({ fx: 195, fy: 400, tw: 112, safe: SAFE, prev: "above" });
        expect(p.mode).toBe("above");
        expect(p.y).toBe(400 - 27 - TIP_GAP - TIP_H);
        expect(p.x).toBe(195 - 56);
    });

    it("上に入らないとき（安全域の上より上）だけ、左右へ退避。右半分なら左・左半分なら右", () => {
        const right = placeTip({ fx: 300, fy: 100, tw: 112, safe: SAFE, prev: "above" });
        expect(right.mode).toBe("left");
        expect(right.x).toBe(300 - 27 - TIP_GAP - 112);
        const left = placeTip({ fx: 80, fy: 100, tw: 112, safe: SAFE, prev: "above" });
        expect(left.mode).toBe("right");
        expect(left.x).toBe(80 + 27 + TIP_GAP);
        expect(left.y).toBeGreaterThanOrEqual(63);
    });

    it("横へ出したあと上へ戻すのは 12px の余裕ができてから（行き来のちらつきを防ぐ）", () => {
        const fy = 63 + 27 + TIP_GAP + TIP_H; // ちょうど上に入る位置
        expect(placeTip({ fx: 195, fy, tw: 112, safe: SAFE, prev: "above" }).mode).toBe("above");
        expect(placeTip({ fx: 195, fy, tw: 112, safe: SAFE, prev: "left" }).mode).not.toBe("above");
        expect(placeTip({ fx: 195, fy: fy + 12, tw: 112, safe: SAFE, prev: "left" }).mode).toBe("above");
    });

    it("左右の端は 8px 内側へ収める・どちらにも入らないときは固定欄だけ（fixed）", () => {
        const e = placeTip({ fx: 5, fy: 400, tw: 112, safe: SAFE, prev: "above" });
        expect(e.x).toBe(8);
        const e2 = placeTip({ fx: 390, fy: 400, tw: 112, safe: SAFE, prev: "above" });
        expect(e2.x + 112).toBe(390 - 8);
        const f = placeTip({ fx: 195, fy: 80, tw: 380, safe: { ...SAFE, right: 390 }, prev: "above" });
        expect(f.mode).toBe("fixed");
    });
});

describe("初見の手がかり（仕様 v4「4 · DISCOVERY」）", () => {
    beforeEach(() => { window.localStorage.clear(); });
    afterEach(() => { window.localStorage.clear(); });

    it("ゴースト: 初回は出す・2 回まで・なぞったことがあれば出さない・なぞらないまま 3 回目の来訪でもう 1 回", () => {
        let s = readHint();
        expect(shouldPlayGhost(s)).toBe(true);
        s = ghostPlayed(s);
        expect(shouldPlayGhost(s)).toBe(false); // 2 回目の来訪ではまだ
        s = countVisit(countVisit(s));
        expect(shouldPlayGhost(s)).toBe(false);
        s = countVisit(s);
        expect(s.visits).toBe(3);
        expect(shouldPlayGhost(s)).toBe(true); // 3 回目の来訪
        s = ghostPlayed(s);
        expect(s.shown).toBe(HINT_MAX_SHOWN);
        expect(shouldPlayGhost(s)).toBe(false);
        // なぞった端末には出さない・一言も消える
        const t = tracedOnce({ shown: 1, traced: false, visits: 9 });
        expect(shouldPlayGhost(t)).toBe(false);
        expect(shouldShowCaption(t)).toBe(false);
        expect(shouldShowCaption({ shown: 0, traced: false, visits: 0 })).toBe(true);
    });

    it("端末に旗を 1 つ持つ（localStorage）。壊れた値・保存できない環境でも動く（try/catch）", () => {
        writeHint({ shown: 1, traced: true, visits: 4 });
        expect(JSON.parse(window.localStorage.getItem(HINT_KEY)!)).toEqual({ shown: 1, traced: true, visits: 4 });
        expect(readHint()).toEqual({ shown: 1, traced: true, visits: 4 });
        window.localStorage.setItem(HINT_KEY, "{{{");
        expect(readHint()).toEqual({ shown: 0, traced: false, visits: 0 });
        window.localStorage.removeItem(HINT_KEY);
        const set = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("denied"); });
        expect(() => writeHint({ shown: 1, traced: false, visits: 1 })).not.toThrow();
        expect(set).toHaveBeenCalled();
        set.mockRestore();
        window.localStorage.setItem(HINT_KEY, JSON.stringify({ shown: 1, traced: false, visits: 1 }));
        const get = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("denied"); });
        expect(readHint()).toEqual({ shown: 0, traced: false, visits: 0 });
        get.mockRestore();
    });

    it("ゴーストの動き: 2.8 秒で 東北 → 関東 → 中部 → 近畿 を 3 区間なぞる・終わったら null", () => {
        expect(HINT_PATH).toEqual(["東北", "関東", "中部", "近畿"]);
        expect(HINT_DURATION_MS).toBe(2800);
        expect(ghostAt(0)).toEqual({ from: 0, to: 1, u: 0 });
        expect(ghostAt(2799)!.from).toBe(2);
        expect(ghostAt(2800)!.u).toBeCloseTo(1, 6);
        expect(ghostAt(2801)).toBeNull();
        expect(ghostAt(-1)).toBeNull();
        const mid = ghostAt(HINT_DURATION_MS / 3 / 2)!;
        expect(mid.u).toBeCloseTo(0.5, 6);
    });
});
