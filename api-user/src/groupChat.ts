import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { updateUserRow } from "./userList";

/**
 * グループの会話の行（2026-11-20・札 journey.photo-ios#582・案「グループチャットを簡単に」の推奨 C）。
 *
 * 行は `groupchat#<groupId>` の1つ。**形は旅行プランの会話（`tripChat.ts`）の写し**: 直近 `GROUP_CHAT_MAX` 通の輪・
 * 1行 `GROUP_CHAT_BUDGET_BYTES` まで（溢れたら古い方から落とす）・`rev` の CAS で追記（`updateUserRow`）。
 *
 * - 1通ずつに**通し番号 `n`** を持たせる（`tripChat.ts` との違い）。入った人に「入る前の話」を見せない・
 *   外された人に「外されるまでの話」だけを見せる窓を、番号で切るため（時刻では同じミリ秒で取り違える）
 * - 未読は通し番号の差（`seq` − その人が読んだ番号）。読んだ番号は `groupsjoined#<uid>` の `reads` に置く
 * - 作った・足した・参加した・抜けた・外した・名前を変えた、は `event` の通（画面は会話の真ん中に短い1行）
 * - 🔴 **`userId` の欄を持たせない**（`userId-createdAt-index` に載る）。本文はログに出さない
 */

export const groupChatKey = (groupId: string) => `groupchat#${groupId}`;

export const GROUP_CHAT_MAX = 200;
export const GROUP_CHAT_BUDGET_BYTES = 40 * 1024;
export const GROUP_TEXT_MAX = 500;
export const GROUP_EXCERPT_MAX = 40;
/** 写真だけの通の抜粋（DM の `DM_PHOTO_TEXT` と同じ言葉） */
export const GROUP_PHOTO_TEXT = "写真を送りました";

export type GroupEventType = "created" | "added" | "joined" | "left" | "removed" | "renamed";
export type GroupEvent = { type: GroupEventType; targets?: string[]; name?: string };

export type GroupMessage = {
    id: string;
    /** 通し番号（1から） */
    n: number;
    from: string;
    t: string;
    text?: string;
    /** 送った写真（DM と同じ。見せてよいかは読む人ごとに `dmPhotoQuote.ts` が決め直す） */
    photoId?: string;
    event?: GroupEvent;
};

/** 受信箱の1行に出す最後の通 */
export type GroupLast = { from: string; t: string; excerpt: string; event?: GroupEventType };

const EVENT_TYPES: ReadonlySet<string> = new Set(["created", "added", "joined", "left", "removed", "renamed"]);

function isMessage(x: unknown): x is GroupMessage {
    const m = x as Partial<GroupMessage> | null;
    if (!m || typeof m.id !== "string" || typeof m.from !== "string" || typeof m.t !== "string" || typeof m.n !== "number") return false;
    const ev = m.event as Partial<GroupEvent> | undefined;
    return typeof m.text === "string" || typeof m.photoId === "string" || (!!ev && typeof ev.type === "string" && EVENT_TYPES.has(ev.type));
}

export function groupChatItemsOf(item: Record<string, unknown> | undefined): GroupMessage[] {
    return Array.isArray(item?.items) ? (item!.items as unknown[]).filter(isMessage) : [];
}

const seqOf = (item: Record<string, unknown> | undefined) =>
    typeof item?.seq === "number" && item.seq > 0 ? item.seq : 0;

/** 輪に収める（通数と行の大きさ）。**古い方から落とす** */
export function trimGroupChat(items: GroupMessage[]): GroupMessage[] {
    let out = items.slice(-GROUP_CHAT_MAX);
    while (out.length > 1 && Buffer.byteLength(JSON.stringify(out), "utf8") > GROUP_CHAT_BUDGET_BYTES) out = out.slice(1);
    return out;
}

export function lastOfGroupMessage(m: GroupMessage): GroupLast {
    if (m.event) return { from: m.from, t: m.t, excerpt: "", event: m.event.type };
    const body = m.text && m.text.trim() ? m.text : GROUP_PHOTO_TEXT;
    return { from: m.from, t: m.t, excerpt: body.replace(/\s+/g, " ").slice(0, GROUP_EXCERPT_MAX) };
}

/** 足す前の通（番号は追記のときに付ける） */
export type DraftMessage = Omit<GroupMessage, "n">;

export const draftText = (from: string, text: string | undefined, photoId: string | undefined, id?: string, now = new Date()): DraftMessage =>
    ({ id: id ?? randomUUID(), from, t: now.toISOString(), ...(text ? { text } : {}), ...(photoId ? { photoId } : {}) });

export const draftEvent = (from: string, event: GroupEvent, now = new Date()): DraftMessage =>
    ({ id: randomUUID(), from, t: now.toISOString(), event });

/**
 * 通を足す。書いたあとの通し番号と、番号を付けた通と、書いたあとの会話（知らせの宛先を決めるのに使う）を返す。
 * **同じ id の通がもう在れば足さない**（応答が落ちて同じ id で送り直されたとき・`duplicate`）
 */
export async function appendGroupChat(groupId: string, drafts: DraftMessage[]):
    Promise<{ seq: number; messages: GroupMessage[]; duplicate: boolean; items: GroupMessage[] }> {
    let seq = 0;
    let written: GroupMessage[] = [];
    let duplicate = false;
    let all: GroupMessage[] = [];
    if (drafts.length === 0) return { seq, messages: written, duplicate, items: all };
    await updateUserRow(groupChatKey(groupId), groupId, (item) => {
        const items = groupChatItemsOf(item);
        const base = seqOf(item);
        const known = drafts.map((d) => items.find((m) => m.id === d.id)).filter((m): m is GroupMessage => !!m);
        if (known.length > 0) {
            duplicate = true;
            written = known;
            seq = base;
            all = items;
            return null;
        }
        duplicate = false;
        written = drafts.map((d, i) => ({ ...d, n: base + i + 1 }));
        seq = base + drafts.length;
        all = trimGroupChat([...items, ...written]);
        return { groupId, items: all, seq, last: lastOfGroupMessage(written[written.length - 1]) };
    });
    return { seq, messages: written, duplicate, items: all };
}

export async function readGroupChat(groupId: string): Promise<{ items: GroupMessage[]; seq: number }> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupChatKey(groupId) }, ConsistentRead: true }));
    const item = res.Item as Record<string, unknown> | undefined;
    return { items: groupChatItemsOf(item), seq: seqOf(item) };
}

/** 退会: その人の通を会話から外す（本人が書いた文を残さない） */
export async function stripGroupChatFrom(groupId: string, uid: string): Promise<void> {
    await updateUserRow(groupChatKey(groupId), groupId, (item) => {
        if (!item) return null;
        const items = groupChatItemsOf(item);
        const kept = items.filter((m) => m.from !== uid);
        if (kept.length === items.length) return null;
        const last = kept.length > 0 ? lastOfGroupMessage(kept[kept.length - 1]) : undefined;
        return { groupId, items: kept, seq: seqOf(item), ...(last ? { last } : {}) };
    });
}
