// lib/learn/exposure.ts
//
// **露出のシミュレーター（/learn/camera-basics の `ExposureLab`）の計算**。画面から切り離した純関数。
//
// 2026-11-04 判断: 明るさは EV（露出値・ISO 100 を基準）の式で出す。
//
//     設定の EV = log2(F値² ÷ シャッター秒) − log2(ISO ÷ 100)
//     ずれ（段） = 場面の EV − 設定の EV      … 正なら明るすぎ・負なら暗すぎ
//
// F値・シャッター・ISO の並びは**カメラの表示どおりの1段刻み**（F1.4 → 2 → 2.8 …、1/125 → 1/60 …）。
// 表示の数字は丸めた呼び名（1/60 は本当は 1/64、F5.6 は √32 ≈ 5.66）なので、式に入れるのは
// 呼び名ではなく**本当の値**（`exact`）。こうしないと「1段ずつ動かしたのに 0.06 段ずれる」が起きる。
//
// 場面の EV（晴れ 15・曇り 12・夜の明るい通り 8）は、露出の表で一般に使われる目安。
// 実際の光は場所・時刻で大きく変わる——画面にも「概念図」と書く。

export type Stop<T extends number = number> = {
    /** カメラに出る呼び名 */
    label: string;
    /** 式に入れる本当の値 */
    exact: T;
};

/** F値（1段刻み）。本当の値は √2 の累乗（F1.4 = √2¹、F2 = √2² …） */
export const APERTURES: Stop[] = ["1.4", "2", "2.8", "4", "5.6", "8", "11", "16"].map((label, i) => ({
    label: `F${label}`,
    exact: Math.SQRT2 ** (i + 1),
}));

/** シャッタースピード（1段刻み・秒）。本当の値は 2 の累乗（1/125 = 2⁻⁷ 秒） */
export const SHUTTERS: Stop[] = [
    ["1/4000", -12], ["1/2000", -11], ["1/1000", -10], ["1/500", -9], ["1/250", -8], ["1/125", -7],
    ["1/60", -6], ["1/30", -5], ["1/15", -4], ["1/8", -3], ["1/4", -2], ["1/2", -1], ["1", 0], ["2", 1],
].map(([label, power]) => ({ label: `${label}秒`, exact: 2 ** (power as number) }));

/** ISO 感度（1段刻み） */
export const ISOS: Stop[] = [100, 200, 400, 800, 1600, 3200, 6400].map((v) => ({ label: `ISO ${v}`, exact: v }));

export type SceneId = "sunny" | "cloudy" | "night";

/** 場面と、その場面の明るさの目安（EV・ISO 100 基準） */
export const SCENES: { id: SceneId; label: string; ev: number }[] = [
    { id: "sunny", label: "晴れた日の屋外", ev: 15 },
    { id: "cloudy", label: "曇りの日の屋外", ev: 12 },
    { id: "night", label: "夜の明るい通り", ev: 8 },
];

/** 露出計の端（±3 段より外は「振り切れ」として端に寄せる） */
export const METER_LIMIT = 3;

/** 設定の EV（ISO 100 基準に直した値） */
export function settingsEv(aperture: number, shutterSeconds: number, iso: number): number {
    return Math.log2((aperture * aperture) / shutterSeconds) - Math.log2(iso / 100);
}

/** 場面に対するずれ（段）。正＝明るすぎ・負＝暗すぎ */
export function exposureOffset(sceneEv: number, aperture: number, shutterSeconds: number, iso: number): number {
    return sceneEv - settingsEv(aperture, shutterSeconds, iso);
}

/** 1/3 段に丸める（カメラの露出計と同じ刻み）。−0 は 0 にする */
export function roundToThird(stops: number): number {
    const r = Math.round(stops * 3) / 3;
    return Object.is(r, -0) || Math.abs(r) < 1e-9 ? 0 : r;
}

/**
 * **A（絞り優先）モードでカメラが選ぶシャッター**の位置（`SHUTTERS` の添字）。
 * ちょうど良い明るさになるシャッターに一番近い段を選ぶ。範囲（1/4000〜2秒）を超えるときは端で止まり、
 * そのぶん明るすぎ・暗すぎが残る（`exposureOffset` で見える）。
 */
export function autoShutterIndex(sceneEv: number, aperture: number, iso: number): number {
    // log2(N²/t) − log2(ISO/100) = EV  →  t = N² ÷ 2^(EV + log2(ISO/100))
    const ideal = (aperture * aperture) / 2 ** (sceneEv + Math.log2(iso / 100));
    const target = Math.log2(ideal);
    let best = 0;
    let bestGap = Infinity;
    SHUTTERS.forEach((s, i) => {
        const gap = Math.abs(Math.log2(s.exact) - target);
        if (gap < bestGap - 1e-9) {
            best = i;
            bestGap = gap;
        }
    });
    return best;
}

/** ずれの読み方（画面と読み上げの両方で使う） */
export function offsetText(stops: number): string {
    const r = roundToThird(stops);
    if (r === 0) return "ちょうど良い明るさ";
    const abs = Math.abs(r);
    const whole = Math.floor(abs + 1e-9);
    const thirds = Math.round((abs - whole) * 3);
    const frac = thirds === 0 ? "" : thirds === 1 ? "⅓" : "⅔";
    const amount = `${whole > 0 ? whole : ""}${frac}`;
    return r > 0 ? `${amount}段 明るすぎ` : `${amount}段 暗すぎ`;
}

/** 露出計の針の位置（0〜1。中央 0.5 がちょうど良い明るさ）。±3 段の外は端 */
export function meterPosition(stops: number): number {
    const clamped = Math.max(-METER_LIMIT, Math.min(METER_LIMIT, stops));
    return (clamped + METER_LIMIT) / (METER_LIMIT * 2);
}

/**
 * **絵の効き方**（概念図の強さ。実写の再現ではない）。
 * - 明るさ: 1段で約1.4倍（見た目が急に白飛び・黒つぶれしないように平方根で効かせる）。0.25〜2.4 に収める
 * - 背景のぼけ: F値が小さいほど大きい（F16 でほぼ 0）
 * - 動く被写体のぶれ: 1秒に 480px 動く鳥として、シャッターが開いている間に動いた距離（最大 140px）
 * - 手持ちのぶれ: 1/60 秒より遅いと画面全体が少しぶれる（50mm 前後を手で持った目安）
 * - ざらつき: ISO が上がるほど濃い（ISO 100 で 0）
 */
export function sceneEffects(input: { offset: number; aperture: number; shutterSeconds: number; isoIndex: number; handheld: boolean }) {
    const { offset, aperture, shutterSeconds, isoIndex, handheld } = input;
    const brightness = Math.max(0.25, Math.min(2.4, Math.SQRT2 ** Math.max(-4, Math.min(4, offset))));
    const backgroundBlur = Math.max(0, 14 * (1.4 / aperture) - 1.3);
    const motionBlur = Math.min(140, shutterSeconds * 480);
    const shake = handheld && shutterSeconds > 1 / 60 ? Math.min(6, Math.log2(shutterSeconds * 60) * 1.6 + 0.6) : 0;
    const grain = isoIndex <= 0 ? 0 : Math.min(0.42, ((isoIndex / (ISOS.length - 1)) ** 1.4) * 0.42);
    return { brightness, backgroundBlur, motionBlur, shake, grain };
}
