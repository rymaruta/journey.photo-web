import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { updateUserRow } from "./userList";
import type { TripItem } from "./tripPlans";

/**
 * 旅行プランの会話（2026-11-12・資料「SNS をもっと SNS に」2b の「日程 | 会話」の会話）。
 *
 * 行は `tripchat#<planId>` の1つ。**形は DM の会話の本体（`dm.ts`）にそろえる**: 直近 `TRIP_CHAT_MAX` 通の輪・
 * 1行 `TRIP_CHAT_BUDGET_BYTES` まで（溢れたら古い方から落とす）・`rev` の CAS で追記（`updateUserRow`）。
 *
 * - 書けるのは仲間だけ（呼ぶ側 `tripShare.ts` が本体の `memberIds` で決める）
 * - 日程に場所が足されたら、足した人の名前で「日程に足しました」の通を1つ置く（`event`）。画面は札で出す
 * - 未読は**通し番号**で数える（`seq`）。その人がどこまで読んだかは、その人の一覧の行
 *   `tripsjoined#<uid>` の `reads.<planId>` に置く（会話の行を読むたびに書き直さない＝大きい行を書かない）
 * - 受信箱は `last`（最後の通の抜粋）と `seq` だけを射影で読む（会話の行ぜんぶを読まない）
 * - 🔴 **`userId` の欄を持たせない**（`userId-createdAt-index` に載る）。本文はログに出さない
 *
 * この行を読み書きするのはこのファイルだけ。`tripPlans.ts`（日程に足したの通）と `tripShare.ts`（口）が呼ぶ
 * （`tripPlans.ts` から `tripShare.ts` を呼ぶと輪になるので、会話の行はここに分けた）
 */

export const tripChatKey = (planId: string) => `tripchat#${planId}`;

/**
 * 会話の1通の通報の写し（2026-11-14・札 journey.photo-ios#597・審査ガイドライン 1.2）。
 * **1人1通につき1件**（同じ人が同じ通を押し直したら上書き）。DM の通報の写し（`dm.ts` の `dmReportKey`）と同じ表・同じ作法で、
 * 新しい表・GSI は作らない。🔴 `userId` の欄は持たせない（`userId-createdAt-index` に載る）。運営の記録なので退会でも消さない
 */
export const tripChatReportKey = (planId: string, messageId: string, reporter: string) =>
    `tripreport#${planId}#${messageId}#${reporter}`;
/** 通報で写す直近の通の数（DM の `DM_REPORT_LAST` と同じ 20） */
export const TRIP_REPORT_LAST = 20;
/** 押し直しで写しを重ねたときの上限（DM の `DM_REPORT_KEEP_MAX` と同じ 100。500字×100通でも 1行 400KB に収まる） */
export const TRIP_REPORT_KEEP_MAX = 100;
/** 通の id の形（`randomUUID` の形。任意の文字列を行のキーにさせない） */
export const isTripMessageId = (v: unknown): v is string =>
    typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const TRIP_CHAT_MAX = 200;
export const TRIP_CHAT_BUDGET_BYTES = 40 * 1024;
export const TRIP_CHAT_TEXT_MAX = 500;
export const TRIP_CHAT_EXCERPT_MAX = 40;
/** 1回の書き込みで置く「日程に足しました」の通の数（まとめて10か所足しても会話を埋めない） */
export const TRIP_CHAT_EVENTS_MAX = 3;

export type TripChatEvent = { type: "added"; item: TripItem; day: number };

export type TripChatMessage = {
    id: string;
    from: string;
    t: string;
    text?: string;
    event?: TripChatEvent;
};

export type TripChatLast = { from: string; t: string; excerpt: string; event?: true };

function isMessage(x: unknown): x is TripChatMessage {
    const m = x as Partial<TripChatMessage> | null;
    return !!m && typeof m.id === "string" && typeof m.from === "string" && typeof m.t === "string"
        && (typeof m.text === "string" || (typeof m.event === "object" && m.event !== null));
}

export function chatItemsOf(item: Record<string, unknown> | undefined): TripChatMessage[] {
    return Array.isArray(item?.items) ? (item!.items as unknown[]).filter(isMessage) : [];
}

const seqOf = (item: Record<string, unknown> | undefined) =>
    typeof item?.seq === "number" && item.seq > 0 ? item.seq : 0;

/** 輪に収める（通数と行の大きさ）。**古い方から落とす**（DM の本体と同じ） */
export function trimChat(items: TripChatMessage[]): TripChatMessage[] {
    let out = items.slice(-TRIP_CHAT_MAX);
    while (out.length > 1 && Buffer.byteLength(JSON.stringify(out), "utf8") > TRIP_CHAT_BUDGET_BYTES) out = out.slice(1);
    return out;
}

/** 抜粋（受信箱の1行）。「日程に足しました」の通は画面が言葉を決めるので、印だけ */
function lastOf(m: TripChatMessage): TripChatLast {
    if (m.event) return { from: m.from, t: m.t, excerpt: "", event: true };
    return { from: m.from, t: m.t, excerpt: (m.text ?? "").replace(/\s+/g, " ").slice(0, TRIP_CHAT_EXCERPT_MAX) };
}

/** 文の通を作る（本文は呼ぶ側が整えたもの） */
export const textMessage = (from: string, text: string, now = new Date()): TripChatMessage =>
    ({ id: randomUUID(), from, t: now.toISOString(), text });

/** 「日程に足しました」の通（足した場所ごと・`TRIP_CHAT_EVENTS_MAX` まで） */
export function addedMessages(from: string, added: ReadonlyArray<{ item: TripItem; day: number }>, now = new Date()): TripChatMessage[] {
    return added.slice(0, TRIP_CHAT_EVENTS_MAX).map(({ item, day }) => {
        // ひとこと・足した人は会話に写さない（日程の側が持つ）
        const bare: TripItem = item.kind === "spot" ? { kind: "spot", spotId: item.spotId } : { kind: "location", slug: item.slug };
        return { id: randomUUID(), from, t: now.toISOString(), event: { type: "added", item: bare, day } };
    });
}

/** 通を足す。書いたあとの通し番号を返す */
export async function appendTripChat(planId: string, messages: TripChatMessage[]): Promise<number> {
    if (messages.length === 0) return 0;
    let seq = 0;
    await updateUserRow(tripChatKey(planId), planId, (item) => {
        const items = trimChat([...chatItemsOf(item), ...messages]);
        seq = seqOf(item) + messages.length;
        return { planId, items, seq, last: lastOf(messages[messages.length - 1]) };
    });
    return seq;
}

/** 会話を読む（仲間かどうかは呼ぶ側が決めてから） */
export async function readTripChat(planId: string): Promise<{ items: TripChatMessage[]; seq: number }> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: tripChatKey(planId) }, ConsistentRead: true }));
    const item = res.Item as Record<string, unknown> | undefined;
    return { items: chatItemsOf(item), seq: seqOf(item) };
}

/** 退会: その人の通を会話から外す（相手の画面に名前だけ残さない・本人が書いた文を残さない） */
export async function stripTripChatFrom(planId: string, uid: string): Promise<void> {
    await updateUserRow(tripChatKey(planId), planId, (item) => {
        if (!item) return null;
        const items = chatItemsOf(item);
        const kept = items.filter((m) => m.from !== uid);
        if (kept.length === items.length) return null;
        const last = kept.length > 0 ? lastOf(kept[kept.length - 1]) : undefined;
        return { planId, items: kept, seq: seqOf(item), ...(last ? { last } : {}) };
    });
}
