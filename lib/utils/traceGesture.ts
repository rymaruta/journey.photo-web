// lib/utils/traceGesture.ts
//
// ホームの日本地図の**なぞり判定の状態機械**（DOM を持たない・時間は setTimeout だけ）。`HomeJapanMap` が pointer イベントをここへ渡し、
// 機械は「なぞりが始まった・動いた・離した・取り消された」だけを返す。単体テストは `lib/utils/__tests__/traceGesture.test.ts`。
//
// 2026-11-09 判断（owner 承認 案C・仕様 v4 の「1 · SCROLL」）:
//   通常のタッチはそのまま縦スクロール・タップ。次の 2 つのときだけ「なぞりモード」に入る。
//   - **長押し**: 250ms のあいだ、置いた所から 8pt 以内に止まっている（`dwell`）
//   - **横寄り**: 8pt 超動いて、動きが水平から 45° 以内（|Δx| ≥ |Δy|・`horizontal`）
//   縦寄り（|Δy| > |Δx|）は縦スクロールに任せる（`scroll`）。ただし**縦寄りなのに 120ms 経ってもブラウザが引き取らない**
//   （pointercancel が来ない）ときは、なぞり開始（`orphan`）。斜めの境目はブラウザごとに違うので、何も起きない「死んだ角度」を作らない
//   - 8pt 以内で離した（250ms 未満）ものは**タップ候補**（`tapCandidate`）。確定は click で行う（pointerup では選ばない・慣性スクロールを指で止めただけで
//     地方が開くのを防ぐ）。この機械は click を知らない
//   - 2 本目の指: なぞり中なら取り消し（`second-finger`）。以後、全部の指が離れるまで何もしない（`multi`）
//   - pointercancel: なぞり中なら取り消し（`pointercancel`）。そうでなければ何もしない（ブラウザがスクロールを始めた）
//   - マウス: 押した瞬間になぞり開始（`mouse`）。右ボタン・中ボタンは無視
//   値は `GESTURE`。実機（iOS Safari）で確かめるべき点は報告の 5 項目

export const GESTURE = {
    /** 長押しの時間（ms） */
    dwellMs: 250,
    /** 置いた位置から動いてよい距離（pt）。超えたら長押しではない */
    slopPx: 8,
    /** 縦寄りの動きのあと、pointercancel が来ないままなぞりを始めるまで（ms） */
    orphanMs: 120,
    /** 横寄りの判定: |Δx| ≥ hRatio × |Δy| */
    hRatio: 1,
} as const;

export type TraceWhy = "dwell" | "horizontal" | "orphan" | "mouse";
export type TraceAbort = "pointercancel" | "second-finger";
export type TraceMode = "idle" | "pending" | "scroll" | "tracing" | "multi";

export type PointerIn = { id: number; x: number; y: number; type: string; button: number };

export type TraceHandlers = {
    /** 押した（長押しの輪の進みを出す）。座標は画面の px */
    pending: (x: number, y: number) => void;
    /** 輪の進みを消す（動いた・離した・なぞり開始・取り消し） */
    pendingEnd: () => void;
    begin: (x: number, y: number, why: TraceWhy, id: number) => void;
    move: (x: number, y: number) => void;
    release: (x: number, y: number) => void;
    abort: (why: TraceAbort) => void;
    tapCandidate: () => void;
};

export class TraceGesture {
    mode: TraceMode = "idle";
    private ids = new Set<number>();
    private start: { x: number; y: number; id: number } | null = null;
    private last: { x: number; y: number } | null = null;
    private dwell: ReturnType<typeof setTimeout> | null = null;
    private orphan: ReturnType<typeof setTimeout> | null = null;

    constructor(private h: TraceHandlers, private cfg: typeof GESTURE = GESTURE) {}

    private clear() {
        if (this.dwell !== null) clearTimeout(this.dwell);
        if (this.orphan !== null) clearTimeout(this.orphan);
        this.dwell = this.orphan = null;
    }

    private begin(x: number, y: number, why: TraceWhy) {
        if (this.mode === "tracing" || !this.start) return;
        this.clear();
        this.h.pendingEnd();
        this.mode = "tracing";
        this.h.begin(x, y, why, this.start.id);
    }

    down(p: PointerIn) {
        if (p.button > 0) return;
        if (this.ids.has(p.id) && this.mode === "idle") this.ids.clear(); // 取りこぼした離しの後始末
        this.ids.add(p.id);
        if (this.ids.size > 1) {
            // 2 本目の指: なぞりを取り消す。全部の指が離れるまで何もしない
            this.clear();
            this.h.pendingEnd();
            if (this.mode === "tracing") this.h.abort("second-finger");
            this.mode = "multi";
            return;
        }
        this.start = { x: p.x, y: p.y, id: p.id };
        this.last = { x: p.x, y: p.y };
        if (p.type === "mouse") { this.mode = "pending"; this.begin(p.x, p.y, "mouse"); return; }
        this.mode = "pending";
        this.h.pending(p.x, p.y);
        this.dwell = setTimeout(() => { if (this.mode === "pending" && this.last) this.begin(this.last.x, this.last.y, "dwell"); }, this.cfg.dwellMs);
    }

    move(p: PointerIn) {
        if (!this.start || p.id !== this.start.id) return;
        this.last = { x: p.x, y: p.y };
        if (this.mode === "tracing") { this.h.move(p.x, p.y); return; }
        if (this.mode !== "pending") return;
        const dx = p.x - this.start.x, dy = p.y - this.start.y;
        if (Math.hypot(dx, dy) <= this.cfg.slopPx) return;
        if (this.dwell !== null) clearTimeout(this.dwell);
        this.dwell = null;
        this.h.pendingEnd();
        if (Math.abs(dx) >= this.cfg.hRatio * Math.abs(dy)) { this.begin(p.x, p.y, "horizontal"); return; }
        // 縦寄り: ブラウザのスクロールに任せる。120ms 経っても pointercancel が来なければ、なぞり開始
        this.mode = "scroll";
        if (this.orphan !== null) clearTimeout(this.orphan);
        this.orphan = setTimeout(() => { if (this.mode === "scroll" && this.last) this.begin(this.last.x, this.last.y, "orphan"); }, this.cfg.orphanMs);
    }

    up(p: PointerIn, canceled: boolean) {
        this.ids.delete(p.id);
        if (this.mode === "multi") { if (this.ids.size === 0) this.mode = "idle"; return; }
        if (!this.start || p.id !== this.start.id) return;
        const m = this.mode;
        this.clear();
        this.h.pendingEnd();
        this.start = null;
        this.mode = "idle";
        if (canceled) { if (m === "tracing") this.h.abort("pointercancel"); return; }
        if (m === "pending") { this.h.tapCandidate(); return; }
        if (m === "tracing") this.h.release(p.x, p.y);
        // scroll: スクロールのあとの離し。何もしない
    }

    /** 途中状態を全部捨てる（画面の切り替え・アンマウント・例外のあと） */
    reset() {
        this.clear();
        this.ids.clear();
        this.start = null;
        this.last = null;
        this.mode = "idle";
    }
}
