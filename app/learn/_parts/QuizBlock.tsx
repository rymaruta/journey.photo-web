"use client";

// app/learn/_parts/QuizBlock.tsx
//
// **章の終わりの確認クイズ**（2026-11-04）。選ぶとその場で正誤と理由が出る（JS が無ければ答えと理由を
// 最初から出す＝`<noscript>` ではなく、初期表示を「答えあり」にして読めるようにする）。
// 色だけで正誤を伝えない（記号「○／×」と文字も出す）。点数は記録しない（端末にも送らない）。

import React from "react";
import type { QuizItem } from "@/lib/data/learn/chapterTypes";

export default function QuizBlock({ items }: { items: QuizItem[] }) {
    const [picked, setPicked] = React.useState<Record<number, number>>({});
    const [ready, setReady] = React.useState(false);
    // 書き出した HTML（JS 前）では答えを見せる。載ったあとは自分で選ぶまで伏せる
    React.useEffect(() => setReady(true), []);
    const score = Object.entries(picked).filter(([i, c]) => items[Number(i)]?.answer === c).length;
    const answered = Object.keys(picked).length;
    return (
        <div className="mt-4 flex flex-col gap-4" data-testid="learn-quiz">
            {items.map((q, qi) => {
                const choice = picked[qi];
                const revealed = !ready || choice !== undefined;
                return (
                    <fieldset key={q.q} className="m-0 rounded-2xl bg-surface ring-1 ring-line p-4 min-w-0">
                        <legend className="px-1 text-white font-semibold" style={{ fontSize: "15px", lineHeight: "24px" }}>
                            <span className="text-accent tabular-nums mr-2">Q{qi + 1}</span>{q.q}
                        </legend>
                        <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-2">
                            {q.choices.map((c, ci) => {
                                const isAnswer = ci === q.answer;
                                const isPicked = choice === ci;
                                const mark = revealed ? (isAnswer ? "○" : isPicked ? "×" : "") : "";
                                return (
                                    <li key={c}>
                                        <button
                                            type="button"
                                            disabled={ready && choice !== undefined}
                                            onClick={() => setPicked((p) => ({ ...p, [qi]: ci }))}
                                            aria-pressed={isPicked}
                                            className={`w-full text-left rounded-xl px-4 min-h-[48px] py-2 ring-1 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${
                                                revealed && isAnswer ? "bg-accent-soft ring-accent text-white"
                                                    : revealed && isPicked ? "bg-surface-2 ring-line-strong text-white"
                                                        : "bg-bg ring-line text-chip-text hover:bg-surface-2"}`}
                                            style={{ fontSize: "15px", lineHeight: "22px", touchAction: "manipulation" }}
                                        >
                                            <span className="inline-block w-5 text-accent font-semibold" aria-hidden="true">{mark}</span>
                                            {c}
                                            {revealed && isAnswer && <span className="sr-only">（正解）</span>}
                                            {revealed && isPicked && !isAnswer && <span className="sr-only">（選んだ答え・不正解）</span>}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {revealed && (
                            <p className="m-0 mt-3 text-text-2" style={{ fontSize: "14px", lineHeight: "24px" }} data-testid="learn-quiz-why">
                                <span className="text-accent font-semibold">解説　</span>{q.why}
                            </p>
                        )}
                    </fieldset>
                );
            })}
            {ready && answered === items.length && (
                <p className="m-0 text-white font-semibold" style={{ fontSize: "15px" }} role="status">
                    {items.length} 問中 {score} 問正解
                </p>
            )}
        </div>
    );
}
