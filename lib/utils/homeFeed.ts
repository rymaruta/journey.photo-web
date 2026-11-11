import type { Photo } from "@/lib/data/photos";
import { comparePosted } from "./photoOrder";

/**
 * ホームの「おすすめ」の並び（iOS の `HomeFeed.arrange(.recommended)` と同じ規則）。
 *
 *   1. 運営が選んだ写真（`featured === true`）を先に
 *   2. 残りは**いいねの多い順**（持たない写真は 0）
 *   3. 同点は**投稿の新しい順**（`comparePosted`＝`createdAt` をゾーンの表記を落として文字列で比べ、無ければ
 *      撮影日 `date`、どちらも無いものは末尾、同じなら id）
 *
 * **推薦の仕組みは無い。** 選ばれた写真といいねの数だけで並べ、先頭 10 枠に新しい投稿を混ぜる（`mixFresh`・2026-11-11）。
 * ⚠️ 本番（2026-09-29: featured 0枚・いいね全部 0）では「投稿の新しい順」になる。
 * ホームの「新着」も投稿日の新しい順なので、そのときは新着と同じ並びになる
 * （2026-10-30 に新着を `compareNewest`＝撮影日が先 から `comparePosted` へ揃えた。iOS も同じ）。
 */
export function recommendedOrder<T extends Photo>(photos: readonly T[], now: Date = new Date()): T[] {
    const byPopular = (a: T, b: T) => ((b.likes ?? 0) - (a.likes ?? 0)) || comparePosted(a, b);
    const sorted = [...photos].sort(byPopular);
    return mixFresh([...sorted.filter((p) => p.featured === true), ...sorted.filter((p) => p.featured !== true)], now);
}

/**
 * **おすすめに新しい投稿を混ぜる**（iOS の `HomeFreshMix`・札 journey.photo-ios#537 案1・2026-11-11 判断）。
 *
 * おすすめは「運営が選んだ写真 → いいねの多い順」。本番では選んだ写真が 0 枚・52 枚中 39 枚がいいね 0 なので、
 * **投稿したばかりの写真（いいね 0）は 1 月の写真の後ろ、14〜17 番目に沈んでいた**（2026-11-11 に `photos.json` で数えた）。
 *
 * 決まり（**iOS と同じ。** `homeFeed.freshMix.test.ts` と iOS の `HomeFreshMixTests` が同じ入力と答えで縛る）:
 *   1. 並べる単位は**投稿**（`groupKey`＝`groupId` と持ち主の組。無ければ写真 1 枚）。iOS は同じ投稿を 1 枚の札に束ねる
 *   2. 投稿から 72 時間以内（いちばん新しい写真の `createdAt`）の投稿を「新しい投稿」とし、新しい順に並べる
 *   3. 先頭 10 枠のうち **2・5・8 番目**に、まだ出ていない新しい投稿を入れる。ほかの枠と 11 番目から後ろは今までの並び。
 *      新しい投稿が今までの並びで先に来ていれば、そこに出る（枠を使わない）
 *   4. `createdAt` は時刻とゾーンのある ISO 8601 だけ読む（日付だけ・読めない値は新しい投稿にしない＝iOS の読み方と同じ）
 */
export const FRESH_WINDOW_MS = 72 * 60 * 60 * 1000;
/** 新しい投稿を入れる枠（0 から数える。画面の 2・5・8 番目） */
export const FRESH_SLOTS: ReadonlySet<number> = new Set([1, 4, 7]);
/** 混ぜる範囲（先頭 10 枠） */
export const FRESH_SPAN = 10;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** `createdAt` を時刻として読む（時刻とゾーンのある形だけ・iOS の `NotificationGroups.parse` と同じ形を受ける） */
export function postedAt(p: { createdAt?: unknown }): number | null {
    const raw = typeof p.createdAt === "string" ? p.createdAt.trim() : "";
    if (!ISO_DATE_TIME.test(raw)) return null;
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : t;
}

/** 72 時間以内に投稿された写真か */
export function isFresh(p: { createdAt?: unknown }, now: Date = new Date()): boolean {
    const t = postedAt(p);
    return t !== null && now.getTime() - t < FRESH_WINDOW_MS;
}

/** 同じ投稿の鍵（iOS の `PhotoGroups.groupKey`）。`groupId` と持ち主の組、どちらかが無ければ写真 1 枚 */
export function groupKey(p: { id?: unknown; groupId?: unknown; userId?: unknown; uploadedBy?: unknown }): string {
    const groupId = typeof p.groupId === "string" ? p.groupId.trim() : "";
    const owner = typeof p.userId === "string" && p.userId ? p.userId : typeof p.uploadedBy === "string" ? p.uploadedBy : "";
    return groupId && owner ? `group#${owner}#${groupId}` : `single#${String(p.id ?? "")}`;
}

/** `ordered`（今までのおすすめの並び）に新しい投稿を混ぜる。写真の数と中身は変えない（並びだけ） */
export function mixFresh<T extends Photo>(ordered: readonly T[], now: Date = new Date()): T[] {
    const order: string[] = [];
    const members = new Map<string, T[]>();
    for (const p of ordered) {
        const key = groupKey(p);
        const list = members.get(key);
        if (list) list.push(p);
        else { members.set(key, [p]); order.push(key); }
    }
    const fresh = order
        .map((key) => {
            const times = (members.get(key) ?? []).filter((p) => isFresh(p, now)).map((p) => postedAt(p) as number);
            return times.length ? { key, at: Math.max(...times) } : null;
        })
        .filter((x): x is { key: string; at: number } => x !== null)
        .sort((a, b) => (b.at - a.at) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((x) => x.key);
    if (fresh.length === 0) return [...ordered];

    const used = new Set<string>();
    const result: string[] = [];
    let baseAt = 0;
    let freshAt = 0;
    const next = (list: string[], at: number): [string | null, number] => {
        let i = at;
        while (i < list.length && used.has(list[i])) i += 1;
        return i < list.length ? [list[i], i + 1] : [null, i];
    };
    while (result.length < order.length) {
        const index = result.length;
        let picked: string | null = null;
        if (index < FRESH_SPAN && FRESH_SLOTS.has(index)) [picked, freshAt] = next(fresh, freshAt);
        if (picked === null) [picked, baseAt] = next(order, baseAt);
        if (picked === null) break;
        used.add(picked);
        result.push(picked);
    }
    return result.flatMap((key) => members.get(key) ?? []);
}

/**
 * **はじめての投稿**の写真の id（iOS の `HomeFreshMix.firstPostPhotoIds`）。持ち主ごとに、公開の写真でいちばん古い投稿が
 * 72 時間以内なら、その投稿の写真全部。ホームの写真に「はじめての投稿」と出す
 */
export function firstPostPhotoIds(photos: readonly Photo[], now: Date = new Date()): Set<string> {
    const oldest = new Map<string, { at: number; photo: Photo }>();
    // 🔴 **`createdAt` の読めない写真を持つ人には印を付けない**（安全側・札 #537 の確かめ役・iOS と同じ）。
    // 読めない写真のほうが古いかもしれず、前から載せている人に「はじめて」と付けてしまう
    const unreadable = new Set<string>();
    for (const p of photos) {
        const owner = p.userId || p.uploadedBy || "";
        if (!owner) continue;
        const at = postedAt(p);
        if (at === null) { unreadable.add(owner); continue; }
        const current = oldest.get(owner);
        if (current && (current.at < at || (current.at === at && String(current.photo.id) <= String(p.id)))) continue;
        oldest.set(owner, { at, photo: p });
    }
    const keys = new Set([...oldest.entries()]
        .filter(([owner, o]) => !unreadable.has(owner) && isFresh(o.photo, now))
        .map(([, o]) => groupKey(o.photo)));
    if (keys.size === 0) return new Set();
    return new Set(photos.filter((p) => keys.has(groupKey(p))).map((p) => String(p.id)));
}
