"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { userPublicFetch, userFetch, readApiError, sessionErrorMessage } from "../../lib/utils/api";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { ROUTES } from "../../lib/routes";
import { LoadingState } from "../components/StateViews";
import { tripInviteLine, type InviteTrip } from "../../lib/utils/tripInvite";

/**
 * 旅行プランへのお誘い（`/t?t=<トークン>`・2026-11-12・資料「SNS をもっと SNS に」2b）。
 *
 * 形は共同アルバムの招待（`/j`）と同じ: **見るのはログイン不要、参加はログイン**。
 * 見せるのは題・日付・人数・場所の数だけ（サーバーの `GET /trip-invites/{token}` がそれしか返さない。
 * 仲間の名前・日程の中身・会話は、参加してから旅行プランの頁で見る）。
 * 参加すると、そのプランは旅行プランの頁（Web）とアプリの旅行プランの一覧に並ぶ。
 */

function TripInviteView() {
    const token = useSearchParams().get("t") ?? "";
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { showToast } = useToast();
    const [state, setState] = React.useState<"loading" | "ok" | "error">("loading");
    const [error, setError] = React.useState("");
    const [trip, setTrip] = React.useState<InviteTrip | null>(null);
    const [joined, setJoined] = React.useState(false);
    const [joining, setJoining] = React.useState(false);

    React.useEffect(() => {
        if (!token) {
            setState("error");
            setError("招待リンクが正しくありません");
            return;
        }
        let alive = true;
        (async () => {
            try {
                const res = await userPublicFetch(`/trip-invites/${encodeURIComponent(token)}`);
                if (!alive) return;
                if (!res.ok) {
                    // 理由をそのまま出す（期限が切れた・取り消された・見つからない）
                    setError(await readApiError(res, "この招待リンクは開けませんでした"));
                    setState("error");
                    return;
                }
                const data = await res.json() as { trip?: InviteTrip };
                if (!alive) return;
                if (!data.trip || typeof data.trip.title !== "string") {
                    setError("この招待リンクは開けませんでした");
                    setState("error");
                    return;
                }
                setTrip(data.trip);
                setState("ok");
            } catch (e) {
                if (!alive) return;
                setError(sessionErrorMessage(e) ?? "この招待リンクを開けませんでした");
                setState("error");
            }
        })();
        return () => { alive = false; };
    }, [token]);

    const join = React.useCallback(async () => {
        if (joining) return;
        setJoining(true);
        try {
            const res = await userFetch(`/trip-invites/${encodeURIComponent(token)}/join`, { method: "POST" });
            if (!res.ok) {
                showToast(await readApiError(res, "参加できませんでした"), "error");
                return;
            }
            setJoined(true);
            const data = await res.json().catch(() => ({})) as { already?: boolean };
            showToast(data.already ? "すでにこの旅行プランの仲間です" : "旅行プランに参加しました", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "参加できませんでした", "error");
        } finally {
            setJoining(false);
        }
    }, [token, joining, showToast]);

    if (state === "loading") {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center px-4">
                <h1 className="sr-only">旅行プランへのお誘い</h1>
                <div className="w-full max-w-sm"><LoadingState kind="rows" /></div>
            </main>
        );
    }

    if (state === "error" || !trip) {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center px-4">
                <div className="text-center max-w-sm">
                    <h1 className="sr-only">旅行プランへのお誘い</h1>
                    <p className="text-sm text-white/85" role="alert">{error}</p>
                    <Link href={ROUTES.HOME} prefetch={false} className="inline-block mt-4 text-sm underline decoration-white/40 underline-offset-2">
                        トップへ
                    </Link>
                </div>
            </main>
        );
    }

    const next = `/t?t=${token}`;
    return (
        <main className="min-h-screen bg-bg text-white px-4 py-8">
            <div className="max-w-md mx-auto text-center">
                <p className="text-[11px] tracking-widest text-accent">旅行プランへのお誘い</p>
                <h1 className="font-serif text-2xl mt-2">{trip.title || "旅行プラン"}</h1>
                <p className="text-sm text-white/70 mt-2 tabular-nums">{tripInviteLine(trip)}</p>

                <div className="mt-8">
                    {joined ? (
                        <>
                            <Link
                                href={ROUTES.TRIPS}
                                prefetch={false}
                                className="inline-flex items-center justify-center rounded-full bg-accent-fill text-ink text-sm font-semibold px-6"
                                style={{ minHeight: 44 }}
                            >
                                旅行プランを開く
                            </Link>
                            <p className="text-xs text-white/60 mt-3">アプリの旅行プランにも並びます。日程を足したり、仲間と話したりできます。</p>
                        </>
                    ) : authLoading ? (
                        <p className="text-sm text-white/60">…</p>
                    ) : isAuthenticated ? (
                        <button
                            type="button"
                            onClick={join}
                            aria-disabled={joining}
                            className="rounded-full bg-accent-fill text-ink text-sm font-semibold px-8"
                            style={{ minHeight: 44 }}
                        >
                            {joining ? "参加しています…" : "参加する"}
                        </button>
                    ) : (
                        <>
                            <Link
                                href={`${ROUTES.LOGIN}?next=${encodeURIComponent(next)}`}
                                prefetch={false}
                                className="inline-flex items-center justify-center rounded-full bg-accent-fill text-ink text-sm font-semibold px-6"
                                style={{ minHeight: 44 }}
                            >
                                ログインして参加する
                            </Link>
                            <p className="text-xs text-white/60 mt-3">
                                はじめての方は{" "}
                                <Link
                                    href={`${ROUTES.SIGNUP}?next=${encodeURIComponent(next)}`}
                                    prefetch={false}
                                    className="underline hover:text-white transition-colors"
                                >
                                    新規登録
                                </Link>
                                。
                            </p>
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}

export default function TripInvitePage() {
    return (
        <Suspense fallback={
            <main className="min-h-screen bg-bg text-white flex items-center justify-center px-4">
                <h1 className="sr-only">旅行プランへのお誘い</h1>
                <p className="text-sm text-white/60">読み込み中…</p>
            </main>
        }>
            <TripInviteView />
        </Suspense>
    );
}
