import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GESTURE, TraceGesture, type PointerIn, type TraceHandlers } from "../traceGesture";

/**
 * なぞり判定の状態機械（仕様 v4「1 · SCROLL」）:
 *   長押し 250ms（動き 8pt 以内）か、横寄り（8pt 超・水平から 45° 以下）でなぞり開始。縦寄りはスクロールに任せる。
 *   縦寄りなのに 120ms 経っても pointercancel が来ないときはなぞり開始。タップは click で確定（機械は tapCandidate を出すだけ）。
 *   2 本目の指・pointercancel は取り消し。マウスは押した瞬間に開始。
 */
function rig() {
    const log: string[] = [];
    const h: TraceHandlers = {
        pending: (x, y) => log.push(`pending ${x},${y}`),
        pendingEnd: () => log.push("pendingEnd"),
        begin: (x, y, why) => log.push(`begin ${why} ${x},${y}`),
        move: (x, y) => log.push(`move ${x},${y}`),
        release: (x, y) => log.push(`release ${x},${y}`),
        abort: (why) => log.push(`abort ${why}`),
        tapCandidate: () => log.push("tap"),
    };
    const g = new TraceGesture(h);
    const p = (x: number, y: number, id = 1, type = "touch", button = 0): PointerIn => ({ id, x, y, type, button });
    const kinds = () => log.filter((l) => !l.startsWith("pendingEnd") && !l.startsWith("pending ")).map((l) => l.split(" ")[0] + (l.startsWith("begin") || l.startsWith("abort") ? " " + l.split(" ")[1] : ""));
    return { g, log, p, kinds };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("なぞり判定: 値", () => {
    it("長押し 250ms・動きの許容 8pt・縦寄りの待ち 120ms（仕様の値）", () => {
        expect(GESTURE.dwellMs).toBe(250);
        expect(GESTURE.slopPx).toBe(8);
        expect(GESTURE.orphanMs).toBe(120);
        expect(GESTURE.hRatio).toBe(1);
    });
});

describe("なぞり判定: 長押し", () => {
    it("249ms ではまだ始まらず、250ms で始まる（置いた位置のまま）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        vi.advanceTimersByTime(249);
        expect(g.mode).toBe("pending");
        expect(kinds()).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(g.mode).toBe("tracing");
        expect(kinds()).toEqual(["begin dwell"]);
    });

    it("8pt 以内の揺れは長押しのまま（9pt を超えたら長押しではない）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        g.move(p(104, 205)); // 距離 6.4
        vi.advanceTimersByTime(250);
        expect(kinds()).toEqual(["begin dwell"]);
        const r2 = rig();
        r2.g.down(r2.p(100, 200));
        r2.g.move(r2.p(100, 209)); // 距離 9・縦寄り
        vi.advanceTimersByTime(100);
        expect(r2.kinds()).toEqual([]); // 長押しは取り消され、まだ orphan の 120ms 前
        expect(r2.g.mode).toBe("scroll");
    });

    it("長押しの前に離すとタップ候補（click で確定する・ここでは選ばない）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        vi.advanceTimersByTime(120);
        g.up(p(100, 200), false);
        expect(kinds()).toEqual(["tap"]);
        expect(g.mode).toBe("idle");
        vi.advanceTimersByTime(1000);
        expect(kinds()).toEqual(["tap"]); // タイマーは残らない
    });

    it("長押しで始まったあとの移動は move・離すと release（画面に見えていたものは呼び手が持つ）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        vi.advanceTimersByTime(250);
        g.move(p(110, 210));
        g.move(p(130, 205));
        g.up(p(130, 205), false);
        expect(kinds()).toEqual(["begin dwell", "move", "move", "release"]);
        expect(g.mode).toBe("idle");
    });
});

describe("なぞり判定: 横寄り・縦寄り", () => {
    it("横寄り（8pt 超・水平から 45° 以下）は待たずになぞり開始", () => {
        for (const [dx, dy] of [[12, 0], [12, 12], [12, -12], [-15, 5]]) {
            const { g, p, kinds } = rig();
            g.down(p(100, 200));
            g.move(p(100 + dx, 200 + dy));
            expect(kinds(), `${dx},${dy}`).toEqual(["begin horizontal"]);
        }
    });

    it("縦寄り（|Δy| > |Δx|）はスクロールに任せる。pointercancel が来れば何もしない", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        g.move(p(104, 215));
        expect(g.mode).toBe("scroll");
        g.up(p(104, 215), true); // ブラウザがスクロールを始めた
        expect(kinds()).toEqual([]);
        expect(g.mode).toBe("idle");
        vi.advanceTimersByTime(1000);
        expect(kinds()).toEqual([]); // orphan のタイマーも残らない
    });

    it("縦寄りなのに 120ms 経っても pointercancel が来ないときは、なぞり開始（死んだ角度を作らない）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        g.move(p(104, 215));
        vi.advanceTimersByTime(119);
        expect(kinds()).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(kinds()).toEqual(["begin orphan"]);
    });

    it("縦寄りのあと、離れたらスクロールのあとの離しで何も出さない（タップ候補にしない）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        g.move(p(100, 230));
        g.up(p(100, 230), false);
        expect(kinds()).toEqual([]);
    });
});

describe("なぞり判定: 取り消し・マウス・複数の指", () => {
    it("なぞり中の pointercancel は取り消し（abort）。なぞっていないときは何も出さない", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        vi.advanceTimersByTime(250);
        g.up(p(100, 200), true);
        expect(kinds()).toEqual(["begin dwell", "abort pointercancel"]);
    });

    it("2 本目の指: なぞり中なら取り消し・全部の指が離れるまで何もしない", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200, 1));
        vi.advanceTimersByTime(250);
        g.down(p(150, 250, 2));
        expect(kinds()).toEqual(["begin dwell", "abort second-finger"]);
        expect(g.mode).toBe("multi");
        g.move(p(120, 210, 1));
        g.up(p(150, 250, 2), false);
        expect(g.mode).toBe("multi");
        g.up(p(120, 210, 1), false);
        expect(g.mode).toBe("idle");
        expect(kinds()).toEqual(["begin dwell", "abort second-finger"]);
        // 次の操作は普通に始まる
        g.down(p(10, 10, 3));
        vi.advanceTimersByTime(250);
        expect(kinds().slice(-1)).toEqual(["begin dwell"]);
    });

    it("長押しの待ちの途中で 2 本目の指が置かれたら、長押しは始まらない", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200, 1));
        vi.advanceTimersByTime(100);
        g.down(p(150, 250, 2));
        vi.advanceTimersByTime(1000);
        expect(kinds()).toEqual([]);
    });

    it("マウス: 押した瞬間になぞり開始・右ボタンは無視", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200, 1, "mouse", 2));
        expect(kinds()).toEqual([]);
        g.down(p(100, 200, 1, "mouse", 0));
        expect(kinds()).toEqual(["begin mouse"]);
        g.up(p(100, 200, 1, "mouse"), false);
        expect(kinds()).toEqual(["begin mouse", "release"]);
    });

    it("別の指の move は無視する（なぞっている指だけ追う）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200, 1));
        vi.advanceTimersByTime(250);
        g.move(p(500, 500, 9));
        expect(kinds()).toEqual(["begin dwell"]);
    });

    it("reset: 待ちのタイマーを残さず idle へ戻す（例外のあと・アンマウント）", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200));
        g.reset();
        vi.advanceTimersByTime(1000);
        expect(kinds()).toEqual([]);
        expect(g.mode).toBe("idle");
    });
});

describe("なぞり判定: 離した知らせ（pointerup / cancel）を取りこぼしたあと", () => {
    it("🔴 idle に古い指の番号が残っていても、次に置いた 1 本の指は 2 本目扱いにならず、長押しでなぞれる", () => {
        const { g, p, kinds } = rig();
        (g as unknown as { ids: Set<number> }).ids.add(9); // 取りこぼした指（離した知らせが来なかった）
        expect(g.mode).toBe("idle");
        g.down(p(100, 200, 1));
        expect(g.mode).toBe("pending");
        vi.advanceTimersByTime(250);
        expect(kinds()).toEqual(["begin dwell"]);
    });

    it("🔴 2 本指のあと片方の離しを取りこぼして multi のまま残っても、最初の指（isPrimary）を置けば普通に始まる", () => {
        const { g, p, kinds } = rig();
        g.down(p(100, 200, 1));
        g.down(p(150, 250, 2));
        g.up(p(150, 250, 2), false); // 指 1 の離しは来なかった
        expect(g.mode).toBe("multi");
        g.down({ ...p(100, 200, 3), primary: true });
        expect(g.mode).toBe("pending");
        vi.advanceTimersByTime(250);
        expect(kinds()).toEqual(["begin dwell"]);
        // isPrimary でない 2 本目は、これまでどおり 2 本目扱い
        g.down({ ...p(160, 260, 4), primary: false });
        expect(g.mode).toBe("multi");
    });
});
