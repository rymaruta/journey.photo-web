import { useEffect } from "react";
import { userApiUrl } from "./utils/api";

/**
 * **写真の閲覧数を送る**（Web の写真の頁・札 journey.photo-ios#707・owner 承認 2026-11-23）。
 *
 * 写真の頁が**1秒以上見えたら**、`POST /photos/{id}/view`（未認証・`{"via":"web"}`）を `navigator.sendBeacon` で送る。
 *  - 同じ写真は、この端末で `VIEW_DEDUP_MS`（30分）以内なら送らない（`localStorage`。読めない・書けない端末でも頁は動く。
 *    そのときは同じタブの間だけ `sessionStorage`、それも無理なら覚えずに送る）
 *  - 本人（ログインしていて、写真の持ち主）のときは送らない。ログインの確かめが終わるまでは待つ
 *  - 圏外（`navigator.onLine === false`）では送らない（貯めない）
 *  - 頁が裏に回っている間は数えない（見えている時間だけ数える）
 * 数えるかどうか（公開・ストーリー・機械）はサーバーが決める（`api-user/src/photoViews.ts`）。
 */

export const VIEW_DEDUP_MS = 30 * 60_000;
/** 見えてから送るまで */
export const VIEW_DWELL_MS = 1_000;
/** 覚えておく写真の数（古い順に捨てる・控えが膨らまない） */
export const VIEW_MEMO_MAX = 200;
const KEY = "jp.photoViews.sent.v1";

type Memo = Record<string, number>;

function stores(): Storage[] {
    const out: Storage[] = [];
    try { if (typeof localStorage !== "undefined") out.push(localStorage); } catch { /* 使えない端末 */ }
    try { if (typeof sessionStorage !== "undefined") out.push(sessionStorage); } catch { /* 使えない端末 */ }
    return out;
}

function readMemo(): Memo {
    for (const s of stores()) {
        try {
            const raw = s.getItem(KEY);
            if (!raw) continue;
            const v = JSON.parse(raw) as unknown;
            if (v && typeof v === "object") return v as Memo;
        } catch { /* 壊れた控えは無いものとする */ }
    }
    return {};
}

function writeMemo(memo: Memo): void {
    const entries = Object.entries(memo).sort((a, b) => b[1] - a[1]).slice(0, VIEW_MEMO_MAX);
    const text = JSON.stringify(Object.fromEntries(entries));
    for (const s of stores()) {
        try { s.setItem(KEY, text); return; } catch { /* 満杯・禁止なら次へ */ }
    }
}

/** この写真を今送ってよいか（30分以内に送っていない） */
export function shouldSendView(memo: Memo, photoId: string, now: number): boolean {
    const last = memo[photoId];
    return !(typeof last === "number" && now - last >= 0 && now - last < VIEW_DEDUP_MS);
}

/** 送る条件（本人でない・ログインの確かめが済んだ・圏外でない） */
export function viewEligible(o: { isOwn: boolean; authLoading: boolean; online: boolean }): boolean {
    return !o.isOwn && !o.authLoading && o.online;
}

/** 送る（送れたら true）。30分の控えは送れたときだけ書く */
export function sendPhotoView(photoId: string, now = Date.now()): boolean {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
    const memo = readMemo();
    if (!shouldSendView(memo, photoId, now)) return false;
    let ok = false;
    try {
        // text/plain は前もっての問い合わせ（CORS の preflight）が要らない形。サーバーは本文を JSON として読む
        ok = navigator.sendBeacon(
            userApiUrl(`/photos/${encodeURIComponent(photoId)}/view`),
            new Blob([JSON.stringify({ via: "web" })], { type: "text/plain" }),
        );
    } catch {
        ok = false;
    }
    if (ok) writeMemo({ ...memo, [photoId]: now });
    return ok;
}

/**
 * 写真の頁で使う。見えている間に1秒たったら1回送る。写真が替わったら数え直す（モーダルで次の写真へ進む形）
 */
export function usePhotoViewBeacon(photoId: string | undefined, o: { isOwn: boolean; authLoading: boolean; enabled?: boolean }): void {
    const { isOwn, authLoading, enabled = true } = o;
    useEffect(() => {
        if (!photoId || !enabled) return;
        if (typeof document === "undefined" || typeof window === "undefined") return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let done = false;
        const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
        const arm = () => {
            stop();
            if (done || document.visibilityState === "hidden") return;
            timer = setTimeout(() => {
                timer = null;
                const online = typeof navigator === "undefined" || navigator.onLine !== false;
                if (!viewEligible({ isOwn, authLoading, online })) return;
                done = true;
                sendPhotoView(photoId);
            }, VIEW_DWELL_MS);
        };
        const onVisibility = () => (document.visibilityState === "hidden" ? stop() : arm());
        arm();
        document.addEventListener("visibilitychange", onVisibility);
        return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
    }, [photoId, isOwn, authLoading, enabled]);
}
