"use client";

// app/today/TodayHub.tsx
//
// **「現在地で調べる」**（/today）。ボタンを押したときだけ位置を聞く。
//
// ## 約束（頁にも書いてある。見張りは `app/today/__tests__/hub.test.tsx`）
//
//   - `navigator.geolocation` は**ボタンを押したときだけ**呼ぶ（開いただけでは聞かない）
//   - 座標はこのコンポーネントの state の中だけ。サーバーにも GA4 にも送らず、保存せず、URL にも入れない
//   - 近くのスポットの索引（`/app/data/nearby.json`）は**ボタンを押して位置が取れたあと**にだけ読む。
//     読む URL に座標は付かない（全員同じ静的ファイルで、近い順の並べ替えは端末の中）
//   - 断られた・取れない・日本の外のときは、県を選ぶ一覧（頁の下の47県）に倒す
//
// 計測（`track`）は使わない。このファイルは `lib/utils/analytics` を import しない（試験が見る）。

import React from "react";
import Link from "next/link";
import { prefectureBySlug } from "@/lib/data/prefectures";
import { ROUTES } from "@/lib/routes";
import { distanceLabel } from "@/lib/utils/journey";
import { inJapan, isNearbyRows, nearestSpots, type NearbyHit } from "@/lib/utils/todayLight";
import TodayLightPanel from "./TodayLightPanel";

/** 近くのスポットの索引。全員同じ静的ファイル（`app/app/data/nearby.json/route.ts`） */
export const NEARBY_INDEX_URL = "/app/data/nearby.json";
const SHOW = 12;
/** 近いスポットでもこれより遠いなら、日本の外にいると見なす（日本の外枠は粗い四角で、ソウルなども入る） */
const FAR_KM = 200;

type State =
    | { kind: "idle" }
    | { kind: "locating" }
    | { kind: "error"; reason: "denied" | "unavailable" | "timeout" | "unsupported" }
    | { kind: "outside" }
    | { kind: "done"; coords: { lat: number; lng: number }; hits: NearbyHit[] | null };

const ERROR_TEXT: Record<"denied" | "unavailable" | "timeout" | "unsupported", string> = {
    denied: "位置情報の利用が許可されませんでした。下の一覧から県を選んでください。",
    unavailable: "現在地を取得できませんでした。下の一覧から県を選んでください。",
    timeout: "現在地の取得に時間がかかりすぎました。もう一度試すか、下の一覧から県を選んでください。",
    unsupported: "このブラウザでは現在地を使えません。下の一覧から県を選んでください。",
};

export default function TodayHub() {
    const [state, setState] = React.useState<State>({ kind: "idle" });
    const alive = React.useRef(true);
    React.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    const locate = () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
            setState({ kind: "error", reason: "unsupported" });
            return;
        }
        setState({ kind: "locating" });
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                if (!alive.current) return;
                const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                if (!inJapan(coords)) {
                    setState({ kind: "outside" });
                    return;
                }
                // 位置が取れたあとにだけ索引を読む。URL に座標は付かない
                let hits: NearbyHit[] | null = null;
                try {
                    const res = await fetch(NEARBY_INDEX_URL);
                    if (res.ok) {
                        const rows: unknown = await res.json();
                        if (isNearbyRows(rows)) hits = nearestSpots(rows, coords, SHOW);
                    }
                } catch {
                    hits = null;
                }
                if (!alive.current) return;
                setState(hits && hits.length > 0 && hits[0].km > FAR_KM ? { kind: "outside" } : { kind: "done", coords, hits });
            },
            (err) => {
                if (!alive.current) return;
                const reason = err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable";
                setState({ kind: "error", reason });
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
        );
    };

    const busy = state.kind === "locating";

    return (
        <div data-testid="today-hub">
            <button
                type="button"
                onClick={locate}
                disabled={busy}
                aria-describedby="today-privacy"
                data-testid="today-locate"
                className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent-fill px-6 font-semibold text-ink transition-opacity disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                style={{ fontSize: "15px", touchAction: "manipulation" }}
            >
                {busy ? "現在地を取得しています" : "現在地で調べる"}
            </button>
            <p id="today-privacy" className="m-0 mt-3 max-w-2xl text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>
                位置情報は、このボタンを押したときだけ、お使いのブラウザの中で使います。サーバーにも解析（GA4）にも送らず、保存もしません。
            </p>

            <div aria-live="polite" className="mt-6">
                {state.kind === "error" && (
                    <p className="m-0 text-text-2" style={{ fontSize: "15px", lineHeight: "24px" }} data-testid="today-error">{ERROR_TEXT[state.reason]}</p>
                )}
                {state.kind === "outside" && (
                    <p className="m-0 text-text-2" style={{ fontSize: "15px", lineHeight: "24px" }} data-testid="today-outside">
                        日本国内の位置ではないようです。この頁は日本の時計で日本の中だけを扱います。下の一覧から県を選んでください。
                    </p>
                )}
                {state.kind === "done" && <Result coords={state.coords} hits={state.hits} />}
            </div>
        </div>
    );
}

function Result({ coords, hits }: { coords: { lat: number; lng: number }; hits: NearbyHit[] | null }) {
    const nearestPref = hits && hits.length > 0 ? prefectureBySlug(hits[0].pref) : null;
    return (
        <div data-testid="today-result">
            <h2 className="m-0 mb-3 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.3" }}>現在地の今日の光</h2>
            <TodayLightPanel coords={coords} testId="today-here" />

            <h2 className="m-0 mt-8 mb-3 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "1.3" }}>近くの観光スポット</h2>
            {hits && hits.length > 0 ? (
                <>
                    <ul className="m-0 p-0 list-none divide-y divide-line/60 rounded-2xl bg-surface ring-1 ring-line" data-testid="today-nearby">
                        {hits.map((h) => (
                            <li key={h.slug}>
                                <Link href={`/spots/${h.slug}`} prefetch={false}
                                      className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2 text-white hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                                      style={{ fontSize: "15px", lineHeight: "22px" }}>
                                    <span className="min-w-0">
                                        <span className="block wrap-anywhere">{h.name}</span>
                                        {h.kind && <span className="block text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }}>{h.kind}</span>}
                                    </span>
                                    <span className="flex-shrink-0 font-sans tabular-nums text-text-2" style={{ fontSize: "13px" }}>{distanceLabel(h.km, true)}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <p className="m-0 mt-2 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                        距離は現在地からの直線距離です（スポットの座標は約1km に丸めてあります）。
                    </p>
                </>
            ) : (
                <p className="m-0 text-text-2" style={{ fontSize: "15px", lineHeight: "24px" }} data-testid="today-nearby-failed">
                    近くのスポットの一覧を読み込めませんでした。下の一覧から県を選んでください。
                </p>
            )}
            {nearestPref && (
                <p className="m-0 mt-4" style={{ fontSize: "13px", lineHeight: "20px" }}>
                    <Link href={ROUTES.TODAY_PREF(nearestPref.slug)} prefetch={false}
                          className="inline-flex min-h-[44px] items-center text-text-2 hover:text-white">
                        {nearestPref.name}の月ごとの日の出・日の入りの表を見る
                        <span aria-hidden="true" className="ml-1">›</span>
                    </Link>
                </p>
            )}
        </div>
    );
}
