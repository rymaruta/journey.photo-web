"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { userPublicFetch, sessionErrorMessage } from "../../lib/utils/api";
import { ROUTES } from "../../lib/routes";
import { LoadingState } from "../components/StateViews";

/**
 * プロフィールの QR の着地点（`/qr?t=<合図>`・札 journey.photo-ios#545・2026-11-12）。
 *
 * QR の中身は `https://journey-photo.com/qr?t=<合図>`。合図は本人が「QR コードを更新」すると替わり、
 * 前の QR は使えなくなる（LINE と同じ）。この頁は `GET /qr/{合図}`（ログイン不要）で人を引き、
 * 使えればその人の頁へ送る。使えなければ理由を1つの言葉で出す。
 *
 * - **クエリの形**（`/qr/<合図>` ではない）: サイトは静的な書き出しで、列挙していないパスは開けない
 *   （共同アルバムの招待 `/j?t=` と同じ形）
 * - 2026-11-12 判断: 設計の案は `/q?t=` だったが、`/q` は今日の一問の頁。同じ頁に2つの役を持たせず `/qr` に置いた
 * - 「期限切れ」「取り消し」「無い」を分けない——どれも相手に新しい QR を出してもらう以外に手が無い
 * - 主ボタンは写真の無い画面なので真鍮の塗りに墨（デザインの板の決まり・招待の頁と同じ）
 */

const QR_UNUSABLE_TITLE = "この QR コードは使えません";
const QR_UNUSABLE_HINT = "相手に新しい QR コードを出してもらってください";
const QR_FAILED = "QR コードを確かめられませんでした";

/** 合図の形（サーバーの `isValidQrToken` と同じ）。形の悪いものは口を叩かずに「使えません」 */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

type View =
    | { kind: "loading" }
    | { kind: "unusable" }
    | { kind: "failed"; message: string };

function QrLanding() {
    const token = useSearchParams().get("t") ?? "";
    const router = useRouter();
    const [view, setView] = React.useState<View>({ kind: "loading" });
    const [attempt, setAttempt] = React.useState(0);
    /** 引けた人の頁。**送るのは別の効果で。** 引く効果の合図に router を入れると、router が替わるたびに
     *  引き直して「読み込み中 → 引く → 読み込み中…」が止まらない（試験の模型で実際に止まらなかった） */
    const [target, setTarget] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (target) router.replace(target);
    }, [target, router]);

    React.useEffect(() => {
        if (!TOKEN_RE.test(token)) {
            setView({ kind: "unusable" });
            return;
        }
        let alive = true;
        setView({ kind: "loading" });
        (async () => {
            try {
                const res = await userPublicFetch(`/qr/${encodeURIComponent(token)}`);
                if (!alive) return;
                const data = await res.json().catch(() => ({})) as { userId?: unknown; error?: unknown };
                if (!alive) return;
                if (res.ok && typeof data.userId === "string" && data.userId) {
                    setTarget(ROUTES.USER_PROFILE(data.userId));
                    return;
                }
                // **うちの口の 404（`{ error }` つき）だけを「使えません」と読む。** 口がまだ無いときに
                // API Gateway が返す 404（`{ message }`）まで「使えません」にすると、使える QR を使えないと言う
                if (res.status === 404 && typeof data.error === "string") {
                    setView({ kind: "unusable" });
                    return;
                }
                setView({ kind: "failed", message: QR_FAILED });
            } catch (e) {
                if (!alive) return;
                setView({ kind: "failed", message: sessionErrorMessage(e) ?? QR_FAILED });
            }
        })();
        return () => { alive = false; };
    }, [token, attempt]);

    if (view.kind === "loading") {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center px-4">
                <h1 className="sr-only">プロフィールの QR コード</h1>
                <div className="w-full max-w-sm"><LoadingState kind="rows" /></div>
            </main>
        );
    }

    if (view.kind === "failed") {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center px-4">
                <div className="text-center max-w-sm">
                    <h1 className="sr-only">プロフィールの QR コード</h1>
                    <p className="text-sm text-white/85" role="alert">{view.message}</p>
                    <button
                        type="button"
                        onClick={() => setAttempt((n) => n + 1)}
                        className="mt-5 rounded-full bg-accent-fill text-ink text-sm px-5 py-2.5"
                        style={{ minHeight: 44 }}
                    >
                        もう一度
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-bg text-white flex items-center justify-center px-4">
            <div className="text-center max-w-sm flex flex-col items-center">
                {/* 使えない QR の印（斜線の入った QR・資料 第10章の模型と同じ形） */}
                <span className="w-14 h-14 rounded-full border border-white/20 grid place-items-center text-white/80 mb-4" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="4" width="6" height="6" rx="1" />
                        <rect x="14" y="4" width="6" height="6" rx="1" />
                        <rect x="4" y="14" width="6" height="6" rx="1" />
                        <path d="M14 14h2v2M18 18h2v2M3 21L21 3" />
                    </svg>
                </span>
                <h1 className="font-serif text-xl leading-snug">{QR_UNUSABLE_TITLE}</h1>
                <p className="text-sm text-white/70 mt-2">{QR_UNUSABLE_HINT}</p>
                <Link
                    href={ROUTES.HOME}
                    prefetch={false}
                    className="inline-flex items-center justify-center mt-6 rounded-full bg-accent-fill text-ink text-sm px-6 py-2.5"
                    style={{ minHeight: 44 }}
                >
                    みんなの写真を見る
                </Link>
            </div>
        </main>
    );
}

export default function QrPage() {
    // `useSearchParams` は Suspense の中で使う（静的な書き出しの前提・`/j` と同じ形）。
    // **事前描画で焼かれるのはこの fallback** なので、見出しと main をここにも置く
    return (
        <Suspense fallback={
            <main className="min-h-screen bg-bg text-white flex items-center justify-center px-4">
                <h1 className="sr-only">プロフィールの QR コード</h1>
                <p className="text-sm text-white/60">読み込み中…</p>
            </main>
        }>
            <QrLanding />
        </Suspense>
    );
}
