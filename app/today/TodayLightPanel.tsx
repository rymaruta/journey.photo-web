"use client";

// app/today/TodayLightPanel.tsx
//
// **今日の日の出・日の入り・ゴールデンアワー・ブルーアワー**（/today/<県> と /today の現在地）。
//
// 🔴 **今日の値は、開いたブラウザの今日の日付でクライアントが計算する。** 静的 HTML に書き出した日の値を
// 焼かない（週1回の再ビルドの間に日が進むので、焼くと昨日の値を今日として見せる）。
// 最初の描画（サーバーと水和）は日付を持たない骨格で、マウント後に日付を決めて計算する。
// タブを開いたまま日が替わっても、戻ってきたとき（visibilitychange / focus）に日付を見直す。
//
// 計算は `lightBlocksFor`（スポットの頁の「光の時刻」と同じ式・同じ文）。座標は props で受けるだけで、
// 通信も保存も計測もしない。

import React from "react";
import { todayIn } from "@/lib/utils/sunTimes";
import { lightBlocksFor, lightDateLabel, lightNote } from "@/lib/utils/spotLight";
import { TODAY_TIME_ZONE, dayLengthAt } from "@/lib/utils/todayLight";

export default function TodayLightPanel({ coords, testId = "today-light" }: {
    coords: { lat: number; lng: number };
    testId?: string;
}) {
    // null＝まだ日付を決めていない（サーバーと水和の最初の描画）
    const [ymd, setYmd] = React.useState<string | null>(null);

    React.useEffect(() => {
        const refresh = () => setYmd(todayIn(TODAY_TIME_ZONE));
        refresh();
        document.addEventListener("visibilitychange", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            document.removeEventListener("visibilitychange", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, []);

    const blocks = React.useMemo(() => (ymd ? lightBlocksFor(ymd, coords, TODAY_TIME_ZONE, true) : []), [ymd, coords]);
    const dayLength = React.useMemo(() => (ymd ? dayLengthAt(ymd, coords) : null), [ymd, coords]);

    if (!ymd) {
        return (
            <div data-testid={testId} data-ready="false" className="rounded-2xl bg-surface ring-1 ring-line p-5" aria-busy="true">
                <p className="m-0 text-text-2" style={{ fontSize: "15px", lineHeight: "24px" }}>今日の値を計算しています。</p>
                <noscript>
                    <p className="m-0 mt-2 text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>
                        今日の値の表示には JavaScript が要ります。下の月ごとの表は、そのままご覧になれます。
                    </p>
                </noscript>
            </div>
        );
    }

    if (blocks.length === 0) {
        return (
            <div data-testid={testId} data-ready="true" className="rounded-2xl bg-surface ring-1 ring-line p-5">
                <p className="m-0 text-text-2" style={{ fontSize: "15px", lineHeight: "24px" }}>今日の値を計算できませんでした。</p>
            </div>
        );
    }

    return (
        <div data-testid={testId} data-ready="true" data-ymd={ymd} className="rounded-2xl bg-surface ring-1 ring-line p-5">
            <p className="m-0 text-text-2 tabular-nums" style={{ fontSize: "13px", lineHeight: "18px" }} data-testid={`${testId}-date`}>
                {lightDateLabel(ymd, 0, ymd, true)}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2">
                {blocks.map((b) => (
                    <section key={b.title} aria-label={b.title}>
                        <h3 className="m-0 mb-1 font-serif font-bold text-white" style={{ fontSize: "18px", lineHeight: "26px" }}>{b.title}</h3>
                        <dl className="m-0">
                            {b.rows.map((r) => {
                                const sun = r.label === "日の出" || r.label === "日の入り";
                                return (
                                    <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-line/60 py-2">
                                        <dt className="text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>{r.label}</dt>
                                        <dd className="m-0 text-right font-sans tabular-nums text-white">
                                            <span style={sun ? { fontSize: "24px", lineHeight: "30px", fontWeight: 600 } : { fontSize: "15px", lineHeight: "22px" }}>{r.value}</span>
                                            {r.detail && <span className="block text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }}>方位 {r.detail}</span>}
                                        </dd>
                                    </div>
                                );
                            })}
                        </dl>
                    </section>
                ))}
            </div>
            {dayLength && (
                <p className="m-0 mt-4 text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }} data-testid={`${testId}-length`}>
                    昼の長さ（日の出から日の入りまで）<span className="ml-2 font-sans tabular-nums text-white" style={{ fontSize: "15px" }}>{dayLength}</span>
                </p>
            )}
            <p className="m-0 mt-3 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>{lightNote(TODAY_TIME_ZONE, true)}</p>
        </div>
    );
}
