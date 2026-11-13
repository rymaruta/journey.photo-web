// lib/utils/spotSwipe.ts
//
// **撮影スポットを払う**（`/swipe`・2026-11-11 owner の要望「撮影スポットを払う」の①・iOS の `SpotSwipe`）。
// 画面を持たない計算と、端末の控え（localStorage）の読み書きだけ。
//
// ## 未ログインの結果は端末に「撮影スポットの鍵だけ」
//
// 未ログインでも払える。右へ払った「行きたい」は `localStorage` に**撮影スポットの鍵（`SPOT-<slug>`）だけ**、
// 最大 `SWIPE_WANT_MAX` 個。一覧・地図・旅行プランは見せない（札 #432・2026-10-31 owner「登録なしで保存はやめる」
// と食い違わないよう、結果を見るにはログインが要る）。ログインして `/swipe` に戻ったら、端末の鍵を
// `POST /user/spots` で1つずつ送り、送れたものから消す（`useSwipeHandOff`）。
//
// 読み書きは**必ず try/catch**（プライベートの窓・保存の禁止で投げる）。読めなければ空として続ける。

import { SPOT_KEY_PREFIX, spotSavedKey } from "./savedSpotKey";
import type { TopicCredit } from "../data/spotTopics";

/** 札1枚（`/app/data/swipe.json` の1件・`lib/data/swipeDeck.ts` が書く） */
export type SwipeCard = {
    slug: string;
    name: string;
    /** 「北海道 札幌市」など（`toTopicCard` の地域） */
    region: string;
    /** 代表写真（サイトに置いた元の大きさ・`spotCoverImage`）。サイトに置いた固定の画像 */
    src: string;
    alt: string;
    /** 出典（撮影スポットの頁と同じ決まり）。運営の写真で表記の求めが無いときだけ null */
    credit: TopicCredit | null;
};

/** 端末に置く「行きたい」の上限（iOS の `TripPicker.pickMax` と同じ 40） */
export const SWIPE_WANT_MAX = 40;
/** 見た札の控えの上限（次に開いたとき同じ札を出さない） */
export const SWIPE_SEEN_MAX = 400;
/** 最初に挟む札を出すまでの枚数・続けてから次に出すまでの枚数（iOS の `SpotSwipe` と同じ） */
export const SWIPE_FIRST_PAUSE = 5;
export const SWIPE_PAUSE_EVERY = 10;

export const SWIPE_WANTS_KEY = "jp-swipe-wants";
export const SWIPE_SEEN_KEY = "jp-swipe-seen";
export const SWIPE_STARTED_KEY = "jp-swipe-started";

/** 札の山の JSON を読む（形の合わない行は落とす） */
export function parseSwipeDeck(raw: unknown): SwipeCard[] {
    if (!Array.isArray(raw)) return [];
    const out: SwipeCard[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (typeof o.slug !== "string" || !o.slug || typeof o.name !== "string" || typeof o.src !== "string" || !o.src) continue;
        if (seen.has(o.slug)) continue;
        seen.add(o.slug);
        const c = o.credit as Record<string, unknown> | null | undefined;
        const credit: TopicCredit | null = c && typeof c === "object" && typeof c.author === "string"
            ? {
                author: c.author,
                ...(typeof c.license === "string" ? { license: c.license } : {}),
                ...(typeof c.licenseUrl === "string" ? { licenseUrl: c.licenseUrl } : {}),
                ...(typeof c.sourceUrl === "string" ? { sourceUrl: c.sourceUrl } : {}),
                ...(typeof c.text === "string" ? { text: c.text } : {}),
            }
            : null;
        out.push({
            slug: o.slug,
            name: o.name,
            region: typeof o.region === "string" ? o.region : "",
            src: o.src,
            alt: typeof o.alt === "string" && o.alt ? o.alt : o.name,
            credit,
        });
    }
    return out;
}

/** 混ぜる（Fisher–Yates）。`random` は試験で固定できるように渡す */
export function shuffleDeck<T>(items: readonly T[], random: () => number = Math.random): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * 山を作る。もう「行きたい」に入れた場所と、前に見た札は出さない。
 * **前に見た札を除いて空になったら、「行きたい」だけ除いて最初から**（`restarted`）
 */
export function buildSwipeDeck(cards: readonly SwipeCard[], wanted: ReadonlySet<string>, seen: ReadonlySet<string>,
                               random: () => number = Math.random): { deck: SwipeCard[]; restarted: boolean } {
    const notWanted = cards.filter((c) => !wanted.has(spotSavedKey(c.slug)));
    const fresh = notWanted.filter((c) => !seen.has(spotSavedKey(c.slug)));
    if (fresh.length > 0 || notWanted.length === 0) return { deck: shuffleDeck(fresh, random), restarted: false };
    return { deck: shuffleDeck(notWanted, random), restarted: true };
}

/** 挟む札を出すか（iOS の `SpotSwipe.showsPause` と同じ規則） */
export function showsSwipePause(decisions: number, wants: number, continuedAt: number | null): boolean {
    if (wants <= 0) return false;
    if (continuedAt === null) return decisions >= SWIPE_FIRST_PAUSE;
    return decisions >= continuedAt + SWIPE_PAUSE_EVERY;
}

// ─────────────────────────────────────────────────────────────
// 端末の控え（すべて try/catch・読めなければ空）
// ─────────────────────────────────────────────────────────────

function storage(): Storage | null {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
}

/** 鍵の一覧を読む。撮影スポットの鍵（`SPOT-`）だけ・重なりなし・`max` 個まで（新しいものを残す） */
function readKeys(key: string, max: number): string[] {
    try {
        const raw = storage()?.getItem(key);
        if (!raw) return [];
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        const out: string[] = [];
        for (const v of list) {
            if (typeof v !== "string" || !v.startsWith(SPOT_KEY_PREFIX) || v.length === SPOT_KEY_PREFIX.length) continue;
            if (!out.includes(v)) out.push(v);
        }
        return out.slice(-max);
    } catch {
        return [];
    }
}

function writeKeys(key: string, keys: readonly string[]): void {
    try {
        const s = storage();
        if (!s) return;
        if (keys.length === 0) s.removeItem(key);
        else s.setItem(key, JSON.stringify(keys));
    } catch {
        // 残せなくても払う画面は動く（次に開いたときに忘れているだけ）
    }
}

/** 未ログインで「行きたい」にした鍵（古い順） */
export function readSwipeWants(): string[] {
    return readKeys(SWIPE_WANTS_KEY, SWIPE_WANT_MAX);
}

/** 足す。**上限に達していたら足さずに false**（黙って古いものを消さない） */
export function addSwipeWant(slug: string): boolean {
    const key = spotSavedKey(slug);
    const list = readSwipeWants();
    if (list.includes(key)) return true;
    if (list.length >= SWIPE_WANT_MAX) return false;
    writeKeys(SWIPE_WANTS_KEY, [...list, key]);
    return true;
}

export function removeSwipeWant(key: string): void {
    writeKeys(SWIPE_WANTS_KEY, readSwipeWants().filter((k) => k !== key));
}

export function readSwipeSeen(): string[] {
    return readKeys(SWIPE_SEEN_KEY, SWIPE_SEEN_MAX);
}

export function addSwipeSeen(slug: string): void {
    const key = spotSavedKey(slug);
    writeKeys(SWIPE_SEEN_KEY, [...readSwipeSeen().filter((k) => k !== key), key].slice(-SWIPE_SEEN_MAX));
}

export function removeSwipeSeen(slug: string): void {
    const key = spotSavedKey(slug);
    writeKeys(SWIPE_SEEN_KEY, readSwipeSeen().filter((k) => k !== key));
}

export function resetSwipeSeen(): void {
    writeKeys(SWIPE_SEEN_KEY, []);
}

/** 一度でも払う画面を開いたか（ホームの入口の一行を「続きから」にする） */
export function readSwipeStarted(): boolean {
    try {
        return storage()?.getItem(SWIPE_STARTED_KEY) === "1";
    } catch {
        return false;
    }
}

export function markSwipeStarted(): void {
    try {
        storage()?.setItem(SWIPE_STARTED_KEY, "1");
    } catch {
        // 残せなくても入口の一行が「はじめる」のままなだけ
    }
}

/**
 * ログインしたあと、端末の鍵をサーバーへ移す（`POST /user/spots`・1つずつ・同じものは何度送っても1つ）。
 * **送れた鍵から端末を消す**（途中で失敗したら残りは次の回）。移せた数を返す
 */
export async function handOffSwipeWants(post: (key: string) => Promise<boolean>): Promise<{ moved: number; left: number }> {
    const keys = readSwipeWants();
    let moved = 0;
    for (const key of keys) {
        let ok = false;
        try {
            ok = await post(key);
        } catch {
            ok = false;
        }
        if (!ok) break;
        removeSwipeWant(key);
        moved += 1;
    }
    return { moved, left: readSwipeWants().length };
}
