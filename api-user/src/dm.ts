import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { requireEnv } from "./env";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { displayNameOf, DEFAULT_NAME, DELETED_USER_NAME, deletedAmong, pushDmMessage } from "./notify";
import { truncate, sanitizeText } from "./sanitize";
import { isBlocked, hiddenUserIds } from "./blockCheck";
import { isFollowing } from "./followCheck";
import { readUserList } from "./userList";
import { closeFriendsId, isUserId as isCloseFriendId } from "./closeFriends";
import { isUserId } from "./userId";
import { readLiveCaller } from "./liveCaller";
import { isReportReason, REPORT_NOTE_MAX } from "./report";
import { isDeletedProfile } from "./types";
import {
    DM_CONVS_MAX, DM_EXCERPT_MAX, dmInboxId, declinedAttr, readDmInbox, unreadConvCount,
    type DmEntry, type DmEntryState,
} from "./dmInbox";

/**
 * **DM 第1段（2026-11-09・札 #505）。文字だけ・1対1・ストーリーへの返信から始まる会話。**
 *
 * 設計は eng-lead の評価（札 #505）と owner 承認（2026-11-09）による。**GSI・テーブル・TTL は作らない**
 * ——単一テーブルに行の種類を足す（`dmInbox.ts` の冒頭に4種類の一覧）。**保存の形は
 * `storyReplies.ts`（メッセージの輪・条件つき追記）と `follow.ts`（受信箱の原子的な加算）に揃える。**
 *
 * ## 規則（読む前に）
 *
 *   - **会話を始められるのは、相手をフォローしている人だけ**（ストーリーの返信と同じ門）。門に落ちたら 404
 *   - 相手が送り主を**フォローしている・親しい友達にしている**なら受信箱へ直行。それ以外は
 *     **リクエスト**——承認か返信まで**文字3通まで**・**URL を含む文は断る**・**プッシュなし**。
 *     受け取った人が返信した時点で承認（`state` が `inbox` になる）
 *   - **ブロック**: 送信前に `isBlocked`。一覧・会話は `hiddenUserIds` でふるう。**隠すだけで消さない**
 *     （解除で戻る）。ブロックされた側には**ブロックと分かる応答を返さない**（404）
 *   - **歯止め**: 1日の新規会話 `DM_DAILY_NEW_CONVS` 人・送信 `DM_DAILY_SENT` 通（`dmday#<uid>#<日付>` の原子的な加算）。
 *     会話は1人 `DM_CONVS_MAX` まで——**溢れたら新しい会話を断る**（古い会話を黙って押し出さない）
 *   - **消す**のは自分の側だけ。**両方の受信箱から消えたら本体を物理削除**する
 *   - **本文はサーバーのログに出さない**（失敗は `e.name` だけを書く）。プッシュにも載せない
 *   - E2E 暗号化ではない（運営は通報を受けたときだけ直近20通の写しを読む。プライバシー頁に明記）
 *
 * ## 退会（`purgeDmFor`）
 *
 * 自分の受信箱と、会話ごとの自分の側を外す。**相手の画面には会話が残り、名前は「退会したユーザー」**
 * （相手が受け取った文面は相手の記録でもある。コメントの名前を伏せる扱いと同じ）。
 */

export const DM_TEXT_MAX = 500;
export const DM_MESSAGES_MAX = 200;
/** 会話1つの本体に許すバイト数（件数だけでは守れない。`storyReplies.ts` の `ITEM_BUDGET_BYTES` と同じ理由） */
export const DM_ITEM_BUDGET_BYTES = 40 * 1024;
/** リクエストの段階（承認か返信まで）で送れる文字の数 */
export const DM_REQUEST_MAX = 3;
export const DM_DAILY_NEW_CONVS = 20;
export const DM_DAILY_SENT = 300;
/** 通報に写す直近の通数 */
export const DM_REPORT_LAST = 20;

const WRITE_RETRIES = 3;
const USERS_TABLE = requireEnv("USERS_TABLE");

export type DmMessage = { id: string; from: string; text: string; t: string; via?: "story" };

type ConvState = "inbox" | "request";

type DmConv = {
    id: string;
    lo: string;
    hi: string;
    items: DmMessage[];
    state: ConvState;
    /** 会話を始めた人 */
    initiator: string;
    /** リクエストの段階で、始めた人が送った通数 */
    reqCount: number;
    /** この時刻より前のメッセージは、その人には見せない（自分の側を消した時刻） */
    loClearedAt?: string;
    hiClearedAt?: string;
    updatedAt: string;
};

export const dmConvKey = (lo: string, hi: string) => `dm#${lo}#${hi}`;
export const dmDayKey = (uid: string, day: string) => `dmday#${uid}#${day}`;
export const dmReportKey = (convId: string, reporter: string) => `dmreport#${convId}#${reporter}`;

/** 会話の ID（API に出す形）。**小さい uid_大きい uid**——2人から一意に決まる */
export function convIdOf(a: string, b: string): string {
    const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return `${lo.toLowerCase()}_${hi.toLowerCase()}`;
}

/** 会話 ID を2人に割る。形が違う・順序が違うものは null（任意の文字列を行のキーにさせない） */
export function parseConvId(id: string | undefined): { lo: string; hi: string } | null {
    if (!id) return null;
    const parts = id.split("_");
    if (parts.length !== 2) return null;
    const [lo, hi] = parts;
    if (!isUserId(lo) || !isUserId(hi) || lo !== lo.toLowerCase() || hi !== hi.toLowerCase() || !(lo < hi)) return null;
    return { lo, hi };
}

const sideOf = (c: { lo: string }, uid: string) => (uid === c.lo ? "lo" : "hi") as "lo" | "hi";
const clearedAtOf = (c: DmConv, uid: string): string => (sideOf(c, uid) === "lo" ? c.loClearedAt : c.hiClearedAt) ?? "";

/** JST の日付（日の区切りは日本の0時） */
const dayOf = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

const isCcf = (e: unknown) => (e as { name?: string })?.name === "ConditionalCheckFailedException";
/** ログに出すのは名前だけ（本文・利用者の値が入りうるメッセージは出さない） */
const errName = (e: unknown) => (e as { name?: string })?.name ?? "Error";

/**
 * 本文の整え。**改行は残す**（`sanitizeText` は改行まで落とすので、段落が1行に潰れる）。
 * 見えない制御文字を落とし、行の前後と3つ以上の連続する空行をまとめ、上限で切る。
 */
export function cleanDmText(v: unknown): string {
    if (typeof v !== "string") return "";
    const t = v
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return t ? truncate(t, DM_TEXT_MAX) : "";
}

/**
 * URL（に見える文字列）を含むか。**リクエストの段階だけ**で使う（承認後はリンクを送ってよい）。
 * 全角・半角の揺れを NFKC でそろえてから見る。スキーム・`www.`・よくあるドメインの末尾を拾う
 * ——完全には防げない（承認前の3通までという上限が本体の歯止めで、これは安い一次の網）。
 */
export function containsUrl(text: string): boolean {
    const t = text.normalize("NFKC");
    return /(?:https?|ftp):\/\/|www\./i.test(t)
        || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|jp|io|co|me|ly|gl|link|app|dev|xyz|info|biz|cc|tv|to|us|uk|ru|cn|site|online|shop|top|club)\b/i.test(t);
}

// ---------------------------------------------------------------------------
// 会話の本体
// ---------------------------------------------------------------------------

function parseConv(item: Record<string, unknown> | undefined): DmConv | null {
    if (!item || typeof item.lo !== "string" || typeof item.hi !== "string") return null;
    const items = Array.isArray(item.items)
        ? (item.items as unknown[]).filter((m): m is DmMessage => {
            const x = m as Partial<DmMessage> | null;
            return !!x && typeof x.id === "string" && typeof x.from === "string" && typeof x.text === "string" && typeof x.t === "string";
        })
        : [];
    return {
        id: String(item.id ?? ""),
        lo: item.lo,
        hi: item.hi,
        items,
        state: item.state === "request" ? "request" : "inbox",
        initiator: typeof item.initiator === "string" ? item.initiator : item.lo,
        reqCount: typeof item.reqCount === "number" ? item.reqCount : 0,
        ...(typeof item.loClearedAt === "string" ? { loClearedAt: item.loClearedAt } : {}),
        ...(typeof item.hiClearedAt === "string" ? { hiClearedAt: item.hiClearedAt } : {}),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    };
}

async function readConv(lo: string, hi: string, consistent = true): Promise<DmConv | null> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: dmConvKey(lo, hi) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    return parseConv(res.Item as Record<string, unknown> | undefined);
}

/** `next` を足しても収まるように、**古い方から**落とす件数 */
export function overBudgetCount(existing: readonly DmMessage[], next: DmMessage): number {
    const size = (arr: readonly DmMessage[]) => Buffer.byteLength(JSON.stringify(arr), "utf8");
    let drop = 0;
    while (drop < existing.length && size([...existing.slice(drop), next]) > DM_ITEM_BUDGET_BYTES) drop++;
    return drop;
}

/** その人に見せるメッセージ（自分の側を消した時刻より後） */
function visibleTo(c: DmConv, uid: string): DmMessage[] {
    const cut = clearedAtOf(c, uid);
    return cut ? c.items.filter((m) => m.t > cut) : c.items;
}

// ---------------------------------------------------------------------------
// 受信箱の書き込み
// ---------------------------------------------------------------------------

export class InboxFullError extends Error {
    constructor(readonly uid: string) {
        super("dm inbox full");
        this.name = "InboxFullError";
    }
}

/**
 * 受信箱の1行を書く。**既にある行は原子的に更新する**（未読は `if_not_exists + :one`——読んでから
 * 書く形だと、同時に2通届いたとき1通ぶんが消える）。無ければ作る（`convs` の map が無い人は先に作る）。
 * 作るときだけ `size(convs) < DM_CONVS_MAX` を条件にして、**溢れたら `InboxFullError`**。
 */
async function upsertEntry(
    uid: string,
    convId: string,
    e: { peer: string; t: string; excerpt: string; state: DmEntryState },
    bump: boolean,
): Promise<void> {
    const key = { id: dmInboxId(uid) };
    for (let i = 0; i < WRITE_RETRIES; i++) {
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: key,
                UpdateExpression:
                    "SET convs.#c.#peer = :peer, convs.#c.#t = :t, convs.#c.#x = :x, convs.#c.#s = :s, "
                    + `convs.#c.#u = ${bump ? "if_not_exists(convs.#c.#u, :z) + :one" : ":z"}, updatedAt = :t`,
                ConditionExpression: "attribute_exists(convs.#c)",
                ExpressionAttributeNames: { "#c": convId, "#peer": "peer", "#t": "t", "#x": "excerpt", "#s": "state", "#u": "unread" },
                ExpressionAttributeValues: {
                    ":peer": e.peer, ":t": e.t, ":x": e.excerpt, ":s": e.state, ":z": 0, ...(bump ? { ":one": 1 } : {}),
                },
            }));
            return;
        } catch (err) {
            if (!isCcf(err)) throw err;
        }
        // 行が無い。`convs` の map を先に用意してから、上限つきで1行を足す
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: key,
            UpdateExpression: "SET convs = if_not_exists(convs, :empty), uid = :uid, updatedAt = :t",
            ExpressionAttributeValues: { ":empty": {}, ":uid": uid, ":t": e.t },
        }));
        const entry: DmEntry = { peer: e.peer, t: e.t, excerpt: e.excerpt, unread: bump ? 1 : 0, state: e.state };
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: key,
                UpdateExpression: "SET convs.#c = :entry",
                ConditionExpression: "attribute_not_exists(convs.#c) AND size(convs) < :cap",
                ExpressionAttributeNames: { "#c": convId },
                ExpressionAttributeValues: { ":entry": entry, ":cap": DM_CONVS_MAX },
            }));
            return;
        } catch (err) {
            if (!isCcf(err)) throw err;
            // 同時に誰かが作ったのか、上限なのか。行が在れば更新へ戻る
            const box = await readDmInbox(uid, true);
            if (!box.convs[convId]) throw new InboxFullError(uid);
        }
    }
    throw new Error("dm inbox upsert conflict");
}

// ---------------------------------------------------------------------------
// 送信
// ---------------------------------------------------------------------------

export type SendInput = {
    me: string;
    to: string;
    text: unknown;
    /** 冪等の鍵（再送で二重に入れない）。ストーリー返信の写しは返信の id を渡す */
    id?: string;
    via?: "story";
    /** 端末への知らせを送るか。ストーリー返信の写しは送らない（返信の通知が別に出る） */
    push: boolean;
    myName: string;
};
export type SendFail = { ok: false; status: number; message: string; code?: string };
export type SendOk = { ok: true; convId: string; message: DmMessage; state: DmEntryState };

const fail = (status: number, message: string, code?: string): SendFail => ({ ok: false, status, message, code });

/**
 * メッセージを1通送る（会話の開始も兼ねる）。**判定は全部ここ1か所**——ストーリー返信の写し
 * （`mirrorStoryReplyToDm`）も同じ門を通る。書く前に読むだけの判定を先にやり、
 * 書くのは「歯止めの加算 → 本体 → 受信箱（相手・自分）→ プッシュ」の順。
 */
export async function sendDm(inp: SendInput): Promise<SendOk | SendFail> {
    const me = inp.me.toLowerCase();
    const to = typeof inp.to === "string" ? inp.to.toLowerCase() : "";
    if (!isUserId(me) || !isUserId(to) || to === me) return fail(400, "不正なリクエスト", "badRequest");
    const text = cleanDmText(inp.text);
    if (!text) return fail(400, "メッセージを入力してください", "empty");
    const msgId = typeof inp.id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(inp.id) ? inp.id : uuidv4();

    // **ブロックされていたら 404**（ブロックと分かる応答は返さない）。自分がブロックした相手には、
    // 自分の操作なので理由を言う
    if (await isBlocked(to, me)) return fail(404, "相手が見つかりません", "notFound");
    if (await isBlocked(me, to)) return fail(403, "ブロック中の相手には送れません", "blockedByMe");
    // 退会した人には送れない（読めなかったときは通さない）
    const gone = await deletedAmong([to]);
    if (gone.unread.size > 0) return fail(500, "送信に失敗しました");
    if (gone.deleted.has(to)) return fail(404, "相手が見つかりません", "notFound");

    const lo = me < to ? me : to;
    const hi = me < to ? to : me;
    const convId = `${lo}_${hi}`;

    const [myBox, theirBox] = await Promise.all([readDmInbox(me, true), readDmInbox(to, true)]);
    // 上限は新しい会話（その人の受信箱に行が無い）だけ断る
    if (!myBox.convs[convId] && Object.keys(myBox.convs).length >= DM_CONVS_MAX) {
        return fail(409, `会話が${DM_CONVS_MAX}件に達しています。不要な会話を削除してください`, "selfFull");
    }
    if (!theirBox.convs[convId] && Object.keys(theirBox.convs).length >= DM_CONVS_MAX) {
        return fail(409, "いま送れません", "unavailable");
    }

    const now = new Date().toISOString();
    let message: DmMessage = { id: msgId, from: me, text, t: now, ...(inp.via ? { via: inp.via } : {}) };

    let followsRecipient: boolean | null = null;   // 自分が相手をフォローしているか（門）
    let autoInbox: boolean | null = null;          // 相手が自分をフォロー or 親しい友達か
    let reserved = false;
    let after: { state: ConvState; initiator: string } | null = null;
    let duplicate = false;

    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        if (attempt === WRITE_RETRIES) return fail(409, "混み合っています。もう一度お試しください", "busy");
        const conv = await readConv(lo, hi);

        // **前回の追記が通っていたら、もう足さない**（応答が失われて再送されたとき。`storyReplies.ts` と同じ）
        const stored = conv?.items.find((m) => m.id === msgId);
        if (conv && stored) {
            message = stored;
            duplicate = true;
            after = { state: conv.state, initiator: conv.initiator };
            break;
        }

        // --- 規則 ---
        let nextState: ConvState;
        let bumpReq = false;
        let setInbox = false;
        let initialReq = 0;
        if (!conv) {
            // 会話の始まり。**相手をフォローしている人だけ**
            followsRecipient ??= await isFollowing(to, me);
            if (!followsRecipient) return fail(404, "相手が見つかりません", "notFound");
            autoInbox ??= (await isFollowing(me, to)) || await isCloseFriendOf(to, me);
            nextState = autoInbox ? "inbox" : "request";
            if (nextState === "request") {
                if (containsUrl(text)) return fail(400, "承認されるまではリンクを送れません", "requestUrl");
                // 断られたあとの再送でも、送った通数は戻らない（`dec_<送り主>`）
                const prior = theirBox.declined[me] ?? 0;
                if (prior >= DM_REQUEST_MAX) return fail(429, `承認されるまでは${DM_REQUEST_MAX}通までです`, "requestLimit");
                initialReq = prior + 1;
            }
        } else if (conv.state === "request") {
            if (conv.initiator === me) {
                if (containsUrl(text)) return fail(400, "承認されるまではリンクを送れません", "requestUrl");
                if (conv.reqCount >= DM_REQUEST_MAX) return fail(429, `承認されるまでは${DM_REQUEST_MAX}通までです`, "requestLimit");
                nextState = "request";
                bumpReq = true;
            } else {
                // **受け取った人の返信が承認**
                nextState = "inbox";
                setInbox = true;
            }
        } else {
            nextState = "inbox";
        }

        // --- 歯止め（最初の1回だけ加算する） ---
        if (!reserved) {
            if (!await reserveDaily(me, !conv)) {
                return fail(429, "今日はこれ以上送れません。明日またお試しください", "dailyLimit");
            }
            reserved = true;
        }

        // --- 本体 ---
        try {
            if (!conv) {
                await ddb.send(new PutCommand({
                    TableName: PHOTOS_TABLE,
                    Item: {
                        id: dmConvKey(lo, hi), lo, hi, items: [message], state: nextState, initiator: me,
                        reqCount: initialReq, createdAt: now, updatedAt: now,
                    },
                    ConditionExpression: "attribute_not_exists(id)",
                }));
            } else {
                const drop = overBudgetCount(conv.items, message);
                const trimmed = drop > 0 || conv.items.length + 1 > DM_MESSAGES_MAX;
                const kept = [...conv.items.slice(drop), message].slice(-DM_MESSAGES_MAX);
                await ddb.send(new UpdateCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { id: dmConvKey(lo, hi) },
                    UpdateExpression:
                        `SET #items = ${trimmed ? ":kept" : "list_append(#items, :new)"}, updatedAt = :now`
                        + (setInbox ? ", #state = :inbox" : "")
                        + (bumpReq ? ", reqCount = if_not_exists(reqCount, :z) + :one" : ""),
                    ConditionExpression: "size(#items) = :len",
                    ExpressionAttributeNames: { "#items": "items", ...(setInbox ? { "#state": "state" } : {}) },
                    ExpressionAttributeValues: {
                        ":now": now, ":len": conv.items.length,
                        ...(trimmed ? { ":kept": kept } : { ":new": [message] }),
                        ...(setInbox ? { ":inbox": "inbox" } : {}),
                        ...(bumpReq ? { ":z": 0, ":one": 1 } : {}),
                    },
                }));
            }
        } catch (e) {
            if (isCcf(e)) continue;   // 誰かが先に書いた。読み直してやり直す
            throw e;
        }
        after = { state: nextState, initiator: conv?.initiator ?? me };
        break;
    }
    if (!after) return fail(409, "混み合っています。もう一度お試しください", "busy");

    // --- 受信箱（相手 → 自分）。**本体は入っているので、落ちたら 500 を返し、同じ id の再送で続きをやり直す** ---
    const excerpt = truncate(text.replace(/\s+/g, " "), DM_EXCERPT_MAX);
    const requestOpen = after.state === "request";
    const theirState: DmEntryState = requestOpen ? "request" : "inbox";
    const myState: DmEntryState = requestOpen ? "pending" : "inbox";
    try {
        await upsertEntry(to, convId, { peer: me, t: message.t, excerpt, state: theirState }, true);
        await upsertEntry(me, convId, { peer: to, t: message.t, excerpt, state: myState }, false);
    } catch (e) {
        if (e instanceof InboxFullError) {
            return fail(409, e.uid === me ? `会話が${DM_CONVS_MAX}件に達しています。不要な会話を削除してください` : "いま送れません",
                e.uid === me ? "selfFull" : "unavailable");
        }
        throw e;
    }

    // --- 端末への知らせ。**リクエストには送らない**・本文は載せない・落ちても送信は成功 ---
    if (inp.push && !duplicate && theirState === "inbox") {
        await pushDmMessage(to, { byName: inp.myName, byId: me, convId })
            .catch((e) => console.error("sendDm: プッシュに失敗:", errName(e)));
    }
    return { ok: true, convId, message, state: myState };
}

/** 相手（`owner`）の親しい友達に `who` が居るか。**読めなければ居ない扱い**（リクエストに倒す＝厳しい側） */
async function isCloseFriendOf(owner: string, who: string): Promise<boolean> {
    try {
        const list = await readUserList(closeFriendsId(owner), isCloseFriendId, `closefriends#${owner}`);
        return list.includes(who);
    } catch (e) {
        console.error("sendDm: 親しい友達を確かめられませんでした:", errName(e));
        return false;
    }
}

/** 1日の歯止めを原子的に1つ進める。上限なら false（何も進まない） */
async function reserveDaily(uid: string, isNewConv: boolean): Promise<boolean> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: dmDayKey(uid, dayOf()) },
            UpdateExpression: `SET uid = :uid, #d = :day ADD sent :one${isNewConv ? ", newConv :one" : ""}`,
            ConditionExpression: "(attribute_not_exists(sent) OR sent < :maxSent)"
                + (isNewConv ? " AND (attribute_not_exists(newConv) OR newConv < :maxNew)" : ""),
            ExpressionAttributeNames: { "#d": "day" },
            ExpressionAttributeValues: {
                ":uid": uid, ":day": dayOf(), ":one": 1, ":maxSent": DM_DAILY_SENT,
                ...(isNewConv ? { ":maxNew": DM_DAILY_NEW_CONVS } : {}),
            },
        }));
        return true;
    } catch (e) {
        if (isCcf(e)) return false;
        throw e;
    }
}

/**
 * ストーリーへの文字の返信を、会話の最初の1通として写す（`postStoryReply` の成功後・**best-effort**）。
 * 絵文字だけのリアクションは呼ばない（今まで通り消える）。**失敗しても返信は成功のまま**——
 * 落ちた理由はコードだけをログに残す。返信の通知が別に出るので、この写しではプッシュしない。
 * 返信の id を冪等の鍵にする（二重に写さない）。
 */
export async function mirrorStoryReplyToDm(p: { from: string; to: string; text: string; replyId: string; name: string }): Promise<void> {
    try {
        const r = await sendDm({ me: p.from, to: p.to, text: p.text, id: p.replyId, via: "story", push: false, myName: p.name });
        if (!r.ok) console.warn(`mirrorStoryReplyToDm: 写しませんでした（${r.code ?? r.status}）`);
    } catch (e) {
        console.error("mirrorStoryReplyToDm: 写せませんでした:", errName(e));
    }
}

// ---------------------------------------------------------------------------
// 名前の解決（受信箱には名前を持たない。表示のたびに引く）
// ---------------------------------------------------------------------------

type PeerInfo = { name: string; username?: string; deleted?: true };

async function peerInfos(ids: readonly string[]): Promise<Map<string, PeerInfo>> {
    const out = new Map<string, PeerInfo>();
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i += 100) {
        const chunk = uniq.slice(i, i + 100);
        try {
            const res = await ddb.send(new BatchGetCommand({
                RequestItems: {
                    [USERS_TABLE]: {
                        Keys: chunk.map((userId) => ({ userId })),
                        ProjectionExpression: "#u, #n, #un, #d",
                        ExpressionAttributeNames: { "#u": "userId", "#n": "displayName", "#un": "username", "#d": "deletedAt" },
                    },
                },
            }));
            for (const row of (res.Responses?.[USERS_TABLE] ?? []) as Record<string, unknown>[]) {
                const uid = row.userId;
                if (typeof uid !== "string") continue;
                // **墓石からは名前を返さない**（旧ハンドルが残るので `username` も出さない）
                if (isDeletedProfile(row)) { out.set(uid, { name: DELETED_USER_NAME, deleted: true }); continue; }
                const username = typeof row.username === "string" && row.username.trim() ? row.username.trim() : undefined;
                out.set(uid, { name: displayNameOf(row) ?? DEFAULT_NAME, ...(username ? { username } : {}) });
            }
        } catch (e) {
            // 名前が引けなくても一覧は返す（名前は保存していないので、既定名が出るだけ）
            console.error("peerInfos: 名前を引けませんでした:", errName(e));
        }
    }
    return out;
}

const fallbackPeer = (): PeerInfo => ({ name: DEFAULT_NAME });

const okJson = (body: unknown) => ({
    statusCode: 200,
    // 本人向けの内容。共有キャッシュに載せない
    headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
    body: JSON.stringify(body),
});

const shapeMessage = (m: DmMessage, me: string) => ({
    id: m.id, from: m.from, mine: m.from === me, text: m.text, t: m.t, ...(m.via ? { via: m.via } : {}),
});

// ---------------------------------------------------------------------------
// 受信箱・会話の読み
// ---------------------------------------------------------------------------

/**
 * ブロックの集合。**読めなければ返さない（投げる）**——DM は「隠すべき会話を出してしまう」方が
 * 「一時的に開けない」より悪い（通知の一覧は出す側に倒すが、会話は逆）。
 */
async function hiddenFor(uid: string): Promise<Set<string>> {
    return hiddenUserIds(uid);
}

async function listInbox(uid: string) {
    const [box, hidden] = await Promise.all([readDmInbox(uid), hiddenFor(uid)]);
    const entries = Object.entries(box.convs).filter(([, e]) => !hidden.has(e.peer));
    entries.sort((a, b) => b[1].t.localeCompare(a[1].t));
    const peers = await peerInfos(entries.map(([, e]) => e.peer));
    const visible = Object.fromEntries(entries);
    return okJson({
        items: entries.map(([id, e]) => {
            const p = peers.get(e.peer) ?? fallbackPeer();
            return {
                id, peerId: e.peer, name: p.name, ...(p.username ? { username: p.username } : {}),
                ...(p.deleted ? { deleted: true } : {}),
                t: e.t, excerpt: e.excerpt, unread: e.unread, state: e.state,
            };
        }),
        // バッジと同じ数（リクエストは含めない）
        unread: unreadConvCount(visible, hidden),
        requestCount: entries.filter(([, e]) => e.state === "request").length,
    });
}

async function getConversation(uid: string, convId: string | undefined, sinceRaw: string | undefined) {
    const pair = parseConvId(convId);
    if (!pair || (uid !== pair.lo && uid !== pair.hi)) return jsonError(404, "会話が見つかりません", "notFound");
    const peer = uid === pair.lo ? pair.hi : pair.lo;
    const hidden = await hiddenFor(uid);
    // **隠すだけで消さない**（解除で戻る）。ブロックされた側にも同じ 404
    if (hidden.has(peer)) return jsonError(404, "会話が見つかりません", "notFound");
    // 強い読み（送った直後の読み直しで、自分の送ったものが見えないことが無いように）
    const [box, conv] = await Promise.all([readDmInbox(uid, true), readConv(pair.lo, pair.hi)]);
    const entry = box.convs[convId!];
    // 受信箱に無い＝自分の側を消した（本体が相手のために残っていても見せない）
    if (!conv || !entry) return jsonError(404, "会話が見つかりません", "notFound");

    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : "";
    // **変化なしは軽い空応答**（定期の読み直しで本文を送り直さない）
    if (since && conv.updatedAt <= since) return okJson({ id: convId, unchanged: true, items: [] });

    const visible = visibleTo(conv, uid);
    const items = since ? visible.filter((m) => m.t > since) : visible;
    const peers = await peerInfos([peer]);
    const p = peers.get(peer) ?? fallbackPeer();
    const initiatorIsMe = conv.initiator === uid;
    const requestOpen = conv.state === "request";
    const remaining = requestOpen && initiatorIsMe ? Math.max(0, DM_REQUEST_MAX - conv.reqCount) : undefined;
    return okJson({
        id: convId, peerId: peer, name: p.name, ...(p.username ? { username: p.username } : {}),
        ...(p.deleted ? { deleted: true } : {}),
        state: entry.state,
        // 送れるか（退会した相手・承認待ちの3通を使い切った後は送れない）
        canSend: !p.deleted && remaining !== 0,
        ...(remaining !== undefined ? { requestRemaining: remaining } : {}),
        t: conv.updatedAt,
        items: items.map((m) => shapeMessage(m, uid)),
    });
}

// ---------------------------------------------------------------------------
// 既読・承認・削除・通報
// ---------------------------------------------------------------------------

async function markRead(uid: string, convId: string | undefined) {
    const pair = parseConvId(convId);
    if (!pair || (uid !== pair.lo && uid !== pair.hi)) return jsonError(404, "会話が見つかりません", "notFound");
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: dmInboxId(uid) },
            UpdateExpression: "SET convs.#c.#u = :z",
            ConditionExpression: "attribute_exists(convs.#c)",
            ExpressionAttributeNames: { "#c": convId!, "#u": "unread" },
            ExpressionAttributeValues: { ":z": 0 },
        }));
    } catch (e) {
        if (!isCcf(e)) throw e;   // 行が無い（消した・まだ無い）なら何もしない
    }
    return okJson({ ok: true });
}

/** 受け取ったリクエストを承認する（返信しなくても承認できる） */
async function acceptRequest(uid: string, convId: string | undefined) {
    const pair = parseConvId(convId);
    if (!pair || (uid !== pair.lo && uid !== pair.hi)) return jsonError(404, "会話が見つかりません", "notFound");
    const peer = uid === pair.lo ? pair.hi : pair.lo;
    if ((await hiddenFor(uid)).has(peer)) return jsonError(404, "会話が見つかりません", "notFound");
    const [box, conv] = await Promise.all([readDmInbox(uid, true), readConv(pair.lo, pair.hi)]);
    const entry = box.convs[convId!];
    if (!conv || !entry) return jsonError(404, "会話が見つかりません", "notFound");
    if (entry.state !== "request") return okJson({ ok: true });   // 承認済み（押し直し）
    if (conv.initiator === uid) return jsonError(400, "不正なリクエスト", "badRequest");
    const now = new Date().toISOString();
    // 本体が正。条件が外れた（既に承認された）なら続きへ進んでよい
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: dmConvKey(pair.lo, pair.hi) },
            UpdateExpression: "SET #state = :inbox, updatedAt = :now",
            ConditionExpression: "#state = :request",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":inbox": "inbox", ":request": "request", ":now": now },
        }));
    } catch (e) {
        if (!isCcf(e)) throw e;
    }
    // 自分の行を `inbox` へ。**以前この人からのリクエストを断った印があれば外す**（承認した相手に通数の足かせを残さない）
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: dmInboxId(uid) },
        UpdateExpression: "SET convs.#c.#s = :inbox REMOVE #dec",
        ConditionExpression: "attribute_exists(convs.#c)",
        ExpressionAttributeNames: { "#c": convId!, "#s": "state", "#dec": declinedAttr(peer) },
        ExpressionAttributeValues: { ":inbox": "inbox" },
    })).catch((e) => { if (!isCcf(e)) throw e; });
    // 相手の行（`pending` → `inbox`）。落ちても承認は成立している（相手の画面は次の送受信で直る）
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: dmInboxId(peer) },
        UpdateExpression: "SET convs.#c.#s = :inbox",
        ConditionExpression: "convs.#c.#s = :pending",
        ExpressionAttributeNames: { "#c": convId!, "#s": "state" },
        ExpressionAttributeValues: { ":inbox": "inbox", ":pending": "pending" },
    })).catch((e) => { if (!isCcf(e)) console.error("acceptRequest: 相手の行を直せませんでした:", errName(e)); });
    return okJson({ ok: true });
}

type RemoveMode = {
    /** 退会の掃除（受信箱の行は呼び出し側が丸ごと消す・断りの印は付けない） */
    account?: boolean;
    /** リクエストの削除として呼ばれた（リクエストでなければ 400） */
    requestOnly?: boolean;
};

/**
 * 自分の側だけ消す。**両方の受信箱から消えたら本体を物理削除**する。
 *
 *   1. 自分の受信箱の行を外す。**受け取ったリクエストを消すときは、送り主の通数を `dec_<送り主>` に残す**
 *      （消して再送されても、承認されないまま送れるのは通算3通まで。設計の点は `docs/api-reference.md`）
 *   2. 本体に「自分の側を消した時刻」を書く（以後その時刻より前のメッセージは自分に見せない）
 *   3. 相手の受信箱にも行が無ければ、本体を物理削除する（`updatedAt` が変わっていないときだけ——
 *      その間に相手が送っていたら消さない）
 */
export async function removeConversation(uid: string, convId: string | undefined, mode: RemoveMode = {}): Promise<{ status: number; error?: string }> {
    const pair = parseConvId(convId);
    if (!pair || (uid !== pair.lo && uid !== pair.hi)) return { status: 404, error: "会話が見つかりません" };
    const peer = uid === pair.lo ? pair.hi : pair.lo;
    const [box, conv] = await Promise.all([readDmInbox(uid, true), readConv(pair.lo, pair.hi)]);
    const entry = box.convs[convId!];
    if (mode.requestOnly && entry?.state !== "request") return { status: 400, error: "リクエストではありません" };

    if (!mode.account) {
        const declining = entry?.state === "request" && conv !== null && conv.initiator !== uid;
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: dmInboxId(uid) },
                UpdateExpression: "REMOVE convs.#c" + (declining ? " SET #dec = :n" : ""),
                ExpressionAttributeNames: { "#c": convId!, ...(declining ? { "#dec": declinedAttr(peer) } : {}) },
                ...(declining ? { ExpressionAttributeValues: { ":n": Math.max(conv!.reqCount, box.declined[peer] ?? 0) } } : {}),
            }));
        } catch (e) {
            // 受信箱の行（map）がまだ無い人。外すものが無い
            if ((e as { name?: string })?.name !== "ValidationException") throw e;
        }
    }

    if (!conv) return { status: 200 };
    const now = new Date().toISOString();
    let updatedAt = conv.updatedAt;
    try {
        const res = await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: dmConvKey(pair.lo, pair.hi) },
            UpdateExpression: `SET ${sideOf(pair, uid)}ClearedAt = :now`,
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":now": now },
            ReturnValues: "ALL_NEW",
        }));
        const fresh = parseConv(res.Attributes as Record<string, unknown> | undefined);
        if (fresh) updatedAt = fresh.updatedAt;
    } catch (e) {
        if (isCcf(e)) return { status: 200 };   // 本体はもう無い
        throw e;
    }
    // 相手の側にも残っていなければ、本体を消す
    const peerBox = await readDmInbox(peer, true);
    if (!peerBox.convs[convId!]) {
        await ddb.send(new DeleteCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: dmConvKey(pair.lo, pair.hi) },
            ConditionExpression: "updatedAt = :u",
            ExpressionAttributeValues: { ":u": updatedAt },
        })).catch((e) => { if (!isCcf(e)) throw e; });
    }
    return { status: 200 };
}

async function reportConversation(uid: string, convId: string | undefined, body: { reason?: unknown; note?: unknown }) {
    const pair = parseConvId(convId);
    if (!pair || (uid !== pair.lo && uid !== pair.hi)) return jsonError(404, "会話が見つかりません", "notFound");
    if (!isReportReason(body.reason)) return jsonError(400, "理由を選んでください");
    const peer = uid === pair.lo ? pair.hi : pair.lo;
    const [box, conv] = await Promise.all([readDmInbox(uid), readConv(pair.lo, pair.hi)]);
    // 自分の受信箱に在る会話だけ。**ブロック中でも通報できる**（ブロックした直後に通報するのがふつう）
    if (!conv || !box.convs[convId!]) return jsonError(404, "会話が見つかりません", "notFound");
    // **通報時点の直近20通を写して残す**（あとで相手が消しても、運営が見られる）。
    // 自分に見えているぶんだけ（自分の側を消す前のものは写さない）
    const last = visibleTo(conv, uid).slice(-DM_REPORT_LAST);
    const note = sanitizeText(body.note, REPORT_NOTE_MAX);
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: {
            id: dmReportKey(convId!, uid),
            convId, reporterId: uid, reportedId: peer,
            reason: body.reason,
            ...(note ? { note } : {}),
            messages: last.map((m) => ({ id: m.id, from: m.from, text: m.text, t: m.t })),
            createdAt: new Date().toISOString(),
        },
        // 条件は付けない。同じ人が押し直したら上書き（理由を選び直したい・直近の写しを新しくしたい）
    }));
    // 受け付けたことだけ返す
    return okJson({ success: true });
}

// ---------------------------------------------------------------------------
// 退会
// ---------------------------------------------------------------------------

/**
 * 退会の掃除。会話ごとに自分の側を外し（相手の受信箱にも無ければ本体を消す）、自分の受信箱を消す。
 * **相手の画面には会話が残る**（名前は「退会したユーザー」）。通報の写し（`dmreport#`）は消さない
 * ——運営が読むための記録で、通報された側が退会で消せると成り立たない（写真の通報と同じ）。
 * 1日の歯止めの行は今日と昨日だけ消す（日付ごとの行を列挙する索引が無い。中身は数だけ）。
 * **失敗しても退会は止めない**（呼ぶ側が握る）。
 */
export async function purgeDmFor(uid: string): Promise<void> {
    const box = await readDmInbox(uid, true);
    const ids = Object.keys(box.convs);
    for (let i = 0; i < ids.length; i += 10) {
        await Promise.all(ids.slice(i, i + 10).map((id) =>
            removeConversation(uid, id, { account: true })
                .catch((e) => console.error("purgeDmFor: 会話を外せませんでした:", errName(e)))));
    }
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: dmInboxId(uid) } }));
    for (const day of [dayOf(), dayOf(Date.now() - 24 * 3600 * 1000)]) {
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: dmDayKey(uid, day) } }))
            .catch((e) => console.error("purgeDmFor: 歯止めの行を消せませんでした:", errName(e)));
    }
}

// ---------------------------------------------------------------------------
// ハンドラ（1関数・道筋は `event.routeKey` で分ける）
// ---------------------------------------------------------------------------

const readBody = (event: { body?: string | null }): Record<string, unknown> | null => {
    try {
        const b = JSON.parse(event.body ?? "{}") as unknown;
        return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

const sendResult = (r: SendOk | SendFail) => r.ok
    ? okJson({ success: true, conversationId: r.convId, state: r.state, message: shapeMessage(r.message, r.message.from) })
    : jsonError(r.status, r.message, r.code);

/**
 * DM の全部の口。**関数を増やさない**（部品の数が上限 500 に近い——`trunk.handler` と同じ理由）。
 *
 *     POST   /dm                    会話の開始（相手 `to` と本文）。続きの送信にも使える
 *     POST   /dm/{id}/messages      会話の続きを送る
 *     GET    /dm                    受信箱（リクエストも同じ一覧。`state` で分ける）
 *     GET    /dm/{id}?since=        会話を読む（変化なしは `{unchanged:true}`）
 *     PUT    /dm/{id}/read          既読
 *     DELETE /dm/{id}               自分の側だけ消す
 *     POST   /dm/{id}/accept        リクエストを承認
 *     DELETE /dm/{id}/request       リクエストを削除（断る）
 *     POST   /dm/{id}/report        通報（直近20通の写しを残す）
 *
 * 書く口は退会した本人に 410（`liveCaller.ts`）。**DELETE は削除の系統として通す**
 * （`liveCallerGuard.test.ts` の除外）。
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");
    const route = event.routeKey;
    const id = event.pathParameters?.id;
    try {
        // 退会した本人（期限内のトークン）に書かせない。読む口と削除の口は通す
        let myName = DEFAULT_NAME;
        if (route.startsWith("POST ") || route.startsWith("PUT ")) {
            const caller = await readLiveCaller(uid, ["displayName"]);
            if ("gone" in caller) return caller.gone;
            myName = displayNameOf(caller.row) ?? DEFAULT_NAME;
        }

        if (route === "GET /dm") return await listInbox(uid);
        if (route === "GET /dm/{id}") return await getConversation(uid, id, event.queryStringParameters?.since);
        if (route === "PUT /dm/{id}/read") return await markRead(uid, id);
        if (route === "POST /dm/{id}/accept") return await acceptRequest(uid, id);
        if (route === "DELETE /dm/{id}" || route === "DELETE /dm/{id}/request") {
            const r = await removeConversation(uid, id, { requestOnly: route.endsWith("/request") });
            return r.status === 200 ? okJson({ ok: true }) : jsonError(r.status, r.error ?? "失敗しました");
        }

        const body = readBody(event);
        if (!body) return jsonError(400, "不正なリクエスト");

        if (route === "POST /dm/{id}/report") return await reportConversation(uid, id, body);
        if (route === "POST /dm") {
            return sendResult(await sendDm({
                me: uid, to: String(body.to ?? ""), text: body.text, id: typeof body.id === "string" ? body.id : undefined,
                push: true, myName,
            }));
        }
        if (route === "POST /dm/{id}/messages") {
            const pair = parseConvId(id);
            if (!pair || (uid !== pair.lo && uid !== pair.hi)) return jsonError(404, "会話が見つかりません", "notFound");
            return sendResult(await sendDm({
                me: uid, to: uid === pair.lo ? pair.hi : pair.lo, text: body.text, id: typeof body.id === "string" ? body.id : undefined,
                push: true, myName,
            }));
        }
        return jsonError(404, "見つかりません");
    } catch (e) {
        // 本文を含みうる値は出さない。名前だけ
        console.error("dm handler error:", route, errName(e));
        return jsonError(500, "処理に失敗しました");
    }
};
