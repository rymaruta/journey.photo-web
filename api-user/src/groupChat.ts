import { BatchGetCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { updateUserRow } from "./userList";
import { trimChat } from "./tripChat";
import { isUserId } from "./userId";
import { dayOf } from "./dm";

/**
 * グループの会話（みんなで話す DM・最大30人）の**行**（2026-11-12・札 journey.photo-ios#582・資料「みんなで話す DM」8章）。
 * owner 承認（2026-11-12）: 同じ表に行の種類を5つ足す。**新しい GSI・表・TTL は作らない。** 口は `groups.ts`。
 *
 * | 行 | 中身 |
 * |---|---|
 * | `group#<gid>` | 受信箱に並べる小さい行（約1KB）: 名前・作った人・人数・顔に出す人・最後の1通と通し番号・最後に知らせた時刻 |
 * | `groupmembers#<gid>` | **誰が入っているかの正**（30人で約10KB）: メンバー・招待中の人・断った人・外した人 |
 * | `groupchat#<gid>` | 直近200通・40KB の輪（DM・旅行プランの会話と同じ・`trimChat`） |
 * | `groupsjoined#<uid>` | その人のグループ（入っている・招待されている・外された）と読んだ番号・1日に人を足した数 |
 * | `groupreport#<gid>#<uid>` | 通報の写し（直近20通・誰の通か・グループの名前） |
 *
 * 形は旅行プランの会話（`tripChat.ts`・`tripPlans.ts` の「共有したプラン」）にそろえる:
 *  - どの行も「読む → `rev` の条件で Put」（`updateUserRow`）で書く。ぶつかったら読み直す
 *  - 未読は**通し番号**（`seq`）で数え、その人がどこまで読んだかはその人の行（`groupsjoined#`）に置く。
 *    **受信箱に人数分を書かない**（1通で29人の受信箱を書き換えない・資料 9章の費用）
 *  - 受信箱は `group#` の小さい行だけをまとめて読む。メンバーの一覧（`groupmembers#`）は受信箱では読まない
 *  - 🔴 **`userId` の欄を持たせない**（`userId-createdAt-index` に載る）。`updateUserRow` の `uid` には gid を入れる。
 *    本文はログに出さない
 */

export const groupKey = (gid: string) => `group#${gid}`;
export const groupMembersKey = (gid: string) => `groupmembers#${gid}`;
export const groupChatKey = (gid: string) => `groupchat#${gid}`;
export const groupsJoinedKey = (uid: string) => `groupsjoined#${uid}`;
export const groupReportKey = (gid: string, reporter: string) => `groupreport#${gid}#${reporter}`;

/** 1グループの人数（招待中の人も数える・owner 2026-11-12「1グループ最大30人」） */
export const GROUP_MEMBERS_MAX = 30;
/** 1回に足せる人数（自分を入れて30人。1回で全員を選べる） */
export const GROUP_ADD_MAX = GROUP_MEMBERS_MAX - 1;
/** 1人が入れるグループの数（旅行プランと同じ） */
export const GROUPS_JOINED_MAX = 50;
/** 受け取る側の招待の棚。**溢れたら新しい招待を断る**（古い招待を黙って押し出さない） */
export const GROUP_INVITES_MAX = 20;
/** 返事の無い招待が外れるまで（30日）。読むときに外す（TTL は作らない） */
export const GROUP_INVITE_TTL_MS = 30 * 24 * 3600 * 1000;
/** 断った人・外した人の控え（それぞれ・古い方から落とす） */
export const GROUP_DECLINED_MAX = 100;
export const GROUP_KICKED_MAX = 100;
/**
 * 外されたグループの行（「グループから外れました。」）を受信箱に残す数。**50の枠とは別に数え、溢れたら古い方から落とす**
 * （2026-11-12 判断: 外す・入れ直すを繰り返して、相手の50の枠を外された行で埋めさせない）
 */
export const GROUP_REMOVED_KEEP = 50;
export const GROUP_NAME_MAX = 20;
export const GROUP_TEXT_MAX = 500;
export const GROUP_EXCERPT_MAX = 40;
/** リクエストに入る招待（相手が自分をフォローしていない）を1日に送れる人数（DM の `DM_DAILY_NEW_CONVS` と同じ数と考え） */
export const GROUP_DAILY_REQUEST_INVITES = 20;
/** そのまま入る人（自分をフォローしている人）を1日に足せる人数（30人のグループを3つ作れる量） */
export const GROUP_DAILY_DIRECT_ADDS = 100;
/** 同じグループの知らせを鳴らす間（3分に1回まで）・自分が送ってから知らせない間（3分） */
export const GROUP_PUSH_GAP_MS = 3 * 60 * 1000;
/** 受信箱の顔と自動の名前に使う人数（自分を除いても3人残る数） */
export const GROUP_PREVIEW_IDS = 4;
/** 取り消した通の番号の控え（未読を数え直すため・古い方から落とす） */
export const GROUP_UNSENT_KEEP = 50;
/** 退会の掃除のために覚えておくグループ（断った・外された・招待を送った）。古い方から落とす */
export const GROUP_TRACE_MAX = 200;

export const isGroupId = (v: unknown): v is string =>
    typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

// ---------------------------------------------------------------------------
// 行の形
// ---------------------------------------------------------------------------

export type GroupLast = { id: string; from: string; t: string; excerpt: string; photo?: true };

/** `group#<gid>`（受信箱に並べる小さい行） */
export type GroupHead = {
    gid: string;
    /** 付けた名前。**無ければ画面がメンバーの名前を並べる** */
    name?: string;
    ownerId: string;
    /** メンバーの数（招待中の人は数えない） */
    count: number;
    /** 顔と自動の名前に使う人（入った順の先頭 `GROUP_PREVIEW_IDS` 人） */
    previewIds: string[];
    /** 通し番号（文字・写真の通だけ。会話の中の1行は数えない） */
    seq: number;
    last?: GroupLast;
    /** 最後に知らせ（プッシュ）を送った時刻。3分に1回までの歯止め */
    notifiedAt?: string;
    /** 取り消した通の番号（未読を数え直す・`GROUP_UNSENT_KEEP` まで） */
    unsentSeqs?: number[];
    createdAt: string;
};

export type GroupMember = { id: string; joinedAt: string; addedBy?: string; muted?: true };
export type GroupInvite = { id: string; by: string; at: string };

/** `groupmembers#<gid>`（**誰が入っているかの正**） */
export type GroupMembers = {
    gid: string;
    ownerId: string;
    /** 入った順 */
    members: GroupMember[];
    invited: GroupInvite[];
    /** 招待を断った人。**このグループには誰も招待し直せない** */
    declined: string[];
    /** 作った人が外した人。**作った人がもう一度入れるまで戻れない** */
    kicked: string[];
    /**
     * この行を作った時刻（2026-11-12 確かめ役の指摘2）。消えたグループと同じ gid で作り直された行を、
     * 前のグループで外された人の「外された会話」と取り違えない（`groups.ts` の `accessOf`）。古い行には無い
     */
    createdAt?: string;
};

export type GroupEvent =
    | { type: "created" }
    | { type: "added"; ids: string[] }
    | { type: "joined" }
    | { type: "left" }
    | { type: "removed"; target: string }
    | { type: "renamed"; name: string };

/**
 * 会話の1通。文字・写真の通は `n`（通し番号）を持つ。会話の中の1行（`event`）は持たない——
 * 2026-11-12 判断: 作った・入った・抜けた・外した・名前を変えたの1行は、知らせないだけでなく**未読にも数えない**
 * （資料「知らせない: 会話の中の1行だけにする」。点と太字で呼ばない）。受信箱の抜粋（`last`）にもしない
 */
export type GroupMessage = {
    id: string;
    from: string;
    t: string;
    n?: number;
    text?: string;
    photoId?: string;
    event?: GroupEvent;
};

export type JoinedState = "member" | "invited" | "removed";
export type JoinedEntry = {
    state: JoinedState;
    /** その状態になった時刻（入った・招待された・外された） */
    at: string;
    /** 外された会話の、読める範囲（入った時刻〜外された時刻） */
    since?: string;
    until?: string;
    /** どこまで読んだか（通し番号） */
    read?: number;
    /** 招待した人 */
    by?: string;
    /** 知らせを止めたか（`groupmembers#` の写し・受信箱に出すため） */
    muted?: true;
};

/** `groupsjoined#<uid>` */
export type GroupsJoined = {
    groups: Record<string, JoinedEntry>;
    /**
     * その日（日本の日付）に足した人数。そのまま入る人・リクエストに入る招待。
     * 2026-11-12 判断: `dmday#` に足してよい欄は2つ（`groupSent`・`groupNew`）と承認されているので、人を足す数は
     * 承認された新しい行（その人の `groupsjoined#`）に置く。DM の「1日に始められる新しい会話」（`newConv`）とは分ける
     * （グループに人を足した日に DM が始められなくなる、を作らない）
     */
    quota?: { day: string; direct: number; request: number };
    /**
     * 退会の掃除で辿るグループ（2026-11-12 確かめ役の指摘7・判断: 本人の行に持たせる）。断った（`declined` に名がある）・
     * 外された（`kicked` に名がある）・招待を送った（`invited` の `by` に名がある）グループ。受信箱の行が消えても残す。
     * `GROUP_TRACE_MAX` まで（古い方から落とす）
     */
    trace?: string[];
};

// ---------------------------------------------------------------------------
// 形の読み取り（壊れた行で落ちない）
// ---------------------------------------------------------------------------

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parseLast(v: unknown): GroupLast | undefined {
    const l = v as Partial<GroupLast> | null | undefined;
    if (!l || typeof l.id !== "string" || typeof l.from !== "string" || typeof l.t !== "string") return undefined;
    return { id: l.id, from: l.from, t: l.t, excerpt: typeof l.excerpt === "string" ? l.excerpt : "", ...(l.photo === true ? { photo: true } : {}) };
}

export function parseHead(item: Record<string, unknown> | undefined): GroupHead | null {
    if (!item || !isGroupId(item.gid) || typeof item.ownerId !== "string") return null;
    const last = parseLast(item.last);
    return {
        gid: item.gid,
        ...(typeof item.name === "string" && item.name ? { name: item.name } : {}),
        ownerId: item.ownerId,
        count: typeof item.count === "number" ? item.count : 0,
        previewIds: strs(item.previewIds),
        seq: typeof item.seq === "number" && item.seq > 0 ? item.seq : 0,
        ...(last ? { last } : {}),
        ...(typeof item.notifiedAt === "string" ? { notifiedAt: item.notifiedAt } : {}),
        ...(Array.isArray(item.unsentSeqs) ? { unsentSeqs: (item.unsentSeqs as unknown[]).filter((n): n is number => typeof n === "number") } : {}),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
    };
}

export function parseMembers(item: Record<string, unknown> | undefined): GroupMembers | null {
    if (!item || !isGroupId(item.gid) || typeof item.ownerId !== "string") return null;
    const members = (Array.isArray(item.members) ? item.members as Partial<GroupMember>[] : [])
        .filter((m): m is GroupMember => !!m && typeof m.id === "string" && typeof m.joinedAt === "string")
        .map((m) => ({ id: m.id, joinedAt: m.joinedAt, ...(m.addedBy ? { addedBy: m.addedBy } : {}), ...(m.muted === true ? { muted: true as const } : {}) }));
    const invited = (Array.isArray(item.invited) ? item.invited as Partial<GroupInvite>[] : [])
        .filter((m): m is GroupInvite => !!m && typeof m.id === "string" && typeof m.by === "string" && typeof m.at === "string")
        .map((m) => ({ id: m.id, by: m.by, at: m.at }));
    return {
        gid: item.gid, ownerId: item.ownerId, members, invited, declined: strs(item.declined), kicked: strs(item.kicked),
        ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
    };
}

function isEvent(v: unknown): v is GroupEvent {
    const e = v as { type?: unknown } | null;
    return !!e && typeof e === "object" && ["created", "added", "joined", "left", "removed", "renamed"].includes(e.type as string);
}

export function chatItemsOf(item: Record<string, unknown> | undefined): GroupMessage[] {
    return (Array.isArray(item?.items) ? item!.items as Partial<GroupMessage>[] : []).filter((m): m is GroupMessage =>
        !!m && typeof m.id === "string" && typeof m.from === "string" && typeof m.t === "string"
        && (typeof m.text === "string" || typeof m.photoId === "string" || isEvent(m.event)));
}

const ENTRY_STATES: readonly JoinedState[] = ["member", "invited", "removed"];

export function parseJoined(item: Record<string, unknown> | undefined): GroupsJoined {
    const groups: Record<string, JoinedEntry> = {};
    const raw = item?.groups;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [gid, v] of Object.entries(raw as Record<string, unknown>)) {
            const e = v as Partial<JoinedEntry> | null;
            if (!isGroupId(gid) || !e || !ENTRY_STATES.includes(e.state as JoinedState) || typeof e.at !== "string") continue;
            groups[gid] = {
                state: e.state as JoinedState, at: e.at,
                ...(typeof e.since === "string" ? { since: e.since } : {}),
                ...(typeof e.until === "string" ? { until: e.until } : {}),
                ...(typeof e.read === "number" ? { read: e.read } : {}),
                ...(typeof e.by === "string" ? { by: e.by } : {}),
                ...(e.muted === true ? { muted: true } : {}),
            };
        }
    }
    const q = item?.quota as GroupsJoined["quota"] | undefined;
    const quota = q && typeof q.day === "string" && typeof q.direct === "number" && typeof q.request === "number"
        ? { day: q.day, direct: q.direct, request: q.request } : undefined;
    const trace = strs(item?.trace).filter((g) => isGroupId(g));
    return { groups, ...(quota ? { quota } : {}), ...(trace.length > 0 ? { trace } : {}) };
}

// ---------------------------------------------------------------------------
// 決まり（純関数）
// ---------------------------------------------------------------------------

/** 返事の無い招待（30日）を外した、生きている招待 */
export const liveInvites = (m: Pick<GroupMembers, "invited">, now = Date.now()) =>
    m.invited.filter((i) => Date.parse(i.at) > now - GROUP_INVITE_TTL_MS);

/** 30人の枠に数える人数（メンバー＋生きている招待） */
export const seatsUsed = (m: GroupMembers, now = Date.now()) => m.members.length + liveInvites(m, now).length;

export const isLiveInviteEntry = (e: JoinedEntry | undefined, now = Date.now()) =>
    !!e && e.state === "invited" && Date.parse(e.at) > now - GROUP_INVITE_TTL_MS;

export const countState = (j: GroupsJoined, state: JoinedState, now = Date.now()) =>
    Object.values(j.groups).filter((e) => (state === "invited" ? isLiveInviteEntry(e, now) : e.state === state)).length;

/**
 * 名前の無いグループの呼び名（資料 2章「けん、みお」。4人目からは「けん、みお、ほか2人」）。
 * `exclude` は呼び名から外す人（見る人・知らせの送り主）
 */
export function autoName(ids: readonly string[], names: ReadonlyMap<string, { name: string }>, exclude?: string, othersTotal?: number): string {
    const others = ids.filter((id) => id !== exclude).map((id) => names.get(id)?.name ?? "名前未設定さん");
    // 受信箱は顔に出す人（先頭の数人）しか持たないので、ほかの人数は全体の人数から数える
    const total = Math.max(others.length, othersTotal ?? 0);
    if (total === 0) return "グループ";
    return total <= 3 ? others.join("、") : `${others.slice(0, 2).join("、")}、ほか${total - 2}人`;
}

/** 受信箱の抜粋（写真だけの通は「写真を送りました」・改行は空白） */
export function lastOf(m: GroupMessage): GroupLast {
    const text = (m.text ?? "").replace(/\s+/g, " ").trim();
    return {
        id: m.id, from: m.from, t: m.t,
        excerpt: (text || (m.photoId ? "写真を送りました" : "")).slice(0, GROUP_EXCERPT_MAX),
        ...(m.photoId && !text ? { photo: true as const } : {}),
    };
}

/** 未読（自分が読んだ番号より後の通。取り消した通は数えない） */
export function unreadOf(head: Pick<GroupHead, "seq" | "unsentSeqs">, read: number): number {
    const gone = (head.unsentSeqs ?? []).filter((n) => n > read && n <= head.seq).length;
    return Math.max(0, head.seq - read - gone);
}

/**
 * その人に見せる通（入った時刻より後・外された時刻まで・ブロックの間柄の人の通と1行を外す）。
 * **入る前の話は見えない**（資料 2章・LINE と同じ）。消さずに隠すだけ（ブロックを解けば戻る）
 */
export function visibleFor(items: readonly GroupMessage[], win: { since?: string; until?: string }, hidden: ReadonlySet<string>): GroupMessage[] {
    return items.filter((m) => (!win.since || m.t >= win.since) && (!win.until || m.t <= win.until) && !hidden.has(m.from));
}

/** 送った人ごとの、輪の中での最後の通の時刻（自分が送ってから3分は知らせない） */
export function lastSentAt(items: readonly GroupMessage[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of items) if (!m.event && (out.get(m.from) ?? "") < m.t) out.set(m.from, m.t);
    return out;
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

export async function readHead(gid: string, consistent = false): Promise<GroupHead | null> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupKey(gid) }, ...(consistent ? { ConsistentRead: true } : {}) }));
    return parseHead(res.Item as Record<string, unknown> | undefined);
}

/** 受信箱: `group#` の小さい行をまとめて読む（100件ずつ）。**メンバーの一覧と会話の行は読まない** */
export async function readHeads(gids: readonly string[]): Promise<Map<string, GroupHead>> {
    const out = new Map<string, GroupHead>();
    const uniq = [...new Set(gids)];
    for (let i = 0; i < uniq.length; i += 100) {
        const res = await ddb.send(new BatchGetCommand({
            RequestItems: { [PHOTOS_TABLE]: { Keys: uniq.slice(i, i + 100).map((g) => ({ id: groupKey(g) })) } },
        }));
        // 読み残しは**投げる**（黙って欠けた受信箱を返すと、画面が「消えた」と見せる・`listSharedTrips` と同じ）
        if (Object.keys(res.UnprocessedKeys ?? {}).length > 0) throw new Error("readHeads: 読み残しがありました");
        for (const item of (res.Responses?.[PHOTOS_TABLE] ?? []) as Record<string, unknown>[]) {
            const h = parseHead(item);
            if (h) out.set(h.gid, h);
        }
    }
    return out;
}

export async function readMembers(gid: string): Promise<GroupMembers | null> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupMembersKey(gid) }, ConsistentRead: true }));
    return parseMembers(res.Item as Record<string, unknown> | undefined);
}

export async function readChat(gid: string): Promise<{ items: GroupMessage[]; seq: number; updatedAt: string }> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupChatKey(gid) }, ConsistentRead: true }));
    const item = res.Item as Record<string, unknown> | undefined;
    return {
        items: chatItemsOf(item),
        seq: typeof item?.seq === "number" ? item.seq : 0,
        updatedAt: typeof item?.updatedAt === "string" ? item.updatedAt : "",
    };
}

export async function readJoined(uid: string): Promise<GroupsJoined> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupsJoinedKey(uid) }, ConsistentRead: true }));
    return parseJoined(res.Item as Record<string, unknown> | undefined);
}

/** `rowFields` と同じ: `updateUserRow` が付け直す欄を外す */
function bare(item: Record<string, unknown>): Record<string, unknown> {
    const { id: _i, uid: _u, rev: _r, updatedAt: _t, ...rest } = item;
    void _i; void _u; void _r; void _t;
    return rest;
}

/** メンバーの行を書き換える（`mutate` が null なら書かない）。**副作用を持たせない**（ぶつかると呼び直す） */
export async function writeMembers(gid: string, mutate: (cur: GroupMembers | null) => GroupMembers | null): Promise<void> {
    await updateUserRow(groupMembersKey(gid), gid, (item) => {
        const next = mutate(parseMembers(item));
        return next ? { ...next } : null;
    });
}

/** 小さい行を書き換える（`mutate` が null なら書かない） */
export async function writeHead(gid: string, mutate: (cur: GroupHead | null) => GroupHead | null): Promise<void> {
    await updateUserRow(groupKey(gid), gid, (item) => {
        const next = mutate(parseHead(item));
        return next ? { ...next } : null;
    });
}

/** その人の行を書き換える（`mutate` が null なら書かない） */
export async function writeJoined(uid: string, mutate: (cur: GroupsJoined) => GroupsJoined | null): Promise<void> {
    await updateUserRow(groupsJoinedKey(uid), uid, (item) => {
        const next = mutate(parseJoined(item));
        return next ? { ...next } : null;
    });
}

/**
 * 通を足す。文字・写真の通には通し番号 `n` を付ける。**同じ id の通がもう在れば足さない**（応答が落ちた再送）。
 * 返すのは、書いたあとの通し番号・輪・入った通（再送ならもとの通）
 */
export async function appendChat(gid: string, message: GroupMessage): Promise<{ seq: number; items: GroupMessage[]; stored: GroupMessage; duplicate: boolean }> {
    let out = { seq: 0, items: [] as GroupMessage[], stored: message, duplicate: false };
    await updateUserRow(groupChatKey(gid), gid, (item) => {
        const items = chatItemsOf(item);
        const seq = typeof item?.seq === "number" ? item.seq : 0;
        const prior = items.find((m) => m.id === message.id);
        if (prior) { out = { seq, items, stored: prior, duplicate: true }; return null; }
        const counted = !message.event;
        const stored: GroupMessage = counted ? { ...message, n: seq + 1 } : message;
        const next = trimChat([...items, stored]);
        out = { seq: counted ? seq + 1 : seq, items: next, stored, duplicate: false };
        return { ...(item ? bare(item) : {}), gid, items: next, seq: out.seq };
    });
    return out;
}

/** 会話の中の1行（作った・入った・抜けた・外した・名前を変えた）を置く。**落ちても本筋は止めない** */
export async function appendEvent(gid: string, from: string, event: GroupEvent, now = new Date()): Promise<void> {
    await appendChat(gid, { id: `ev-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`, from, t: now.toISOString(), event })
        .catch((e) => console.error(`appendEvent: 会話に置けませんでした（${gid}）:`, (e as { name?: string })?.name));
}

/** グループを消す（最後の1人が抜けた）。招待中の人の行からも外す（落ちても受信箱は本体の無い行を出さない） */
export async function deleteGroupRows(gid: string, invited: readonly string[]): Promise<void> {
    for (const key of [groupKey(gid), groupMembersKey(gid), groupChatKey(gid)]) {
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: key } }));
    }
    for (const uid of invited) {
        await writeJoined(uid, (j) => dropEntry(j, gid))
            .catch((e) => console.error(`deleteGroupRows: 招待を外せませんでした（${gid}）:`, (e as { name?: string })?.name));
    }
}

// ---------------------------------------------------------------------------
// その人の行（`groupsjoined#`）の書き換え（純関数・`writeJoined` に渡す）
// ---------------------------------------------------------------------------

export function dropEntry(j: GroupsJoined, gid: string): GroupsJoined | null {
    if (!j.groups[gid]) return null;
    const { [gid]: _gone, ...rest } = j.groups;
    void _gone;
    return { ...j, groups: rest };
}

/** メンバーとして載せる。枠（50）を越えるなら `full` */
export function withMemberEntry(j: GroupsJoined, gid: string, since: string, read: number, now = Date.now()):
    { next: GroupsJoined | null; result: "ok" | "already" | "full" } {
    if (j.groups[gid]?.state === "member") return { next: null, result: "already" };
    if (countState(j, "member", now) >= GROUPS_JOINED_MAX) return { next: null, result: "full" };
    return { next: { ...j, groups: { ...j.groups, [gid]: { state: "member", at: since, since, read } } }, result: "ok" };
}

/** 招待として載せる。棚（20）を越えるなら `full`（古い招待を押し出さない） */
export function withInviteEntry(j: GroupsJoined, gid: string, by: string, at: string, now = Date.now()):
    { next: GroupsJoined | null; result: "ok" | "already" | "full" } {
    const cur = j.groups[gid];
    if (cur?.state === "member" || isLiveInviteEntry(cur, now)) return { next: null, result: "already" };
    if (countState(j, "invited", now) >= GROUP_INVITES_MAX) return { next: null, result: "full" };
    // 30日を過ぎた招待はついでに外す（棚を空ける）
    const kept = Object.fromEntries(Object.entries(j.groups).filter(([, e]) => e.state !== "invited" || isLiveInviteEntry(e, now)));
    return { next: { ...j, groups: { ...kept, [gid]: { state: "invited", at, by } } }, result: "ok" };
}

/** 外された会話として残す（読める範囲は入った時刻〜外された時刻）。控えは `GROUP_REMOVED_KEEP` まで */
export function withRemovedEntry(j: GroupsJoined, gid: string, until: string): GroupsJoined | null {
    const cur = j.groups[gid];
    if (!cur || cur.state !== "member") return null;
    const groups = { ...j.groups, [gid]: { state: "removed" as const, at: until, since: cur.since ?? cur.at, until, ...(cur.read !== undefined ? { read: cur.read } : {}) } };
    const removed = Object.entries(groups).filter(([, e]) => e.state === "removed").sort((a, b) => b[1].at.localeCompare(a[1].at));
    for (const [old] of removed.slice(GROUP_REMOVED_KEEP)) delete groups[old];
    return { ...j, groups };
}

/** 退会の掃除で辿るグループに足す（前にあれば先頭へ寄せる） */
export function withTrace(j: GroupsJoined, gid: string): GroupsJoined | null {
    const cur = j.trace ?? [];
    if (cur[0] === gid) return null;
    return { ...j, trace: [gid, ...cur.filter((g) => g !== gid)].slice(0, GROUP_TRACE_MAX) };
}

/** 1日に足せる人数の歯止め（その人の行の `quota`）。越えるなら null（何も進めない） */
export function withQuota(j: GroupsJoined, direct: number, request: number, now = Date.now()): GroupsJoined | null {
    const day = dayOf(now);
    const q = j.quota?.day === day ? j.quota : { day, direct: 0, request: 0 };
    if (q.direct + direct > GROUP_DAILY_DIRECT_ADDS || q.request + request > GROUP_DAILY_REQUEST_INVITES) return null;
    return { ...j, quota: { day, direct: q.direct + direct, request: q.request + request } };
}

/** 本文から人の一覧を読む（形の違うもの・重なりを落とす。小文字にそろえる） */
export function userIdsFrom(v: unknown): string[] | null {
    if (!Array.isArray(v)) return null;
    const out: string[] = [];
    for (const x of v) {
        if (typeof x !== "string" || !isUserId(x)) return null;
        const id = x.toLowerCase();
        if (!out.includes(id)) out.push(id);
    }
    return out;
}
