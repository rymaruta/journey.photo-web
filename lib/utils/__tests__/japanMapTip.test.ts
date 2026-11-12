import { describe, expect, it } from "vitest";
import { placeTip, TIP_GAP, TIP_H, type Rect } from "../japanMapTip";

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
