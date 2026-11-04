"use client";

/**
 * 撮影地の一括修正（1回きり）。owner 本人がログインしたまま押す。
 * 送るのは既存の `PUT /photos/{id}` に `{ location }` だけ（サーバー・DB は触らない）。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/context";
import { useLoginRedirect } from "../../../../lib/hooks/useLoginRedirect";
import { LOCATION_FIXES, initialStatus, applyFixes, type RowStatus, type Current, type FetchLike } from "./fixes";

const LABEL: Record<RowStatus, string> = {
    pending: "未反映",
    done: "反映しました",
    skipped: "済み",
    foreign: "対象外",
    running: "反映中…",
    failed: "失敗",
};

export default function FixLocationsPage() {
    const { isAuthenticated, loading } = useAuth();
    useLoginRedirect(!loading && !isAuthenticated);

    const [loadState, setLoadState] = useState<"loading" | "ok" | "failed">("loading");
    const [loadError, setLoadError] = useState("");
    const [current, setCurrent] = useState<Record<string, string>>({});
    const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
    const [messages, setMessages] = useState<Record<string, string>>({});
    const [running, setRunning] = useState(false);
    // state は次の描画まで古いので、連打はこちらで弾く
    const runningRef = useRef(false);

    const load = useCallback(async () => {
        setLoadState("loading");
        setLoadError("");
        try {
            const { userFetch, readApiError } = await import("../../../../lib/utils/api");
            const res = await userFetch("/user/photos");
            if (!res.ok) {
                setLoadError(await readApiError(res, "写真の一覧を読み込めませんでした"));
                setLoadState("failed");
                return;
            }
            const rows = await res.json() as unknown;
            if (!Array.isArray(rows)) {
                setLoadError("写真の一覧を読み込めませんでした");
                setLoadState("failed");
                return;
            }
            const byId = new Map<string, Current>();
            for (const r of rows as { id?: unknown; location?: unknown }[]) {
                if (typeof r?.id === "string") byId.set(r.id, { location: typeof r.location === "string" ? r.location : "" });
            }
            const cur: Record<string, string> = {};
            const st: Record<string, RowStatus> = {};
            for (const fix of LOCATION_FIXES) {
                const c = byId.get(fix.id) ?? null;
                cur[fix.id] = c ? c.location : "";
                st[fix.id] = initialStatus(fix, c);
            }
            setCurrent(cur);
            setStatuses(st);
            setMessages({});
            setLoadState("ok");
        } catch (e) {
            const { sessionErrorMessage } = await import("../../../../lib/utils/api");
            setLoadError(sessionErrorMessage(e) ?? "写真の一覧を読み込めませんでした");
            setLoadState("failed");
        }
    }, []);

    useEffect(() => {
        if (!loading && isAuthenticated) void load();
    }, [loading, isAuthenticated, load]);

    const targets = LOCATION_FIXES.filter((f) => statuses[f.id] === "pending" || statuses[f.id] === "failed");

    const run = async () => {
        if (runningRef.current || targets.length === 0) return;
        runningRef.current = true;
        setRunning(true);
        try {
            const { userFetch, readApiError } = await import("../../../../lib/utils/api");
            const put: FetchLike = async (path, init) => {
                const res = await userFetch(path, init);
                return { ok: res.ok, status: res.status, error: res.ok ? undefined : await readApiError(res, "") };
            };
            await applyFixes(
                LOCATION_FIXES,
                statuses,
                put,
                (r) => {
                    setStatuses((s) => ({ ...s, [r.id]: r.status }));
                    setMessages((m) => ({ ...m, [r.id]: r.message ?? "" }));
                    if (r.status === "done") {
                        const fix = LOCATION_FIXES.find((f) => f.id === r.id);
                        if (fix) setCurrent((c) => ({ ...c, [r.id]: fix.location }));
                    }
                },
                (id) => setStatuses((s) => ({ ...s, [id]: "running" })),
            );
        } finally {
            runningRef.current = false;
            setRunning(false);
        }
    };

    if (loading || !isAuthenticated) {
        return <main className="min-h-screen bg-bg text-white" />;
    }

    const failedCount = LOCATION_FIXES.filter((f) => statuses[f.id] === "failed").length;

    return (
        <main className="min-h-screen bg-bg text-white">
            <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
                <div>
                    <p className="text-[11px] tracking-widest uppercase text-accent mb-2">1回きりの作業</p>
                    <h1 className="text-2xl font-semibold">撮影地の一括修正</h1>
                </div>

                <p className="text-sm text-white/80 leading-relaxed">
                    下の表の {targets.length} 枚について、撮影地だけを新しい値に書き換えます（全 {LOCATION_FIXES.length} 枚のうち、
                    「済み」「対象外」は送りません）。題・説明・タグ・日付・公開範囲などほかの項目には触りません。
                    1枚ずつ順に保存し、途中で失敗しても、もう一度押すと続きから再開します。
                </p>
                <p className="text-sm text-white/60 leading-relaxed">
                    撮影地に合わせて、地名から補った地図の座標は取り除かれます（地図に出る場所は、あとで補い直されます）。
                    保存後の静的な頁は、次の再ビルドで入れ替わります。
                </p>

                {loadState === "loading" && <p className="text-sm text-white/60">読み込み中…</p>}
                {loadState === "failed" && (
                    <div className="space-y-3">
                        <p role="alert" className="text-sm text-danger">{loadError}</p>
                        <button type="button" onClick={() => void load()} className="min-h-[44px] px-4 rounded-xl ring-1 ring-inset ring-white/15 text-sm">
                            読み込み直す
                        </button>
                    </div>
                )}

                {loadState === "ok" && (
                    <>
                        <div>
                            <button
                                type="button"
                                onClick={() => void run()}
                                disabled={running || targets.length === 0}
                                className="min-h-[44px] w-full rounded-xl bg-accent-fill text-ink text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {running ? "反映しています…" : targets.length === 0 ? "反映するものはありません" : `${targets.length} 枚の撮影地を反映する`}
                            </button>
                            {failedCount > 0 && !running && (
                                <p role="alert" className="mt-2 text-sm text-danger">
                                    {failedCount} 枚で失敗しました。表の理由を見て、もう一度押すと失敗した分だけやり直します。
                                </p>
                            )}
                        </div>

                        <ul className="space-y-2">
                            {LOCATION_FIXES.map((fix) => {
                                const st = statuses[fix.id];
                                return (
                                    <li key={fix.id} className="rounded-2xl bg-white/[0.03] ring-1 ring-line p-4 space-y-1">
                                        <div className="flex items-baseline justify-between gap-3">
                                            <span className="text-sm font-medium">{fix.title}</span>
                                            <span className={`text-xs shrink-0 ${st === "failed" ? "text-danger" : st === "done" || st === "skipped" ? "text-accent" : "text-white/60"}`}>
                                                {LABEL[st]}
                                            </span>
                                        </div>
                                        <p className="text-xs text-white/60">今: {current[fix.id] || "（空）"}</p>
                                        <p className="text-xs text-white/90">新: {fix.location}</p>
                                        {messages[fix.id] && <p role="alert" className="text-xs text-danger">{messages[fix.id]}</p>}
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}
            </div>
        </main>
    );
}
