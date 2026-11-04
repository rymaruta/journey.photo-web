"use client";

// app/learn/camera-basics/ExposureLab.tsx
//
// **露出のシミュレーター**（2026-11-04 に作り直し）。計算は `lib/learn/exposure.ts`（純関数・単体テストあり）。
//
// 見せること:
// - F値 → 背景のぼけ、シャッター → 動く鳥のぶれ（と手持ちのぶれ）、ISO → ざらつき、3つの合計 → 明るさ
// - A（絞り優先）モードではカメラがシャッターを選び、F値を変えても明るさが保たれる（露出計の針が真ん中）
// - M（マニュアル）では自分で3つを決め、外れると露出計の針が振れる
//
// 絵は SVG（フィルタでぼかす・ざらつきを重ねる）。**実写の再現ではない**ことを画面に書く。
// 値が変わったら `aria-live` の要約で読み上げる。`prefers-reduced-motion` では動きの遷移を切る。

import React, { useId, useMemo, useState } from "react";
import {
    APERTURES, SHUTTERS, ISOS, SCENES, METER_LIMIT,
    autoShutterIndex, exposureOffset, meterPosition, offsetText, sceneEffects, type SceneId,
} from "@/lib/learn/exposure";

type Mode = "A" | "M";

const SKY: Record<SceneId, [string, string]> = {
    sunny: ["#5d8fc4", "#b9d3e6"],
    cloudy: ["#7d8691", "#b7bcc1"],
    night: ["#0b1020", "#26314a"],
};

function describe(fx: ReturnType<typeof sceneEffects>): string {
    const parts: string[] = [];
    parts.push(fx.backgroundBlur > 6 ? "背景は大きくぼける" : fx.backgroundBlur > 2 ? "背景は少しぼける" : "背景までくっきり");
    parts.push(fx.motionBlur < 2 ? "飛ぶ鳥は止まって写る" : fx.motionBlur < 24 ? "飛ぶ鳥は少し流れる" : "飛ぶ鳥は大きく流れる");
    if (fx.shake > 0) parts.push("手持ちなので全体がぶれる");
    if (fx.grain > 0.2) parts.push("ざらつきが目立つ");
    else if (fx.grain > 0.06) parts.push("少しざらつく");
    return parts.join("、");
}

export default function ExposureLab() {
    const uid = useId();
    const [mode, setMode] = useState<Mode>("A");
    const [scene, setScene] = useState<SceneId>("cloudy");
    const [apIdx, setApIdx] = useState(4); // F5.6
    const [manualShIdx, setManualShIdx] = useState(5); // 1/125
    const [isoIdx, setIsoIdx] = useState(0); // ISO 100
    const [handheld, setHandheld] = useState(true);

    const sceneEv = SCENES.find((s) => s.id === scene)!.ev;
    const aperture = APERTURES[apIdx];
    const iso = ISOS[isoIdx];
    const shIdx = mode === "A" ? autoShutterIndex(sceneEv, aperture.exact, iso.exact) : manualShIdx;
    const shutter = SHUTTERS[shIdx];
    const offset = exposureOffset(sceneEv, aperture.exact, shutter.exact, iso.exact);
    const fx = useMemo(
        () => sceneEffects({ offset, aperture: aperture.exact, shutterSeconds: shutter.exact, isoIndex: isoIdx, handheld }),
        [offset, aperture.exact, shutter.exact, isoIdx, handheld],
    );
    const sceneLabel = SCENES.find((s) => s.id === scene)!.label;
    const reading = offsetText(offset);
    const pegged = Math.abs(offset) > METER_LIMIT + 1 / 6;
    const summary = `${aperture.label}・${shutter.label}・${iso.label}（${sceneLabel}）：${reading}${pegged ? "（露出計が振り切れている）" : ""}。${describe(fx)}。`;

    const switchMode = (next: Mode) => {
        // A → M に切り替えたときは、カメラが選んでいたシャッターから始める（いきなり明るさが飛ばない）
        if (next === "M" && mode === "A") setManualShIdx(shIdx);
        setMode(next);
    };

    const ids = {
        bg: `${uid}-bg`, motion: `${uid}-motion`, shake: `${uid}-shake`, grain: `${uid}-grain`, sky: `${uid}-sky`,
        heading: `${uid}-heading`, ap: `${uid}-ap`, sh: `${uid}-sh`, iso: `${uid}-iso`, hand: `${uid}-hand`,
    };
    const night = scene === "night";

    return (
        <section aria-labelledby={ids.heading} className="my-10 rounded-2xl bg-surface ring-1 ring-line p-4 sm:p-6" data-testid="exposure-lab">
            <p aria-hidden="true" className="m-0 eyebrow eyebrow-line text-accent">試してみる</p>
            <h2 id={ids.heading} className="m-0 mt-1.5 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: 1.35 }}>
                数字を動かして、写真の変わり方を見る
            </h2>
            <p className="m-0 mt-2 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                絵で表した概念図です。実際の写真の明るさ・ぼけ・ぶれを正確に再現するものではありません。場面の明るさは一般的な目安です。
            </p>

            {/* 撮影モード（設定の選択＝独立した丸チップの radiogroup。選んだ側は白塗り＋チェック） */}
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div role="radiogroup" aria-label="撮影モード" className="flex flex-wrap gap-2">
                    {([["A", "A（絞り優先）"], ["M", "M（マニュアル）"]] as const).map(([m, label]) => (
                        <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={mode === m}
                            onClick={() => switchMode(m)}
                            className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full ring-1 font-semibold ${mode === m ? "bg-white text-ink ring-white" : "bg-transparent text-chip-text ring-line-strong hover:text-white"}`}
                            style={{ fontSize: "14px", touchAction: "manipulation" }}
                        >
                            {mode === m && <span aria-hidden="true">✓</span>}
                            {label}
                        </button>
                    ))}
                </div>
                <div role="radiogroup" aria-label="場面" className="flex flex-wrap gap-2">
                    {SCENES.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            role="radio"
                            aria-checked={scene === s.id}
                            onClick={() => setScene(s.id)}
                            className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full ring-1 ${scene === s.id ? "bg-white text-ink ring-white font-semibold" : "bg-transparent text-chip-text ring-line-strong hover:text-white"}`}
                            style={{ fontSize: "14px", touchAction: "manipulation" }}
                        >
                            {scene === s.id && <span aria-hidden="true">✓</span>}
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 絵（明るさは CSS の filter、ぼけ・ぶれ・ざらつきは SVG のフィルタ） */}
            <div className="mt-5 rounded-xl overflow-hidden ring-1 ring-line bg-black">
                <svg
                    viewBox="0 0 640 400"
                    role="img"
                    aria-label={`概念図：${summary}`}
                    className="block w-full h-auto motion-safe:transition-[filter] motion-safe:duration-150"
                    style={{ filter: `brightness(${fx.brightness.toFixed(3)})` }}
                    data-testid="exposure-scene"
                >
                    <defs>
                        <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor={SKY[scene][0]} />
                            <stop offset="1" stopColor={SKY[scene][1]} />
                        </linearGradient>
                        <filter id={ids.bg} x="-10%" y="-10%" width="120%" height="120%">
                            <feGaussianBlur stdDeviation={fx.backgroundBlur.toFixed(2)} />
                        </filter>
                        <filter id={ids.motion} x="-60%" y="-20%" width="220%" height="140%">
                            <feGaussianBlur stdDeviation={`${(fx.motionBlur / 2).toFixed(2)} 0`} />
                        </filter>
                        <filter id={ids.shake} x="-5%" y="-5%" width="110%" height="110%">
                            <feGaussianBlur stdDeviation={`${fx.shake.toFixed(2)} ${(fx.shake * 0.6).toFixed(2)}`} />
                        </filter>
                        <filter id={ids.grain}>
                            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
                            <feColorMatrix type="saturate" values="0" />
                        </filter>
                    </defs>

                    <g filter={fx.shake > 0 ? `url(#${ids.shake})` : undefined}>
                        <rect width="640" height="400" fill={`url(#${ids.sky})`} />

                        {/* 背景（F値でぼける） */}
                        <g filter={`url(#${ids.bg})`} data-testid="exposure-background">
                            {night && [70, 160, 300, 470, 560].map((x, i) => (
                                <circle key={x} cx={x} cy={50 + (i % 2) * 30} r="1.6" fill="#ffffff" opacity="0.8" />
                            ))}
                            <path d="M0 250 L90 170 L170 230 L260 150 L360 225 L450 165 L540 220 L640 180 L640 400 L0 400 Z" fill={night ? "#1a2233" : "#5f7d73"} />
                            <path d="M0 280 L120 230 L230 270 L340 220 L470 268 L640 236 L640 400 L0 400 Z" fill={night ? "#141a26" : "#4b685c"} />
                            {[40, 110, 180, 470, 540, 600].map((x, i) => (
                                <g key={x}>
                                    <rect x={x - 3} y={258 - (i % 3) * 8} width="6" height="40" fill={night ? "#0c1018" : "#3a2f24"} />
                                    <circle cx={x} cy={248 - (i % 3) * 8} r={20 + (i % 2) * 6} fill={night ? "#101722" : "#2f5a43"} />
                                </g>
                            ))}
                            {night && [150, 200, 430, 500].map((x) => (
                                <g key={x}>
                                    <rect x={x} y="250" width="34" height="60" fill="#1d2433" />
                                    <rect x={x + 6} y="260" width="8" height="10" fill="#f5c46a" />
                                    <rect x={x + 20} y="276" width="8" height="10" fill="#f5c46a" />
                                </g>
                            ))}
                        </g>

                        {/* 地面 */}
                        <rect y="320" width="640" height="80" fill={night ? "#0b0e15" : "#384d40"} />

                        {/* 被写体（ピントが合っている・ぼけない） */}
                        <g data-testid="exposure-subject">
                            <ellipse cx="320" cy="388" rx="58" ry="8" fill="#000" opacity="0.35" />
                            <rect x="294" y="262" width="52" height="126" rx="22" fill={night ? "#8a6a52" : "#a5765a"} />
                            <circle cx="320" cy="238" r="26" fill={night ? "#c6a189" : "#e2b99c"} />
                            <path d="M294 236 Q320 196 346 236 Q332 222 320 222 Q308 222 294 236 Z" fill="#3a2a22" />
                        </g>

                        {/* 飛ぶ鳥（シャッターで流れる） */}
                        <g filter={`url(#${ids.motion})`} data-testid="exposure-bird">
                            <path d="M470 110 q14 -16 28 0 q14 -16 28 0 q-14 -6 -28 6 q-14 -12 -28 -6 Z" fill={night ? "#d9dbe2" : "#1e1e1e"} />
                        </g>
                    </g>

                    {/* ざらつき（ISO） */}
                    {fx.grain > 0 && (
                        <rect width="640" height="400" filter={`url(#${ids.grain})`} opacity={fx.grain.toFixed(3)} style={{ mixBlendMode: "overlay" }} data-testid="exposure-grain" />
                    )}
                </svg>
            </div>

            {/* 露出計（−3〜+3 段・⅓ 段の目盛り）。針は飾りで、同じことを文字でも言う */}
            <div className="mt-4">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="text-text-2" style={{ fontSize: "12px" }}>露出計</span>
                    <span className={`font-semibold tabular-nums ${Math.abs(offset) < 1 / 6 ? "text-white" : "text-accent"}`} style={{ fontSize: "15px" }} data-testid="exposure-reading">
                        {reading}{pegged ? "（振り切れ）" : ""}
                    </span>
                </div>
                <div className="relative mt-2 h-8" aria-hidden="true">
                    <div className="absolute inset-x-0 top-4 h-px bg-line-strong" />
                    {Array.from({ length: METER_LIMIT * 6 + 1 }, (_, i) => {
                        const whole = i % 3 === 0; // 1段ごとの長い目盛り。間は ⅓ 段
                        return (
                            <div key={i} className="absolute top-2" style={{ left: `${(i / (METER_LIMIT * 6)) * 100}%`, transform: "translateX(-50%)" }}>
                                <div className={whole ? "w-px h-4 bg-text-2 mx-auto" : "w-px h-2 mt-1 bg-text-3 mx-auto"} />
                            </div>
                        );
                    })}
                    <div
                        className="absolute top-0 w-0.5 h-8 bg-accent motion-safe:transition-[left] motion-safe:duration-150"
                        style={{ left: `${meterPosition(offset) * 100}%`, transform: "translateX(-50%)" }}
                        data-testid="exposure-needle"
                    />
                </div>
                <div className="flex justify-between text-text-3 tabular-nums" style={{ fontSize: "12px" }} aria-hidden="true">
                    <span>−3</span><span>−2</span><span>−1</span><span>0</span><span>＋1</span><span>＋2</span><span>＋3</span>
                </div>
            </div>

            {/* 操作 */}
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div>
                    <label htmlFor={ids.ap} className="flex items-baseline justify-between text-text-2" style={{ fontSize: "13px" }}>
                        F値 <strong className="text-white tabular-nums" style={{ fontSize: "18px" }}>{aperture.label}</strong>
                    </label>
                    <input
                        id={ids.ap}
                        type="range"
                        min={0}
                        max={APERTURES.length - 1}
                        step={1}
                        value={apIdx}
                        aria-valuetext={aperture.label}
                        onChange={(e) => setApIdx(Number(e.target.value))}
                        className="w-full min-h-[44px] accent-accent"
                    />
                </div>
                <div>
                    <label htmlFor={ids.sh} className="flex items-baseline justify-between text-text-2" style={{ fontSize: "13px" }}>
                        シャッター <strong className="text-white tabular-nums" style={{ fontSize: "18px" }}>{shutter.label}</strong>
                    </label>
                    <input
                        id={ids.sh}
                        type="range"
                        min={0}
                        max={SHUTTERS.length - 1}
                        step={1}
                        value={shIdx}
                        disabled={mode === "A"}
                        aria-valuetext={mode === "A" ? `${shutter.label}（カメラが選ぶ）` : shutter.label}
                        aria-describedby={mode === "A" ? `${ids.sh}-auto` : undefined}
                        onChange={(e) => setManualShIdx(Number(e.target.value))}
                        className="w-full min-h-[44px] accent-accent disabled:opacity-50"
                    />
                    {mode === "A" && (
                        <p id={`${ids.sh}-auto`} className="m-0 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                            A モードでは、明るさに合わせてカメラが選びます
                        </p>
                    )}
                </div>
                <div>
                    <label htmlFor={ids.iso} className="flex items-baseline justify-between text-text-2" style={{ fontSize: "13px" }}>
                        ISO 感度 <strong className="text-white tabular-nums" style={{ fontSize: "18px" }}>{iso.label}</strong>
                    </label>
                    <input
                        id={ids.iso}
                        type="range"
                        min={0}
                        max={ISOS.length - 1}
                        step={1}
                        value={isoIdx}
                        aria-valuetext={iso.label}
                        onChange={(e) => setIsoIdx(Number(e.target.value))}
                        className="w-full min-h-[44px] accent-accent"
                    />
                </div>
            </div>

            <label htmlFor={ids.hand} className="mt-3 inline-flex items-center gap-2 min-h-[44px] text-text-2 cursor-pointer" style={{ fontSize: "14px" }}>
                <input id={ids.hand} type="checkbox" checked={handheld} onChange={(e) => setHandheld(e.target.checked)} className="w-5 h-5 accent-accent" />
                手持ちで撮る（外すと三脚）
            </label>

            <p className="m-0 mt-3 text-white" style={{ fontSize: "14px", lineHeight: "22px" }} aria-live="polite" data-testid="exposure-summary">
                {summary}
            </p>
        </section>
    );
}
