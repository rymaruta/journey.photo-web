// lib/utils/japanMapHint.ts
//
// ホームの日本地図の**初見の手がかり**の出し方（DOM を持たない・保存は try/catch）。
//
// 2026-11-09 判断（owner 承認 案C・仕様 v4）: 常設の一言「長押ししてなぞる」＋初回だけ、輪が地方をなぞる動き（ゴースト・2.8 秒・1 回）。
//   - ゴーストを出す条件: 地図が画面の 60% 以上見え、1.2 秒操作がないとき。**端末で初回のみ**（localStorage の旗）。
//     なぞりを一度もしないまま 3 回目の来訪で、あと 1 回だけ出す（合計 2 回まで）
//   - 動きを減らす設定（prefers-reduced-motion）のときは動かさない（一言だけ）
//   - 保存できない環境（プライベートモード・無効化）でも動く。保存できないときは毎回「初回」になるが、ゴーストは 1 回の来訪で 1 回だけ

export const HINT_KEY = "jm-hint";
export const HINT_IDLE_MS = 1200;
export const HINT_VISIBLE_RATIO = 0.6;
export const HINT_MAX_SHOWN = 2;
export const HINT_RETRY_VISIT = 3;
/** ゴーストの長さ（ms）と、地方をなぞる順番 */
export const HINT_DURATION_MS = 2800;
export const HINT_PATH = ["東北", "関東", "中部", "近畿"] as const;

export type HintState = { shown: number; traced: boolean; visits: number };

export const HINT_INITIAL: HintState = { shown: 0, traced: false, visits: 0 };

export function readHint(): HintState {
    try {
        const v = JSON.parse(window.localStorage.getItem(HINT_KEY) ?? "null") as Partial<HintState> | null;
        if (!v || typeof v.shown !== "number" || typeof v.visits !== "number") return { ...HINT_INITIAL };
        return { shown: Math.max(0, Math.floor(v.shown)), traced: v.traced === true, visits: Math.max(0, Math.floor(v.visits)) };
    } catch { return { ...HINT_INITIAL }; }
}

export function writeHint(s: HintState): void {
    try { window.localStorage.setItem(HINT_KEY, JSON.stringify(s)); } catch { /* 保存できなくても動く */ }
}

/** 来訪を数える（マウントのたびに 1 回） */
export function countVisit(s: HintState): HintState {
    return { ...s, visits: s.visits + 1 };
}

/** ゴーストを出してよいか */
export function shouldPlayGhost(s: HintState): boolean {
    if (s.shown >= HINT_MAX_SHOWN) return false;
    if (s.shown === 0) return true;
    return !s.traced && s.visits >= HINT_RETRY_VISIT;
}

/** 常設の一言「長押ししてなぞる」を出すか: なぞったことのある端末には出さない */
export function shouldShowCaption(s: HintState): boolean {
    return !s.traced;
}

export function ghostPlayed(s: HintState): HintState {
    return { ...s, shown: s.shown + 1 };
}

export function tracedOnce(s: HintState): HintState {
    return s.traced ? s : { ...s, traced: true };
}

/** ゴーストの進み: 時間 t（ms）から、いまどの区間の何割か。終わったら null */
export function ghostAt(t: number): { from: number; to: number; u: number } | null {
    if (t < 0 || t > HINT_DURATION_MS) return null;
    const seg = HINT_PATH.length - 1;
    const per = HINT_DURATION_MS / seg;
    const i = Math.min(seg - 1, Math.floor(t / per));
    const raw = Math.min(1, (t - i * per) / per);
    const u = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2; // ease-in-out
    return { from: i, to: i + 1, u };
}
