// lib/utils/spotWants.ts
//
// **みんなの「行きたい」**（2026-11-11・撮影スポットを払うの②・サーバーは `api-user/src/spotWants.ts`）。
//
// ## 送る
//
// 右へ払った「行きたい」と、撮影スポットの頁の「行きたい」を、**端末ごとのでたらめな ID** と一緒に
// `POST /spots/wants` へ送る。名前・メール・利用者の ID は送らない（ログイン中も端末の ID だけ）。
// まとめて送る: 端末に貯めて5件ごと、頁を離れるとき（`pagehide`）に残りを送る。ひとつ戻した札は、
// まだ送っていなければ外す（送ったあとは、その月の数に入ったまま——月1回の数なので戻しても数え直さない）。
//
// ## 読む
//
// 毎日1回の集計が置く `/app/data/spot-wants.json`（今月の数が10以上の撮影スポットだけ・多い順・順位）。
// 無い・読めないときは何も出さない（数が無いことを「0」と言わない）。
//
// 端末の控えの読み書きは必ず try/catch（読めなければ送らないだけ）。

import React from "react";
import { userPublicFetch } from "./api";
import { spotSavedKey, SPOT_KEY_PREFIX } from "./savedSpotKey";

export const SPOT_WANTS_URL = "/app/data/spot-wants.json";
export const WANT_DEVICE_KEY = "jp-want-device";
export const WANT_QUEUE_KEY = "jp-want-queue";
/** 何件たまったら送るか */
export const WANT_BATCH = 5;
/** 1回に送る上限（サーバーの `MAX_PER_REQUEST`） */
export const WANT_SEND_MAX = 10;
const QUEUE_MAX = 40;

export type SpotWant = { slug: string; name: string; nameEn?: string; n: number; rank: number };
export type SpotWantsFile = { month: string; updatedAt: string; spots: SpotWant[] };

export function parseSpotWants(raw: unknown): SpotWantsFile | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.month !== "string" || !Array.isArray(o.spots)) return null;
    const spots: SpotWant[] = [];
    for (const r of o.spots) {
        const x = r as Record<string, unknown>;
        if (!x || typeof x.slug !== "string" || typeof x.n !== "number" || typeof x.rank !== "number") continue;
        // 10未満は配られない決まり。紛れ込んでも出さない
        if (x.n < 10) continue;
        spots.push({
            slug: x.slug, name: typeof x.name === "string" && x.name ? x.name : x.slug,
            ...(typeof x.nameEn === "string" && x.nameEn ? { nameEn: x.nameEn } : {}), n: x.n, rank: x.rank,
        });
    }
    return { month: o.month, updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "", spots };
}

let cache: Promise<SpotWantsFile | null> | null = null;

/** 今月の数（頁のあいだで1回だけ読む） */
export function loadSpotWants(): Promise<SpotWantsFile | null> {
    cache ??= (async () => {
        try {
            const res = await fetch(SPOT_WANTS_URL);
            if (!res.ok) return null;
            return parseSpotWants(await res.json());
        } catch {
            return null;
        }
    })();
    return cache;
}

/** 試験用 */
export function resetSpotWantsCache(): void {
    cache = null;
}

export function useSpotWants(): SpotWantsFile | null {
    const [file, setFile] = React.useState<SpotWantsFile | null>(null);
    React.useEffect(() => {
        let alive = true;
        void loadSpotWants().then((f) => { if (alive) setFile(f); });
        return () => { alive = false; };
    }, []);
    return file;
}

/** 「1,284」 */
export const wantCount = (n: number, en: boolean) => n.toLocaleString(en ? "en-US" : "ja-JP");

// ─────────────────────────────────────────────────────────────
// 送る
// ─────────────────────────────────────────────────────────────

function storage(): Storage | null {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
}

/** 端末のでたらめな ID（無ければ作る）。作れない・残せないなら null（送らない） */
export function wantDeviceId(): string | null {
    try {
        const s = storage();
        if (!s) return null;
        const have = s.getItem(WANT_DEVICE_KEY);
        if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
        const id = (globalThis.crypto?.randomUUID?.() ?? "").replace(/-/g, "");
        if (id.length < 16) return null;
        s.setItem(WANT_DEVICE_KEY, id);
        return id;
    } catch {
        return null;
    }
}

export function readWantQueue(): string[] {
    try {
        const list = JSON.parse(storage()?.getItem(WANT_QUEUE_KEY) ?? "[]");
        return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string" && v.startsWith(SPOT_KEY_PREFIX)) : [];
    } catch {
        return [];
    }
}

function writeWantQueue(keys: readonly string[]): void {
    try {
        const s = storage();
        if (!s) return;
        if (keys.length === 0) s.removeItem(WANT_QUEUE_KEY);
        else s.setItem(WANT_QUEUE_KEY, JSON.stringify(keys.slice(-QUEUE_MAX)));
    } catch {
        // 残せなければ送らないだけ
    }
}

/** 送る（貯まっているぶんを最大 `WANT_SEND_MAX` 件ずつ）。`leaving` は頁を離れるとき（待たない送り方） */
export async function flushSpotWants(leaving = false): Promise<void> {
    const device = wantDeviceId();
    let queue = readWantQueue();
    if (!device || queue.length === 0) return;
    while (queue.length > 0) {
        const batch = queue.slice(0, WANT_SEND_MAX);
        const body = JSON.stringify({ device, slugs: batch });
        // 本文は text/plain で送る（頁を離れるときの keepalive で、事前の問い合わせを挟まない）
        const init = { method: "POST", headers: { "Content-Type": "text/plain" }, body, keepalive: true } as const;
        if (leaving) {
            void userPublicFetch("/spots/wants", init).catch(() => undefined);
        } else {
            try {
                const res = await userPublicFetch("/spots/wants", init);
                if (!res.ok) return;
            } catch {
                return;
            }
        }
        const sent = new Set(batch);
        queue = readWantQueue().filter((k) => !sent.has(k));
        writeWantQueue(queue);
        if (leaving) return;
    }
}

/** 「行きたい」を1つ貯める。`WANT_BATCH` 件たまったら送る */
export function queueSpotWant(slug: string): void {
    const key = spotSavedKey(slug);
    const queue = readWantQueue();
    if (queue.includes(key)) return;
    writeWantQueue([...queue, key]);
    if (queue.length + 1 >= WANT_BATCH) void flushSpotWants();
}

/** まだ送っていなければ外す（ひとつ戻した） */
export function unqueueSpotWant(slug: string): void {
    const key = spotSavedKey(slug);
    writeWantQueue(readWantQueue().filter((k) => k !== key));
}

/** 頁を離れるときに残りを送る（払う画面・撮影スポットの頁が付ける） */
export function useFlushSpotWantsOnLeave(): void {
    React.useEffect(() => {
        const onHide = () => { void flushSpotWants(true); };
        const onVisibility = () => { if (document.visibilityState === "hidden") onHide(); };
        window.addEventListener("pagehide", onHide);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("pagehide", onHide);
            document.removeEventListener("visibilitychange", onVisibility);
            // 頁の中で移る（Next のリンク）ときも送る
            void flushSpotWants(true);
        };
    }, []);
}
