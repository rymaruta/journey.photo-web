import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { BatchGetCommand, DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { assertLiveCaller } from "./liveCaller";
import { blocksId, hiddenUserIds, ids as idsOf } from "./blockCheck";
import { isFollowing } from "./followCheck";
import { readUserList, UserListError, updateUserRow } from "./userList";
import { closeFriendsId, isUserId as isCloseFriendId } from "./closeFriends";
import { isUserId } from "./userId";
import { dmDayKey, peerInfos, DM_DAILY_NEW_CONVS, type PeerInfo } from "./dm";
import { cleanMultilineText } from "./textClean";
import { sanitizeText } from "./sanitize";
import { isReportReason, REPORT_NOTE_MAX } from "./report";
import { devicesId, forgetTokens } from "./devices";
import { apnsConfigured, sendPush } from "./apns";
import { readVisiblePhoto, isPhotoId } from "./photoVisibility";
import { photoQuotesFor } from "./dmPhotoQuote";
import {
    appendGroupChat, draftEvent, draftText, groupChatKey, lastOfGroupMessage, readGroupChat, stripGroupChatFrom,
    GROUP_TEXT_MAX, type DraftMessage, type GroupEvent, type GroupLast, type GroupMessage,
} from "./groupChat";

/**
 * グループの DM（2026-11-20・札 journey.photo-ios#582。owner 承認 2026-11-12「いいよ」と 2026-11-20「いいよ」）。
 * 案は「グループチャットを簡単に」の推奨 C（新しいメッセージで2人以上、1対1に人を足す、のどれから作っても同じグループ）。
 *
 * **新しい表・GSI・TTL・SQS は作らない。** 同じ表に承認済みの行の種類を足す:
 *
 *     group#<groupId>          受信箱に並べる小さい行（名前・人数・顔の id・最後の1通・通し番号・最後に知らせた時刻・planId）
 *     groupmembers#<groupId>   メンバー（入った番号・足した人・知らせを止めたか）・招待中・断った人・外した人・作った人
 *     groupchat#<groupId>      会話（`groupChat.ts`）
 *     groupsjoined#<uid>       入っているグループ（50）・招待（20）・読んだ番号・外されたグループ・抜けたグループ
 *     groupreport#<groupId>#<uid>  通報の写し（運営の記録。退会でも消さない）
 *     dmday#<uid>#<日付>        今の DM の1日の歯止めの行に欄 `groupSent`（送る 300 通）と `groupNew`（作る 10）
 *
 * `trip#` の `groupId` と `group#` の `planId`（旅行プランとの結び付け）は承認済みだが、この版では書かない
 * （進め方の 3「旅行プランとの結び付け」で足す）。`group#` の `planId` は在れば返すだけ。
 *
 * ## 置き場（別のスタック・`serverless.groups.yml`）
 *
 * CLAUDE.md「サーバーの口は機能ごとのスタックに足す」。口の URL は user API と同じ（HttpApiId を取り込み、経路だけ置く）。
 * 口は1つの関数で、道は `event.routeKey` で分ける（`tripShare.ts`・`dm.ts` と同じ形・部品を増やさない）。
 *
 * ## 規則
 *
 *   - **メンバーでない人には、グループの有無も教えない**（404）。読む・送る・名前・人を足す、どの口も
 *   - **人数は 30 人まで**（招待中の人も数える）。1回に足せるのは 29 人まで
 *   - **入れられるのは、入れる人がフォローしている人だけ**（今の DM の「新しい会話」と同じ門）
 *   - 入れられる人が入れる人をフォロー（か親しい友達）していれば、そのまま入る（知らせ1通）。そうでなければ
 *     **招待**（リクエストの棚・知らせなし）。**「参加する」を押すまで、会話は1通も見えない**（招待中は名前・入れた人・人数だけ）
 *   - **ブロックの間柄の人は入れない**: 入れられる人が、メンバー・招待中の人・入れる人の誰かとブロックの間柄なら、
 *     その人は入らない（理由は言わない＝数だけ `notAdded` で返す）。参加するときにも確かめ直す
 *   - 断った人は、そのグループからは誰も招待し直せない。外された人を戻せるのは作った人だけ
 *   - **抜けた人・外された人を入れ直すときは、必ず招待**（そのまま入れない・知らせを鳴らさない・1日 20 人に数える）
 *   - 外された人には、外された時の名前の控えと、外されるまでの話（とその送り手）だけを見せる。今の名前・顔・人数・
 *     メンバー・外されたあとの最後の通は見せない
 *   - **抜けられる**（抜けたら読めない・受信箱から消える）。**外せるのは作った人だけ**。外された人は外されるまでの話を
 *     読めるが、送れない。作った人が抜けたら、いちばん前から居る人が作った人になる。最後の1人が抜けたらグループを消す
 *   - 名前は誰でも変えられる（案「安全と決まり」・LINE と同じ。変えた人の名前が会話に残る）。20 字まで。無くてもよい。
 *     変えるたびに送る 1 日 300 通（`groupSent`）に1通として数える（全員の会話に1行出るので、送るのと同じ重さ）
 *   - 入る前の話は見せない（入った時の通し番号より後だけ）
 *   - ブロックの間柄の人の通は、見る人の画面から外す（消さない・DM と同じ）
 *   - **写真は今の DM と同じ**: 送れるのは送る人に今見せてよい写真の札だけ（`readVisiblePhoto`）。読む人ごとに見せてよいかを
 *     決め直す（`photoQuotesFor`）。画像のファイルは渡さない（札の縮小版の URL だけ）。招待中の人には写真も見えない
 *   - **歯止め**: 送る 1 日 300 通（`groupSent`・DM・旅行プランの会話とは別に数える）、作る 1 日 10（`groupNew`）、
 *     リクエストに入る招待は 1 日 20 人（**今の DM の「新しい会話 20 人」の欄 `newConv` を一緒に使う**）、
 *     受け取る招待の棚は 20 件（溢れたら新しい招待を断る）、1 人が入れるグループは 50、返事の無い招待は 30 日で外れる
 *   - 知らせ（APNs）は**文面で送る・本文は載せない・バッジは変えない**（旅行プランの会話と同じ）。
 *     **同じ関数の中で、宛先全員の端末をまとめて1回で読み（`BatchGet`）、`sendPush` を1回だけ呼ぶ**（接続1本）。
 *     ブロックは送った人の側の2行だけ読む（両向きで同じ扱い）。同じグループで知らせてから 3 分の間は鳴らさない
 *     （`group#` の `notifiedAt`）。自分が 3 分以内に送った人・知らせを止めた人・抜けた人には送らない。束は `thread-id`
 *   - 本文はサーバーのログに出さない（失敗は `e.name` だけ）
 */

export const groupKey = (groupId: string) => `group#${groupId}`;
export const groupMembersKey = (groupId: string) => `groupmembers#${groupId}`;
export const groupsJoinedKey = (uid: string) => `groupsjoined#${uid}`;
export const groupReportKey = (groupId: string, reporter: string) => `groupreport#${groupId}#${reporter}`;

/** 1つのグループの人数（招待中の人も数える） */
export const GROUP_MEMBERS_MAX = 30;
/** 1人が入れるグループの数 */
export const GROUPS_JOINED_MAX = 50;
/** 受け取る招待の棚 */
export const GROUP_INVITES_MAX = 20;
/** 返事の無い招待が外れるまで */
export const GROUP_INVITE_TTL_MS = 30 * 24 * 3600 * 1000;
/** 1日に送れる数（`dmday#` の `groupSent`）。今の DM の `DM_DAILY_SENT` と同じ数・同じ数え方（JST の日・原子的な加算） */
export const GROUP_DAILY_SENT = 300;
/** 1日に作れるグループの数（`dmday#` の `groupNew`） */
export const GROUP_DAILY_NEW = 10;
/** リクエストに入る招待の1日の数（今の DM の新しい会話と同じ欄 `newConv` を使う） */
export const GROUP_DAILY_INVITES = DM_DAILY_NEW_CONVS;
export const GROUP_NAME_MAX = 20;
/** 同じグループで知らせを鳴らす間隔・自分が送った直後に鳴らさない間 */
export const GROUP_NOTIFY_QUIET_MS = 3 * 60 * 1000;
export const GROUP_DECLINED_MAX = 100;
export const GROUP_REMOVED_MAX = 100;
/** 受信箱に残す「外されたグループ」の数（古い方から落とす） */
export const GROUPS_REMOVED_KEEP = 20;
/** 抜けた・断ったグループの控え（退会のときに本人の通と印を消すため） */
export const GROUPS_LEFT_MAX = 500;
/** 通報で写す直近の通の数・押し直しで重ねたときの上限（DM と同じ） */
export const GROUP_REPORT_LAST = 20;
export const GROUP_REPORT_KEEP_MAX = 100;

const DEFAULT_NAME = "名前未設定さん";
const errName = (e: unknown) => (e as { name?: string })?.name ?? "Error";
const isCcf = (e: unknown) => errName(e) === "ConditionalCheckFailedException";

/** グループ ID の形（`randomUUID`）。任意の文字列を行の鍵にさせない */
export const isGroupId = (v: unknown): v is string =>
    typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const isMessageId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);

/** JST の日付（`dm.ts` の `dayOf` と同じ。日の区切りは日本の0時） */
const dayOf = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

const ok = (body: unknown, status = 200) => ({
    statusCode: status,
    headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
    body: JSON.stringify(body),
});
const notFound = () => jsonError(404, "グループが見つかりません", "notFound");

function parseJson(body: string | null | undefined): Record<string, unknown> | null {
    try {
        const v = JSON.parse(body ?? "{}") as unknown;
        return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 行の形
// ---------------------------------------------------------------------------

type Member = { id: string; at: string; by: string; /** 入った時の通し番号（これより後だけ見える） */ from: number; muted?: true };
type Invite = { id: string; by: string; at: string };
type Removed = { id: string; from: number; to: number };
type MembersRow = {
    groupId: string; ownerId: string; createdAt: string;
    members: Member[]; invited: Invite[]; declined: string[]; removed: Removed[];
};

const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseMembers(item: Record<string, unknown> | undefined): MembersRow | null {
    if (!item || !str(item.groupId) || !str(item.ownerId) || !Array.isArray(item.members)) return null;
    const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
    return {
        groupId: item.groupId,
        ownerId: item.ownerId,
        createdAt: str(item.createdAt) ? item.createdAt : "",
        members: arr(item.members).filter((m): m is Member => {
            const x = m as Partial<Member> | null;
            return !!x && str(x.id) && str(x.at) && str(x.by) && num(x.from);
        }).map((m) => ({ id: m.id, at: m.at, by: m.by, from: m.from, ...(m.muted === true ? { muted: true as const } : {}) })),
        invited: arr(item.invited).filter((m): m is Invite => {
            const x = m as Partial<Invite> | null;
            return !!x && str(x.id) && str(x.by) && str(x.at);
        }).map((m) => ({ id: m.id, by: m.by, at: m.at })),
        declined: arr(item.declined).filter(str),
        removed: arr(item.removed).filter((m): m is Removed => {
            const x = m as Partial<Removed> | null;
            return !!x && str(x.id) && num(x.from) && num(x.to);
        }).map((m) => ({ id: m.id, from: m.from, to: m.to })),
    };
}

const membersFields = (r: MembersRow) => ({
    groupId: r.groupId, ownerId: r.ownerId, createdAt: r.createdAt,
    members: r.members, invited: r.invited, declined: r.declined, removed: r.removed,
});

const liveInvites = (r: Pick<MembersRow, "invited">, now = Date.now()) =>
    r.invited.filter((i) => now - Date.parse(i.at) < GROUP_INVITE_TTL_MS);
const memberOf = (r: MembersRow, uid: string) => r.members.find((m) => m.id === uid);
const seatsUsed = (r: MembersRow, now = Date.now()) => r.members.length + liveInvites(r, now).length;

async function readMembers(groupId: string): Promise<MembersRow | null> {
    if (!isGroupId(groupId)) return null;
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupMembersKey(groupId) }, ConsistentRead: true }));
    return parseMembers(res.Item as Record<string, unknown> | undefined);
}

/** メンバーの行を CAS で書き換える。`mutate` が null を返せば書かない。行が無ければ `mutate(null)` */
async function updateMembers(groupId: string, mutate: (r: MembersRow | null) => MembersRow | null): Promise<void> {
    await updateUserRow(groupMembersKey(groupId), groupId, (item) => {
        const next = mutate(parseMembers(item));
        return next ? membersFields(next) : null;
    });
}

type Summary = {
    groupId: string; name?: string; memberCount: number; faceIds: string[];
    last?: GroupLast; seq: number; notifiedAt?: string; planId?: string; createdAt: string;
};

function parseSummary(item: Record<string, unknown> | undefined): Summary | null {
    if (!item || !str(item.groupId)) return null;
    const last = item.last as GroupLast | undefined;
    return {
        groupId: item.groupId,
        ...(str(item.name) && item.name ? { name: item.name } : {}),
        memberCount: num(item.memberCount) ? item.memberCount : 0,
        faceIds: Array.isArray(item.faceIds) ? (item.faceIds as unknown[]).filter(str) : [],
        ...(last && str(last.from) && str(last.t) ? { last } : {}),
        seq: num(item.seq) ? item.seq : 0,
        ...(str(item.notifiedAt) ? { notifiedAt: item.notifiedAt } : {}),
        ...(str(item.planId) ? { planId: item.planId } : {}),
        createdAt: str(item.createdAt) ? item.createdAt : "",
    };
}

const summaryFields = (s: Summary) => ({
    groupId: s.groupId, memberCount: s.memberCount, faceIds: s.faceIds, seq: s.seq, createdAt: s.createdAt,
    ...(s.name ? { name: s.name } : {}), ...(s.last ? { last: s.last } : {}),
    ...(s.notifiedAt ? { notifiedAt: s.notifiedAt } : {}), ...(s.planId ? { planId: s.planId } : {}),
});

async function readSummary(groupId: string): Promise<Summary | null> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupKey(groupId) }, ConsistentRead: true }));
    return parseSummary(res.Item as Record<string, unknown> | undefined);
}

async function updateSummary(groupId: string, mutate: (s: Summary) => Summary | null): Promise<void> {
    await updateUserRow(groupKey(groupId), groupId, (item) => {
        const cur = parseSummary(item);
        if (!cur) return null;
        const next = mutate(cur);
        return next ? summaryFields(next) : null;
    });
}

/** 顔に使う id（入った順に4人まで）と人数を、メンバーの行から写す */
async function refreshSummary(groupId: string, r: MembersRow): Promise<void> {
    const faceIds = r.members.slice(0, 4).map((m) => m.id);
    await updateSummary(groupId, (s) => {
        if (s.memberCount === r.members.length && s.faceIds.join() === faceIds.join()) return null;
        return { ...s, memberCount: r.members.length, faceIds };
    }).catch((e) => console.error(`groups: 受信箱の行を直せませんでした（${groupId}）:`, errName(e)));
}

type JoinedInvite = { g: string; by: string; t: string };
/** 外された時の控え（外された人には、外された時に知っていた名前だけを見せる。今の名前・顔・人数は見せない） */
type RemovedInfo = { t: string; name?: string };
type Joined = {
    list: string[]; reads: Record<string, number>; invites: JoinedInvite[]; removed: string[]; left: string[];
    removedInfo: Record<string, RemovedInfo>;
};

function parseJoined(item: Record<string, unknown> | undefined): Joined {
    const gids = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter(isGroupId) : []);
    const reads: Record<string, number> = {};
    const raw = item?.reads;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isGroupId(k) && num(v)) reads[k] = v;
    }
    const removedInfo: Record<string, RemovedInfo> = {};
    const rawInfo = item?.removedInfo;
    if (rawInfo && typeof rawInfo === "object" && !Array.isArray(rawInfo)) {
        for (const [k, v] of Object.entries(rawInfo as Record<string, unknown>)) {
            const x = v as Partial<RemovedInfo> | null;
            if (isGroupId(k) && x && str(x.t)) removedInfo[k] = { t: x.t, ...(str(x.name) && x.name ? { name: x.name } : {}) };
        }
    }
    const invites = Array.isArray(item?.invites)
        ? (item!.invites as unknown[]).filter((x): x is JoinedInvite => {
            const i = x as Partial<JoinedInvite> | null;
            return !!i && isGroupId(i.g) && str(i.by) && str(i.t);
        }).map((i) => ({ g: i.g, by: i.by, t: i.t }))
        : [];
    const removed = gids(item?.removed);
    for (const k of Object.keys(removedInfo)) if (!removed.includes(k)) delete removedInfo[k];
    return { list: gids(item?.list), reads, invites, removed, left: gids(item?.left), removedInfo };
}

/** 外されたグループの印を受信箱から外す（控えも一緒に） */
function dropRemoved(j: Joined, g: string): Pick<Joined, "removed" | "removedInfo"> {
    const { [g]: _gone, ...removedInfo } = j.removedInfo;
    void _gone;
    return { removed: j.removed.filter((x) => x !== g), removedInfo };
}

async function readJoined(uid: string): Promise<Joined> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupsJoinedKey(uid) }, ConsistentRead: true }));
    return parseJoined(res.Item as Record<string, unknown> | undefined);
}

async function updateJoined(uid: string, mutate: (j: Joined) => Joined | null): Promise<void> {
    await updateUserRow(groupsJoinedKey(uid), uid, (item) => {
        const next = mutate(parseJoined(item));
        return next ? { ...next } : null;
    });
}

const liveJoinedInvites = (j: Joined, now = Date.now()) => j.invites.filter((i) => now - Date.parse(i.t) < GROUP_INVITE_TTL_MS);
const withoutRead = (reads: Record<string, number>, g: string) => {
    const { [g]: _gone, ...rest } = reads;
    void _gone;
    return rest;
};
const remember = (left: string[], g: string) => [g, ...left.filter((x) => x !== g)].slice(0, GROUPS_LEFT_MAX);

/** 会話の通し番号だけを読む（入った・外した時の番号に使う） */
async function currentSeq(groupId: string): Promise<number> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE, Key: { id: groupChatKey(groupId) }, ConsistentRead: true,
        ProjectionExpression: "#s", ExpressionAttributeNames: { "#s": "seq" },
    }));
    return num(res.Item?.seq) ? res.Item!.seq as number : 0;
}

// ---------------------------------------------------------------------------
// 1日の歯止め（`dmday#<uid>#<日付>`。DM の `reserveDaily` と同じ数え方）
// ---------------------------------------------------------------------------

/** `field` を `k` 進める。上限 `max` を越えるなら false（何も進まない） */
export async function reserveGroupDaily(uid: string, field: "groupSent" | "groupNew" | "newConv", max: number, k = 1): Promise<boolean> {
    if (k <= 0) return true;
    if (k > max) return false;
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: dmDayKey(uid, dayOf()) },
            UpdateExpression: "SET uid = :uid, #d = :day ADD #f :k",
            ConditionExpression: "attribute_not_exists(#f) OR #f <= :lim",
            ExpressionAttributeNames: { "#d": "day", "#f": field },
            ExpressionAttributeValues: { ":uid": uid, ":day": dayOf(), ":k": k, ":lim": max - k },
        }));
        return true;
    } catch (e) {
        if (isCcf(e)) return false;
        throw e;
    }
}

/**
 * 進めた数を戻す（作るのが途中で止まった・枠で入れなかった人の招待・同じ id の送り直しが同時に来た）。
 * **戻せなくても本体は止めない**（数が多めに残るのは厳しい側）
 */
async function releaseGroupDaily(uid: string, field: "groupSent" | "groupNew" | "newConv", k = 1): Promise<void> {
    if (k <= 0) return;
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: dmDayKey(uid, dayOf()) },
        UpdateExpression: "ADD #f :k",
        ConditionExpression: "attribute_exists(#f)",
        ExpressionAttributeNames: { "#f": field },
        ExpressionAttributeValues: { ":k": -k },
    })).catch((e) => console.error(`groups: 1日の数を戻せませんでした（${field}）:`, errName(e)));
}

/**
 * 入った人の「見え始める位置」の仮の値。メンバーの行に入れた**あとで**会話の番号を読み、`settleFrom` で本当の値に直す
 * （先に読むと、読んでから入るまでの間に書かれた通が見えてしまう）。仮の間は1通も見えない
 */
const PENDING_FROM = Number.MAX_SAFE_INTEGER;

/** `ids` の見え始める位置を、今の会話の番号に直す。直した番号を返す */
async function settleFrom(groupId: string, ids: readonly string[]): Promise<number> {
    const seq = await currentSeq(groupId);
    await updateMembers(groupId, (cur) => {
        if (!cur) return null;
        let changed = false;
        const members = cur.members.map((m) => {
            if (!ids.includes(m.id) || m.from !== PENDING_FROM) return m;
            changed = true;
            return { ...m, from: seq };
        });
        return changed ? { ...cur, members } : null;
    });
    return seq;
}

// ---------------------------------------------------------------------------
// 名前
// ---------------------------------------------------------------------------

const nameIn = (names: Map<string, PeerInfo>, id: string) => names.get(id)?.name ?? DEFAULT_NAME;

/** 名前を付けていないグループの見え方（見る人を除いた最初の2人・残りは「ほか N 人」）。区切りは「、」 */
function displayNameFor(s: Pick<Summary, "name" | "faceIds" | "memberCount">, viewer: string, names: Map<string, PeerInfo>): string {
    if (s.name) return s.name;
    const others = s.faceIds.filter((id) => id !== viewer).slice(0, 2);
    if (others.length === 0) return "グループ";
    const total = s.memberCount - (s.faceIds.includes(viewer) ? 1 : 0);
    const rest = total - others.length;
    return others.map((id) => nameIn(names, id)).join("、") + (rest > 0 ? `、ほか${rest}人` : "");
}

const facesFor = (s: Pick<Summary, "faceIds">, viewer: string, names: Map<string, PeerInfo>) =>
    s.faceIds.filter((id) => id !== viewer).slice(0, 2).map((id) => ({ id, name: nameIn(names, id) }));

// ---------------------------------------------------------------------------
// 人を入れる門
// ---------------------------------------------------------------------------

/** 相手（`owner`）の親しい友達に `who` が居るか。**読めなければ居ない扱い**（招待に倒す＝厳しい側・`dm.ts` と同じ） */
async function isCloseFriendOf(owner: string, who: string): Promise<boolean> {
    try {
        return (await readUserList(closeFriendsId(owner), isCloseFriendId, `closefriends#${owner}`)).includes(who);
    } catch (e) {
        console.error("groups: 親しい友達を確かめられませんでした:", errName(e));
        return false;
    }
}

type Gate = { direct: string[]; invite: string[]; notAdded: number };

/**
 * 入れようとしている人を、門に通す。**読むだけ**（書くのは呼ぶ側）。
 * 通らなかった人は数だけ返す（理由は言わない。ブロックと分かる答えを返さない）
 */
async function gateTargets(actor: string, row: MembersRow, candidates: readonly string[]): Promise<Gate> {
    const now = Date.now();
    const present = new Set([...row.members.map((m) => m.id), ...liveInvites(row, now).map((i) => i.id)]);
    const isOwner = row.ownerId === actor;
    const infos = await peerInfos(candidates);
    const checked = await Promise.all(candidates.map(async (c) => {
        if (infos.get(c)?.deleted || row.declined.includes(c)) return null;
        if (!isOwner && row.removed.some((x) => x.id === c)) return null;
        // **入れる人が相手をフォローしている**（今の DM の新しい会話と同じ門）
        if (!await isFollowing(c, actor)) return null;
        const [hidden, followsBack, joined] = await Promise.all([hiddenUserIds(c), isFollowing(actor, c), readJoined(c)]);
        // 🔴 **抜けた人・外された人は、必ず招待**（本人が「参加する」を押すまで入らない・知らせも鳴らない・1日 20 人の数に入る・
        // 断ったら招待し直せない）。そのまま入れると、抜けた人を何度でも引き戻して毎回知らせを鳴らせてしまう
        const wasHere = row.removed.some((x) => x.id === c) || joined.left.includes(row.groupId);
        const direct = !wasHere && (followsBack || await isCloseFriendOf(c, actor));
        if (direct ? !joined.list.includes(row.groupId) && joined.list.length >= GROUPS_JOINED_MAX
            : liveJoinedInvites(joined, now).filter((i) => i.g !== row.groupId).length >= GROUP_INVITES_MAX) return null;
        return { c, hidden, direct };
    }));
    const out: Gate = { direct: [], invite: [], notAdded: 0 };
    const inside = new Set([...present, actor]);
    for (const x of checked) {
        // メンバー・招待中・入れる人・この回にもう通った人の誰かとブロックの間柄なら入れない
        if (!x || [...inside].some((m) => x.hidden.has(m))) { out.notAdded++; continue; }
        inside.add(x.c);
        (x.direct ? out.direct : out.invite).push(x.c);
    }
    return out;
}

/** 本文の `userIds`（`memberIds`）を、重複・自分・形の違うものを落として返す。形が違えば null */
function targetIds(v: unknown, me: string): string[] | null {
    if (!Array.isArray(v)) return null;
    const out: string[] = [];
    for (const x of v) {
        if (typeof x !== "string" || !isUserId(x)) return null;
        const id = x.toLowerCase();
        if (id !== me && !out.includes(id)) out.push(id);
    }
    return out;
}

/**
 * 門を通った人を書き込む（メンバーの行 → 本人たちの一覧の行）。一覧の枠が同時に埋まった人は戻す。
 * 実際に入った人と招待した人を返す
 */
async function admit(groupId: string, actor: string, gate: Gate, fromSeq?: number): Promise<{ direct: string[]; invite: string[]; full: boolean }> {
    const now = new Date().toISOString();
    // 作るときは 0（「作りました」の1行から見える）。あとから足すときは、メンバーの行に入れた**あとの**番号
    // （`settleFrom`。入る前の話は見せない）
    let from = fromSeq ?? PENDING_FROM;
    let direct: string[] = [];
    let invite: string[] = [];
    let full = false;
    await updateMembers(groupId, (r) => {
        direct = []; invite = []; full = false;
        if (!r || !memberOf(r, actor)) return null;
        const live = liveInvites(r);
        const present = new Set([...r.members.map((m) => m.id), ...live.map((i) => i.id)]);
        let seats = r.members.length + live.length;
        const members = [...r.members];
        const invited = [...live];
        for (const [list, out] of [[gate.direct, direct], [gate.invite, invite]] as const) {
            for (const id of list) {
                if (present.has(id)) continue;
                if (seats >= GROUP_MEMBERS_MAX) { full = true; continue; }
                seats++;
                present.add(id);
                out.push(id);
                if (out === direct) members.push({ id, at: now, by: actor, from });
                else invited.push({ id, by: actor, at: now });
            }
        }
        if (direct.length === 0 && invite.length === 0) return null;
        // 外された印は、招待では外さない（参加したときに外す。招待が切れたあとも「作った人だけが戻せる」を保つ）
        return { ...r, members, invited, removed: r.removed.filter((x) => !direct.includes(x.id)) };
    });
    if (fromSeq === undefined && direct.length > 0) from = await settleFrom(groupId, direct);
    const undo: string[] = [];
    for (const id of direct) {
        let over = false;
        await updateJoined(id, (j) => {
            over = false;
            if (j.list.includes(groupId)) return null;
            if (j.list.length >= GROUPS_JOINED_MAX) { over = true; return null; }
            return {
                ...j, list: [groupId, ...j.list], reads: { ...j.reads, [groupId]: from },
                invites: j.invites.filter((i) => i.g !== groupId), ...dropRemoved(j, groupId),
            };
        });
        if (over) undo.push(id);
    }
    for (const id of invite) {
        let over = false;
        await updateJoined(id, (j) => {
            over = false;
            const live = liveJoinedInvites(j).filter((i) => i.g !== groupId);
            if (live.length >= GROUP_INVITES_MAX) { over = true; return null; }
            // 外されたグループの行は受信箱から外し、招待の棚に出す（同じグループが2か所に出ない）
            return { ...j, invites: [{ g: groupId, by: actor, t: now }, ...live], ...dropRemoved(j, groupId) };
        });
        if (over) undo.push(id);
    }
    if (undo.length > 0) {
        await updateMembers(groupId, (r) => r && ({
            ...r, members: r.members.filter((m) => !undo.includes(m.id)), invited: r.invited.filter((i) => !undo.includes(i.id)),
        }));
        direct = direct.filter((x) => !undo.includes(x));
        invite = invite.filter((x) => !undo.includes(x));
    }
    return { direct, invite, full };
}

// ---------------------------------------------------------------------------
// 知らせ
// ---------------------------------------------------------------------------

/** 宛先全員の端末をまとめて読む（`BatchGet`・100件ずつ）。端末 → 持ち主 */
async function tokensOf(uids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < uids.length; i += 100) {
        const chunk = uids.slice(i, i + 100);
        try {
            const res = await ddb.send(new BatchGetCommand({
                RequestItems: {
                    [PHOTOS_TABLE]: {
                        Keys: chunk.map((u) => ({ id: devicesId(u) })),
                        ProjectionExpression: "#i, #t",
                        ExpressionAttributeNames: { "#i": "id", "#t": "tokens" },
                    },
                },
            }));
            for (const row of (res.Responses?.[PHOTOS_TABLE] ?? []) as Record<string, unknown>[]) {
                const owner = str(row.id) ? row.id.slice("devices#".length) : "";
                const raw = row.tokens;
                const toks = raw instanceof Set ? [...raw].map(String) : Array.isArray(raw) ? raw.map(String) : [];
                for (const t of toks) out.set(t, owner);
            }
        } catch (e) {
            console.error("groups: 端末を引けませんでした:", errName(e));
        }
    }
    return out;
}

/**
 * 知らせを送る（文面・本文は載せない・バッジは変えない）。**接続1本・`sendPush` を1回**。
 * **送れなくても本体の操作は成功のまま**（ログだけ）。宛先のふるいは呼ぶ側が済ませる
 */
async function pushTo(to: readonly string[], groupId: string, alert: { title: string; body: string }): Promise<void> {
    if (!apnsConfigured() || to.length === 0) return;
    try {
        const owners = await tokensOf(to);
        if (owners.size === 0) return;
        const result = await sendPush([...owners.keys()], { ...alert, threadId: groupId, data: { type: "group", groupId } });
        const dead = new Map<string, string[]>();
        for (const t of result.invalid) {
            const o = owners.get(t);
            if (o) dead.set(o, [...(dead.get(o) ?? []), t]);
        }
        for (const [o, ts] of dead) await forgetTokens(o, ts);
    } catch (e) {
        console.error("groups: 知らせを送れませんでした:", errName(e));
    }
}

/** 知らせの題（名前が無ければ、送った人を除いた最初の2人） */
const pushTitle = (s: Summary, sender: string, names: Map<string, PeerInfo>) => displayNameFor(s, sender, names);

// ---------------------------------------------------------------------------
// 画面に返す形
// ---------------------------------------------------------------------------

/** 自分がブロックした人（メンバーの一覧で自分にだけ「ブロック中」と出す。相手からのブロックは出さない） */
async function myBlocks(me: string): Promise<Set<string>> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(me) } }));
    return new Set(idsOf(res.Item as Record<string, unknown> | undefined, "blockedIds"));
}

async function detailBody(me: string, r: MembersRow, s: Summary) {
    const live = liveInvites(r);
    const [names, blocked] = await Promise.all([
        peerInfos([...r.members.map((m) => m.id), ...live.flatMap((i) => [i.id, i.by])]),
        myBlocks(me),
    ]);
    const mine = memberOf(r, me);
    return {
        state: "member" as const,
        group: groupView(s, me, names),
        isOwner: r.ownerId === me,
        muted: mine?.muted === true,
        membersMax: GROUP_MEMBERS_MAX,
        members: r.members.map((m) => ({
            id: m.id, name: nameIn(names, m.id),
            ...(names.get(m.id)?.username ? { username: names.get(m.id)!.username } : {}),
            ...(m.id === r.ownerId ? { owner: true } : {}),
            ...(blocked.has(m.id) ? { blocked: true } : {}),
        })),
        invited: live.map((i) => ({ id: i.id, name: nameIn(names, i.id), invitedBy: i.by })),
    };
}

function groupView(s: Summary, me: string, names: Map<string, PeerInfo>) {
    return {
        groupId: s.groupId,
        name: s.name ?? null,
        displayName: displayNameFor(s, me, names),
        faces: facesFor(s, me, names),
        memberCount: s.memberCount,
        createdAt: s.createdAt,
        ...(s.planId ? { planId: s.planId } : {}),
    };
}

/** 外された人に見せるグループ（外された時に知っていた名前だけ。今の名前・顔・人数・最後の通は出さない） */
function removedView(groupId: string, info: RemovedInfo | undefined, createdAt: string) {
    return {
        groupId,
        name: info?.name ?? null,
        displayName: info?.name ?? "外されたグループ",
        faces: [] as Array<{ id: string; name: string }>,
        state: "removed" as const,
        unread: 0,
        updatedAt: info?.t ?? createdAt,
    };
}

/** 1通を画面に出す形（写真は読む人ごとの札） */
function shapeMessage(m: GroupMessage, me: string, quotes: Map<string, unknown>) {
    return {
        id: m.id, n: m.n, from: m.from, mine: m.from === me, t: m.t,
        ...(m.text ? { text: m.text } : {}),
        ...(m.photoId ? { photo: quotes.get(m.photoId) ?? { id: m.photoId, state: "gone" } } : {}),
        ...(m.event ? { event: m.event } : {}),
    };
}

/** その人に見える範囲（メンバーは入った後、外された人は外されるまで）。どちらでもなければ null */
function windowOf(r: MembersRow, me: string): { from: number; to: number; state: "member" | "removed" } | null {
    const m = memberOf(r, me);
    if (m) return { from: m.from, to: Infinity, state: "member" };
    const x = [...r.removed].reverse().find((v) => v.id === me);
    return x ? { from: x.from, to: x.to, state: "removed" } : null;
}

// ---------------------------------------------------------------------------
// 口
// ---------------------------------------------------------------------------

/** GET /groups — 一覧（入っているグループ・外されたグループ・招待） */
async function inbox(me: string) {
    const [joined, hidden] = await Promise.all([readJoined(me), hiddenUserIds(me)]);
    const invites = liveJoinedInvites(joined).filter((i) => !joined.list.includes(i.g));
    const removed = joined.removed.filter((g) => !joined.list.includes(g));
    const keys = [...new Set([...joined.list, ...removed, ...invites.map((i) => i.g)])];
    const rows = new Map<string, Summary>();
    for (let i = 0; i < keys.length; i += 100) {
        const res = await ddb.send(new BatchGetCommand({
            RequestItems: { [PHOTOS_TABLE]: { Keys: keys.slice(i, i + 100).map((g) => ({ id: groupKey(g) })) } },
        }));
        for (const it of (res.Responses?.[PHOTOS_TABLE] ?? []) as Record<string, unknown>[]) {
            const s = parseSummary(it);
            if (s) rows.set(s.groupId, s);
        }
    }
    // 外されたグループの行（`group#`）は名前や最後の通を読むのに使わない（在るかを見るだけ）
    const memberRows = joined.list.map((g) => rows.get(g)).filter((s): s is Summary => !!s);
    const nameIds = memberRows.flatMap((s) => [...s.faceIds, ...(s.last ? [s.last.from] : [])]);
    const inviteIds = invites.flatMap((i) => [i.by, ...(rows.get(i.g)?.faceIds ?? [])]);
    const names = await peerInfos([...new Set([...nameIds, ...inviteIds])]);
    const item = (g: string) => {
        const s = rows.get(g);
        if (!s) return null;
        const last = s.last && !hidden.has(s.last.from) ? s.last : undefined;
        return {
            ...groupView(s, me, names),
            state: "member" as const,
            unread: Math.max(0, s.seq - (joined.reads[g] ?? s.seq)),
            ...(last ? { last: { ...last, fromName: nameIn(names, last.from), mine: last.from === me } } : {}),
            updatedAt: last?.t ?? s.createdAt,
        };
    };
    const groups = [
        ...joined.list.map((g) => item(g)),
        // 🔴 外された人には、外されたあとの話（最後の通）・今の名前・顔・人数を見せない。外された時の名前の控えだけ。未読は0
        ...removed.map((g) => (rows.has(g) ? removedView(g, joined.removedInfo[g], rows.get(g)!.createdAt) : null)),
    ]
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    const inv = invites.map((i) => {
        const s = rows.get(i.g);
        if (!s || hidden.has(i.by)) return null;
        return {
            groupId: s.groupId, name: s.name ?? null, displayName: displayNameFor(s, me, names), faces: facesFor(s, me, names),
            memberCount: s.memberCount, invitedBy: { id: i.by, name: nameIn(names, i.by) }, invitedAt: i.t,
        };
    }).filter((x): x is NonNullable<typeof x> => !!x);
    return ok({ groups, invites: inv });
}

/** POST /groups — 作る。本文 `{ memberIds: string[] (2〜29), name? }` */
async function create(me: string, body: Record<string, unknown>) {
    const targets = targetIds(body.memberIds, me);
    if (!targets || targets.length < 2) return jsonError(400, "2人以上を選んでください", "badRequest");
    if (targets.length > GROUP_MEMBERS_MAX - 1) return jsonError(403, `グループは${GROUP_MEMBERS_MAX}人までです`, "full");
    const name = body.name === undefined || body.name === null ? undefined : sanitizeText(body.name, GROUP_NAME_MAX);
    const mineNow = await readJoined(me);
    if (mineNow.list.length >= GROUPS_JOINED_MAX) {
        return jsonError(403, `入れるグループは${GROUPS_JOINED_MAX}個までです。使わないグループから抜けてください`, "joinedFull");
    }
    const groupId = randomUUID();
    const now = new Date().toISOString();
    const seed: MembersRow = {
        groupId, ownerId: me, createdAt: now, members: [{ id: me, at: now, by: me, from: 0 }], invited: [], declined: [], removed: [],
    };
    const gate = await gateTargets(me, seed, targets);
    if (gate.direct.length + gate.invite.length === 0) return jsonError(404, "相手が見つかりません", "notFound");
    if (!await reserveGroupDaily(me, "groupNew", GROUP_DAILY_NEW)) {
        return jsonError(429, "今日はこれ以上グループを作れません。明日またお試しください", "dailyLimit");
    }
    if (gate.invite.length > 0 && !await reserveGroupDaily(me, "newConv", GROUP_DAILY_INVITES, gate.invite.length)) {
        gate.notAdded += gate.invite.length;
        gate.invite = [];
        if (gate.direct.length === 0) {
            // 作らなかったので、作る数は戻す
            await releaseGroupDaily(me, "groupNew");
            return jsonError(429, "今日はこれ以上招待できません。明日またお試しください", "dailyLimit");
        }
    }
    // 先に自分の一覧に席を取る（50 の枠を書くときにも確かめる。同時に作っても 50 を越えない）
    let over = false;
    await updateJoined(me, (j) => {
        over = false;
        if (j.list.length >= GROUPS_JOINED_MAX) { over = true; return null; }
        return { ...j, list: [groupId, ...j.list.filter((g) => g !== groupId)], reads: { ...j.reads, [groupId]: 0 } };
    });
    if (over) {
        await releaseGroupDaily(me, "groupNew");
        await releaseGroupDaily(me, "newConv", gate.invite.length);
        return jsonError(403, `入れるグループは${GROUPS_JOINED_MAX}個までです。使わないグループから抜けてください`, "joinedFull");
    }
    // 本体（会話の「作りました」→ メンバー → 受信箱の行）。人は `admit` で足す（枠と一覧を同じ道で見る）
    const { seq, messages: createdEv } = await appendGroupChat(groupId, [draftEvent(me, { type: "created" })]);
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: groupMembersKey(groupId), uid: groupId, rev: 1, updatedAt: now, ...membersFields(seed) },
        ConditionExpression: "attribute_not_exists(id)",
    }));
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: {
            id: groupKey(groupId), uid: groupId, rev: 1, updatedAt: now,
            ...summaryFields({
                groupId, ...(name ? { name } : {}), memberCount: 1, faceIds: [me], seq, createdAt: now,
                ...(createdEv[0] ? { last: lastOfGroupMessage(createdEv[0]) } : {}),
            }),
        },
        ConditionExpression: "attribute_not_exists(id)",
    }));
    await markRead(me, groupId, seq);
    const added = await admit(groupId, me, gate, 0);
    // 枠で入れなかった人の招待の数は戻す
    await releaseGroupDaily(me, "newConv", gate.invite.length - added.invite.length);
    const notAdded = gate.notAdded + (gate.direct.length + gate.invite.length - added.direct.length - added.invite.length);
    const r = await readMembers(groupId);
    if (!r) return jsonError(500, "うまくいきませんでした。もう一度お試しください");
    await refreshSummary(groupId, r);
    if (added.direct.length > 0) await afterAdded(groupId, me, added.direct, "created");
    const s = await readSummary(groupId);
    return s ? ok({ ...(await detailBody(me, r, s)), notAdded }, 201) : notFound();
}

/** 足した人を会話に1行・そのまま入った人へ知らせ1通 */
async function afterAdded(groupId: string, actor: string, direct: string[], kind: "created" | "added") {
    if (kind === "added") await postEvent(groupId, draftEvent(actor, { type: "added", targets: direct }));
    const s = await readSummary(groupId);
    if (!s) return;
    const names = await peerInfos([actor]);
    // そのまま入った人は入れた人をフォロー（か親しい友達）している。ブロックの間柄は門で外してある。
    // 🔴 **宛先全員に同じ文面で `sendPush` を1回（接続1本）**。1人ずつ送ると 29 人で関数の上限 15 秒を越える。
    // そのため題は受け取る人ごとの呼び名にせず、名前が無ければ「グループ」とだけ言う
    await pushTo(direct, groupId, { title: s.name ?? "グループ", body: `${nameIn(names, actor)} があなたをグループに入れました` });
}

/**
 * 会話の最後の1通と番号を受信箱の行に写す（番号が進むときだけ・後から来た古い書き込みで巻き戻さない）。
 * 知らせを鳴らしてよい（同じグループで3分空いた）なら `notifiedAt` を進めて true（CAS なので同時の2通で二度鳴らない）
 */
async function bumpSummary(groupId: string, top: number, last: GroupLast | undefined, wantNotify = false):
    Promise<{ notify: boolean; summary: Summary | null }> {
    let notify = false;
    let summary: Summary | null = null;
    const now = Date.now();
    await updateSummary(groupId, (s) => {
        notify = false;
        summary = s;
        const quiet = s.notifiedAt ? now - Date.parse(s.notifiedAt) < GROUP_NOTIFY_QUIET_MS : false;
        const next: Summary = { ...s, ...(top >= s.seq ? { seq: top, ...(last ? { last } : {}) } : {}) };
        if (wantNotify && !quiet) {
            notify = true;
            next.notifiedAt = new Date(now).toISOString();
        }
        summary = next;
        if (!notify && next.seq === s.seq) return null;
        return next;
    });
    return { notify, summary };
}

/** 会話の真ん中の1行（作った・足した・参加した…）を足し、受信箱の行に写す */
async function postEvent(groupId: string, draft: DraftMessage): Promise<number> {
    const { seq, messages } = await appendGroupChat(groupId, [draft]);
    await bumpSummary(groupId, seq, messages.length > 0 ? lastOfGroupMessage(messages[messages.length - 1]) : undefined);
    return seq;
}

/** GET /groups/{groupId} — 詳しい（メンバー・招待中・作った人・知らせ）。招待中の人には名前・入れた人・人数だけ */
async function detail(me: string, groupId: string) {
    const [r, s] = await Promise.all([readMembers(groupId), readSummary(groupId)]);
    if (!r || !s) return notFound();
    if (memberOf(r, me)) return ok(await detailBody(me, r, s));
    const inv = liveInvites(r).find((i) => i.id === me);
    if (inv) {
        const names = await peerInfos([inv.by, ...s.faceIds]);
        return ok({
            state: "invited",
            group: { groupId, name: s.name ?? null, displayName: displayNameFor(s, me, names), faces: facesFor(s, me, names), memberCount: s.memberCount },
            invitedBy: { id: inv.by, name: nameIn(names, inv.by) },
        });
    }
    if (windowOf(r, me)?.state === "removed") {
        // 今の名前・顔・人数・メンバーは返さない（外された時の名前の控えだけ）
        const j = await readJoined(me);
        const { state: _s, unread: _u, updatedAt: _t, ...group } = removedView(groupId, j.removedInfo[groupId], s.createdAt);
        void _s; void _u; void _t;
        return ok({ state: "removed", group });
    }
    return notFound();
}

/** GET /groups/{groupId}/messages — 会話（読んだ位置も進める）。メンバーと、外された人（外されるまでの話）だけ */
async function readMessages(me: string, groupId: string) {
    const r = await readMembers(groupId);
    const w = r ? windowOf(r, me) : null;
    if (!r || !w) return notFound();
    const [chat, hidden] = await Promise.all([readGroupChat(groupId), hiddenUserIds(me)]);
    const visible = chat.items.filter((m) => m.n > w.from && m.n <= w.to && !hidden.has(m.from));
    const quotes = await photoQuotesFor(me, visible.map((m) => m.photoId).filter(str));
    if (w.state === "member" && chat.seq > 0) await markRead(me, groupId, chat.seq);
    // 外された人には今のメンバーを返さない（見える範囲の通の送り手だけ）
    const who = [...new Set([...(w.state === "member" ? r.members.map((m) => m.id) : []), ...visible.map((m) => m.from)])];
    const names = await peerInfos(who);
    return ok({
        state: w.state,
        canSend: w.state === "member",
        // 外された人には、外されたあとに進んだ番号も見せない
        seq: w.state === "member" ? chat.seq : Math.min(chat.seq, w.to),
        messages: visible.map((m) => shapeMessage(m, me, quotes as Map<string, unknown>)),
        members: who.map((id) => ({ id, name: nameIn(names, id) })),
    });
}

async function markRead(me: string, groupId: string, seq: number) {
    await updateJoined(me, (j) => (!j.list.includes(groupId) || (j.reads[groupId] ?? -1) >= seq ? null : { ...j, reads: { ...j.reads, [groupId]: seq } }))
        .catch((e) => console.error(`groups: 読んだ位置を置けませんでした（${groupId}）:`, errName(e)));
}

/** POST /groups/{groupId}/messages — 送る。本文 `{ text?, photoId?, id? }`（`id` は送り直しで二重にしない鍵） */
async function send(me: string, groupId: string, body: Record<string, unknown>) {
    const text = cleanMultilineText(body.text, GROUP_TEXT_MAX);
    const photoId = body.photoId === undefined || body.photoId === null ? undefined : isPhotoId(body.photoId) ? body.photoId : null;
    if (photoId === null) return jsonError(400, "不正なリクエスト", "badRequest");
    if (!text && !photoId) return jsonError(400, "メッセージを入力してください", "empty");
    let msgId = isMessageId(body.id) ? body.id : undefined;
    const r = await readMembers(groupId);
    if (!r || !memberOf(r, me)) return notFound();
    // 送り直し: **自分の**同じ id の通がもう入っていれば、数を進めずに同じ通を返す。
    // 他の人の通と id がぶつかったら、その id は使わない（他人の通を自分の送り直しとして返さない）
    if (msgId) {
        const prior = (await readGroupChat(groupId)).items.find((m) => m.id === msgId);
        if (prior && prior.from === me) return ok({ message: shapeMessage(prior, me, new Map()) });
        if (prior) msgId = undefined;
    }
    // 写真は**送る人に今見せてよい写真だけ**（DM と同じ門）
    if (photoId && !await readVisiblePhoto(photoId, me)) return jsonError(404, "写真が見つかりません", "photoNotFound");
    // メンバーかを見てから数える（外の人に数を進めさせない）
    if (!await reserveGroupDaily(me, "groupSent", GROUP_DAILY_SENT)) {
        return jsonError(429, "今日はこれ以上送れません。明日またお試しください", "dailyLimit");
    }
    const { seq, messages, duplicate, items } = await appendGroupChat(groupId, [draftText(me, text || undefined, photoId, msgId)]);
    const msg = messages[0];
    // 同じ id が同時に2回来て、どちらも数を進めていた: 書かなかった方の数を戻す
    if (duplicate) await releaseGroupDaily(me, "groupSent");
    await markRead(me, groupId, seq);
    if (!duplicate) await notifyMessage(me, groupId, r, seq, msg, items);
    const quotes = msg.photoId ? await photoQuotesFor(me, [msg.photoId]) : new Map();
    return ok({ message: shapeMessage(msg, me, quotes as Map<string, unknown>) });
}

/**
 * 1通の知らせ。宛先は「メンバー − 自分 − 知らせを止めた人 − 送った人とブロックの間柄の人 − 3分以内に自分で送った人」。
 * 同じグループで3分以内に鳴らしていたら送らない（受信箱の点と太字には入る）
 */
async function notifyMessage(me: string, groupId: string, r: MembersRow, seq: number, msg: GroupMessage, items: readonly GroupMessage[]) {
    try {
        const [{ notify, summary }, hidden] = await Promise.all([
            bumpSummary(groupId, seq, lastOfGroupMessage(msg), true), hiddenUserIds(me),
        ]);
        if (!notify || !summary) return;
        const since = Date.now() - GROUP_NOTIFY_QUIET_MS;
        // 自分が3分以内に送った人（今その会話を見ているはず）。この通そのものは数えない
        const recent = new Set(items.filter((m) => !m.event && m.id !== msg.id && Date.parse(m.t) >= since).map((m) => m.from));
        const to = r.members.filter((m) => m.id !== me && !m.muted && !hidden.has(m.id) && !recent.has(m.id)).map((m) => m.id);
        if (to.length === 0) return;
        const names = await peerInfos([me, ...summary.faceIds]);
        await pushTo(to, groupId, { title: pushTitle(summary, me, names), body: `${nameIn(names, me)} からメッセージが届きました` });
    } catch (e) {
        console.error(`groups: 知らせの準備に失敗（${groupId}）:`, errName(e));
    }
}

/** POST /groups/{groupId}/members — 人を足す（メンバーなら誰でも）。本文 `{ userIds: string[] }` */
async function addMembers(me: string, groupId: string, body: Record<string, unknown>) {
    // メンバーかを先に見る（メンバーでない人には、本文の形の誤りよりも先に「無い」と答える）
    const r = await readMembers(groupId);
    if (!r || !memberOf(r, me)) return notFound();
    const targets = targetIds(body.userIds, me);
    if (!targets || targets.length === 0) return jsonError(400, "足す人を選んでください", "badRequest");
    const fresh = targets.filter((t) => !memberOf(r, t) && !liveInvites(r).some((i) => i.id === t));
    if (seatsUsed(r) >= GROUP_MEMBERS_MAX) return jsonError(403, `グループは${GROUP_MEMBERS_MAX}人までです`, "full");
    const gate = await gateTargets(me, r, fresh);
    // 空き席は、門を通った人の数で見る（通らない人のせいで、通る人まで断らない）
    if (seatsUsed(r) + gate.direct.length + gate.invite.length > GROUP_MEMBERS_MAX) {
        return jsonError(403, `グループは${GROUP_MEMBERS_MAX}人までです`, "full");
    }
    if (gate.invite.length > 0 && !await reserveGroupDaily(me, "newConv", GROUP_DAILY_INVITES, gate.invite.length)) {
        gate.notAdded += gate.invite.length;
        gate.invite = [];
        if (gate.direct.length === 0) return jsonError(429, "今日はこれ以上招待できません。明日またお試しください", "dailyLimit");
    }
    const added = await admit(groupId, me, gate);
    // 枠で入れなかった人の招待の数は戻す
    await releaseGroupDaily(me, "newConv", gate.invite.length - added.invite.length);
    if (added.full && added.direct.length + added.invite.length === 0) {
        return jsonError(403, `グループは${GROUP_MEMBERS_MAX}人までです`, "full");
    }
    const after = await readMembers(groupId);
    if (!after) return notFound();
    await refreshSummary(groupId, after);
    if (added.direct.length > 0) await afterAdded(groupId, me, added.direct, "added");
    const s = await readSummary(groupId);
    if (!s) return notFound();
    const notAdded = gate.notAdded + (gate.direct.length + gate.invite.length - added.direct.length - added.invite.length);
    return ok({ ...(await detailBody(me, after, s)), added: added.direct, invitedNow: added.invite, notAdded });
}

/** PUT /groups/{groupId} — 名前（メンバーなら誰でも・`name` が空なら名前を外す）と、自分の知らせ（`muted`） */
async function update(me: string, groupId: string, body: Record<string, unknown>) {
    const r = await readMembers(groupId);
    if (!r || !memberOf(r, me)) return notFound();
    const wantsName = "name" in body;
    const wantsMute = "muted" in body;
    if (!wantsName && !wantsMute) return jsonError(400, "不正なリクエスト", "badRequest");
    if (wantsMute && typeof body.muted !== "boolean") return jsonError(400, "不正なリクエスト", "badRequest");
    if (wantsName && body.name !== null && typeof body.name !== "string") return jsonError(400, "不正なリクエスト", "badRequest");
    if (wantsName) {
        const name = typeof body.name === "string" ? sanitizeText(body.name, GROUP_NAME_MAX) : undefined;
        // 🔴 名前を変えると全員の会話に1行が出る（送るのと同じ重さ）。**送る 1日 300 通（`groupSent`）に1通として数える**。
        // 新しい欄を作らない（承認された欄は2つだけ）・別の回数を覚えさせない。同じ名前なら数えない
        const before = await readSummary(groupId);
        if (before && (before.name ?? "") !== (name ?? "")
            && !await reserveGroupDaily(me, "groupSent", GROUP_DAILY_SENT)) {
            return jsonError(429, "今日はこれ以上変えられません。明日またお試しください", "dailyLimit");
        }
        const reserved = !!before && (before.name ?? "") !== (name ?? "");
        let changed = false;
        await updateSummary(groupId, (s) => {
            changed = (s.name ?? "") !== (name ?? "");
            if (!changed) return null;
            const { name: _old, ...rest } = s;
            void _old;
            return { ...rest, ...(name ? { name } : {}) };
        });
        if (reserved && !changed) await releaseGroupDaily(me, "groupSent");
        if (changed) {
            const ev: GroupEvent = { type: "renamed", ...(name ? { name } : {}) };
            await postEvent(groupId, draftEvent(me, ev));
        }
    }
    if (wantsMute) {
        await updateMembers(groupId, (cur) => {
            if (!cur || !memberOf(cur, me)) return null;
            return { ...cur, members: cur.members.map((m) => (m.id !== me ? m : body.muted ? { ...m, muted: true as const } : { id: m.id, at: m.at, by: m.by, from: m.from })) };
        });
    }
    const [after, s] = await Promise.all([readMembers(groupId), readSummary(groupId)]);
    return after && s && memberOf(after, me) ? ok(await detailBody(me, after, s)) : notFound();
}

/** POST /groups/{groupId}/join — 招待に参加する */
async function join(me: string, groupId: string) {
    const r = await readMembers(groupId);
    if (!r) return notFound();
    if (memberOf(r, me)) return ok({ groupId, joined: true, already: true });
    if (!liveInvites(r).some((i) => i.id === me)) return notFound();
    // 招待のあとにブロックの間柄になった人が居れば入れない（理由は言わない・招待は外す）
    const hidden = await hiddenUserIds(me);
    if (r.members.some((m) => hidden.has(m.id))) {
        await dropInvite(groupId, me, false);
        return notFound();
    }
    // 先に自分の一覧に席を取る（50 の枠を**書くときに**確かめる。同時に2つへ参加しても 50 を越えない）
    let over = false;
    let reserved = false;
    await updateJoined(me, (j) => {
        over = false; reserved = false;
        if (j.list.includes(groupId)) return null;
        if (j.list.length >= GROUPS_JOINED_MAX) { over = true; return null; }
        reserved = true;
        return { ...j, list: [groupId, ...j.list] };
    });
    if (over) return jsonError(403, `入れるグループは${GROUPS_JOINED_MAX}個までです。使わないグループから抜けてください`, "joinedFull");
    let moved = false;
    await updateMembers(groupId, (cur) => {
        moved = false;
        if (!cur || memberOf(cur, me) || !liveInvites(cur).some((i) => i.id === me)) return null;
        moved = true;
        const now = new Date().toISOString();
        const inv = cur.invited.find((i) => i.id === me)!;
        return {
            ...cur, invited: cur.invited.filter((i) => i.id !== me),
            // 見え始める位置は、入れたあとに決める（`settleFrom`）。外された印はここで外す（戻ってきた）
            members: [...cur.members, { id: me, at: now, by: inv.by, from: PENDING_FROM }],
            removed: cur.removed.filter((x) => x.id !== me),
        };
    });
    if (!moved) {
        if (reserved) await updateJoined(me, (j) => (j.list.includes(groupId) ? { ...j, list: j.list.filter((g) => g !== groupId) } : null));
        const again = await readMembers(groupId);
        return again && memberOf(again, me) ? ok({ groupId, joined: true, already: true }) : notFound();
    }
    const from = await settleFrom(groupId, [me]);
    await updateJoined(me, (j) => ({
        ...j, list: [groupId, ...j.list.filter((g) => g !== groupId)], reads: { ...j.reads, [groupId]: from },
        invites: j.invites.filter((i) => i.g !== groupId), left: j.left.filter((g) => g !== groupId), ...dropRemoved(j, groupId),
    }));
    const seq = await postEvent(groupId, draftEvent(me, { type: "joined" }));
    await markRead(me, groupId, seq);
    const after = await readMembers(groupId);
    if (after) await refreshSummary(groupId, after);
    return ok({ groupId, joined: true });
}

/** 招待を外す。`declined` なら断った印を残す（同じグループから招待し直せない） */
async function dropInvite(groupId: string, uid: string, declined: boolean) {
    await updateMembers(groupId, (cur) => {
        if (!cur) return null;
        const had = cur.invited.some((i) => i.id === uid);
        if (!had && !(declined && !cur.declined.includes(uid))) return null;
        return {
            ...cur, invited: cur.invited.filter((i) => i.id !== uid),
            declined: declined ? [...cur.declined.filter((x) => x !== uid), uid].slice(-GROUP_DECLINED_MAX) : cur.declined,
        };
    });
    await updateJoined(uid, (j) => {
        if (!j.invites.some((i) => i.g === groupId) && !declined) return null;
        return { ...j, invites: j.invites.filter((i) => i.g !== groupId), ...(declined ? { left: remember(j.left, groupId) } : {}) };
    });
}

/** POST /groups/{groupId}/decline — 招待を断る */
async function decline(me: string, groupId: string) {
    const r = await readMembers(groupId);
    if (!r || !r.invited.some((i) => i.id === me)) return notFound();
    await dropInvite(groupId, me, true);
    return ok({ ok: true });
}

/**
 * 抜ける（`purge` は退会の掃除: 会話に「抜けました」を出さず、控えも残さない）。
 * 作った人が抜けたら、いちばん前から居る人が作った人になる。最後の1人ならグループを消す
 */
async function leave(groupId: string, uid: string, opts: { purge?: boolean } = {}): Promise<"ok" | "deleted" | "notmember"> {
    let result = "notmember" as "ok" | "deleted" | "notmember";
    let invitedLeft: string[] = [];
    await updateMembers(groupId, (cur) => {
        result = "notmember";
        if (!cur || !memberOf(cur, uid)) return null;
        const rest = cur.members.filter((m) => m.id !== uid);
        if (rest.length === 0) {
            result = "deleted";
            invitedLeft = cur.invited.map((i) => i.id);
            return null;
        }
        result = "ok";
        return { ...cur, members: rest, ownerId: cur.ownerId === uid ? rest[0].id : cur.ownerId };
    });
    if (result === "deleted") await deleteGroupRows(groupId, invitedLeft);
    await updateJoined(uid, (j) => {
        const listed = j.list.includes(groupId) || groupId in j.reads;
        if (!listed && (opts.purge || j.left.includes(groupId))) return null;
        return {
            ...j, list: j.list.filter((g) => g !== groupId), reads: withoutRead(j.reads, groupId),
            ...(opts.purge ? {} : { left: remember(j.left, groupId) }),
        };
    });
    if (result === "ok") {
        if (!opts.purge) await postEvent(groupId, draftEvent(uid, { type: "left" }));
        const after = await readMembers(groupId);
        if (after) await refreshSummary(groupId, after);
    }
    return result;
}

/** グループの行を消す（最後の1人が抜けた）。招待中の人の棚からも外す */
async function deleteGroupRows(groupId: string, invited: readonly string[]) {
    for (const key of [groupKey(groupId), groupMembersKey(groupId), groupChatKey(groupId)]) {
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: key } }));
    }
    for (const uid of invited) {
        await updateJoined(uid, (j) => (j.invites.some((i) => i.g === groupId) ? { ...j, invites: j.invites.filter((i) => i.g !== groupId) } : null))
            .catch((e) => console.error(`groups: 招待を外せませんでした（${groupId}）:`, errName(e)));
    }
}

/**
 * DELETE /groups/{groupId}/members/{uid} — 自分なら抜ける（招待中なら断る・外されたグループなら受信箱から消す）。
 * 他の人なら**作った人だけ**: メンバーを外す・招待を取り消す
 */
async function removeMember(me: string, groupId: string, target: string | undefined) {
    if (!target || !isUserId(target)) return jsonError(400, "相手の指定が不正です", "badRequest");
    const who = target.toLowerCase();
    const r = await readMembers(groupId);
    if (who === me) {
        if (r && memberOf(r, me)) {
            await leave(groupId, me);
            return ok({ ok: true });
        }
        if (r && r.invited.some((i) => i.id === me)) {
            await dropInvite(groupId, me, true);
            return ok({ ok: true });
        }
        const j = await readJoined(me);
        if (!j.removed.includes(groupId)) return notFound();
        await updateJoined(me, (x) => ({ ...x, ...dropRemoved(x, groupId), reads: withoutRead(x.reads, groupId), left: remember(x.left, groupId) }));
        return ok({ ok: true });
    }
    if (!r || !memberOf(r, me)) return notFound();
    if (r.ownerId !== me) return jsonError(403, "人を外せるのはグループを作った人だけです", "notOwner");
    if (r.invited.some((i) => i.id === who)) {
        await dropInvite(groupId, who, false);
        return ok({ ok: true });
    }
    if (!memberOf(r, who)) return ok({ ok: true });
    const to = await currentSeq(groupId);
    let done = false;
    await updateMembers(groupId, (cur) => {
        done = false;
        const m = cur ? memberOf(cur, who) : undefined;
        if (!cur || !m || cur.ownerId !== me) return null;
        done = true;
        return {
            ...cur, members: cur.members.filter((x) => x.id !== who),
            removed: [...cur.removed.filter((x) => x.id !== who), { id: who, from: m.from, to }].slice(-GROUP_REMOVED_MAX),
        };
    });
    if (!done) return ok({ ok: true });
    const named = (await readSummary(groupId))?.name;
    const info: RemovedInfo = { t: new Date().toISOString(), ...(named ? { name: named } : {}) };
    await updateJoined(who, (j) => {
        const removed = [groupId, ...j.removed.filter((g) => g !== groupId)].slice(0, GROUPS_REMOVED_KEEP);
        const removedInfo = Object.fromEntries(Object.entries({ ...j.removedInfo, [groupId]: info }).filter(([g]) => removed.includes(g)));
        return {
            ...j, list: j.list.filter((g) => g !== groupId), reads: withoutRead(j.reads, groupId),
            removed, removedInfo, left: remember(j.left, groupId),
        };
    });
    await postEvent(groupId, draftEvent(me, { type: "removed", targets: [who] }));
    const after = await readMembers(groupId);
    if (after) await refreshSummary(groupId, after);
    return ok({ ok: true });
}

/**
 * POST /groups/{groupId}/report — 通報。本文 `{ reason, messageId?, note? }`。
 * 自分に見えている直近 20 通（誰の通か・グループの名前つき）を写して残す。押し直しでも前の写しは残す（100 通まで）。
 * メンバーと、外された人（外されるまでの話）だけ。相手には知らせない
 */
async function report(me: string, groupId: string, body: Record<string, unknown>) {
    if (!isReportReason(body.reason)) return jsonError(400, "理由を選んでください", "badRequest");
    if (body.messageId !== undefined && !isMessageId(body.messageId)) return jsonError(400, "不正なリクエスト", "badRequest");
    const r = await readMembers(groupId);
    const w = r ? windowOf(r, me) : null;
    if (!r || !w) return notFound();
    const [chat, hidden, s] = await Promise.all([readGroupChat(groupId), hiddenUserIds(me), readSummary(groupId)]);
    const inWindow = chat.items.filter((m) => m.n > w.from && m.n <= w.to);
    type Copy = { id: string; from: string; t: string; text?: string; photoId?: string };
    const copy = (m: GroupMessage): Copy => ({ id: m.id, from: m.from, t: m.t, ...(m.text ? { text: m.text } : {}), ...(m.photoId ? { photoId: m.photoId } : {}) });
    let target: GroupMessage | undefined;
    if (typeof body.messageId === "string") {
        target = inWindow.find((m) => m.id === body.messageId);
        if (!target) return jsonError(404, "メッセージが見つかりません", "messageNotFound");
        if (target.from === me) return jsonError(400, "自分のメッセージは通報できません", "badRequest");
        if (target.event) return jsonError(400, "このメッセージは通報できません", "badRequest");
    }
    const recent = inWindow.filter((m) => !m.event && !hidden.has(m.from)).slice(-GROUP_REPORT_LAST);
    const fresh = target && !recent.some((m) => m.id === target!.id) ? [target, ...recent] : recent;
    const key = groupReportKey(groupId, me);
    const prev = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: key }, ConsistentRead: true }));
    const kept = Array.isArray(prev.Item?.messages) ? (prev.Item!.messages as Array<Partial<Copy>>)
        .filter((m): m is Copy => str(m?.id) && str(m?.from) && str(m?.t)) : [];
    const byId = new Map<string, Copy>(kept.map((m) => [m.id, m]));
    for (const m of fresh) byId.set(m.id, copy(m));
    let messages = [...byId.values()].sort((a, b) => a.t.localeCompare(b.t)).slice(-GROUP_REPORT_KEEP_MAX);
    if (target && !messages.some((m) => m.id === target!.id)) messages = [copy(target), ...messages.slice(1)];
    const note = sanitizeText(body.note, REPORT_NOTE_MAX);
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: {
            id: key, groupId, reporterId: me, reason: body.reason,
            ...(target ? { messageId: target.id, reportedId: target.from } : {}),
            ...(s?.name ? { groupName: s.name } : {}),
            memberIds: r.members.map((m) => m.id),
            ...(note ? { note } : {}),
            messages,
            createdAt: new Date().toISOString(),
        },
    }));
    return ok({ success: true });
}

/**
 * 認証の口（1つの関数・道は `routeKey`）。書く道はすべて入口で退会を確かめる（`assertLiveCaller`）
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const sub = getUserId(event);
    if (!sub) return jsonError(401, "認証が必要です");
    const me = sub.toLowerCase();
    const route = event.routeKey;
    const groupId = event.pathParameters?.groupId ?? "";
    try {
        if (route === "GET /groups") return await inbox(me);
        if (route !== "POST /groups" && !isGroupId(groupId)) return notFound();
        if (route === "GET /groups/{groupId}") return await detail(me, groupId);
        if (route === "GET /groups/{groupId}/messages") return await readMessages(me, groupId);
        // ここから下は書く道
        const gone = await assertLiveCaller(me);
        if (gone) return gone;
        const body = parseJson(event.body);
        if (!body) return jsonError(400, "不正なリクエスト", "badRequest");
        if (route === "POST /groups") return await create(me, body);
        if (route === "PUT /groups/{groupId}") return await update(me, groupId, body);
        if (route === "POST /groups/{groupId}/messages") return await send(me, groupId, body);
        if (route === "POST /groups/{groupId}/members") return await addMembers(me, groupId, body);
        if (route === "DELETE /groups/{groupId}/members/{uid}") return await removeMember(me, groupId, event.pathParameters?.uid);
        if (route === "POST /groups/{groupId}/join") return await join(me, groupId);
        if (route === "POST /groups/{groupId}/decline") return await decline(me, groupId);
        if (route === "POST /groups/{groupId}/report") return await report(me, groupId, body);
        return jsonError(404, "見つかりません");
    } catch (e) {
        if (e instanceof UserListError) return jsonError(503, "混み合っています。もう一度お試しください");
        console.error(`groups ${route} error:`, errName(e));
        return jsonError(500, "うまくいきませんでした。もう一度お試しください");
    }
};

/**
 * 退会（`account.ts` から）。入っていたグループから抜け（作った人なら次の人へ渡す・誰も残らなければ消す）、
 * 招待を外し、会話から本人の通を外し、外された・断った印からも外す。一覧の行（`groupsjoined#<uid>`）は
 * `account.ts` が名指しで消す。**1つのグループの失敗で止めない**
 */
export async function purgeGroupsFor(uid: string): Promise<void> {
    const j = await readJoined(uid);
    const all = new Set([...j.list, ...j.invites.map((i) => i.g), ...j.removed, ...j.left]);
    for (const groupId of all) {
        try {
            if (j.list.includes(groupId)) await leave(groupId, uid, { purge: true });
            await updateMembers(groupId, (cur) => {
                if (!cur) return null;
                const touched = cur.invited.some((i) => i.id === uid) || cur.declined.includes(uid) || cur.removed.some((x) => x.id === uid);
                if (!touched) return null;
                return {
                    ...cur, invited: cur.invited.filter((i) => i.id !== uid),
                    declined: cur.declined.filter((x) => x !== uid), removed: cur.removed.filter((x) => x.id !== uid),
                };
            });
            const kept = await stripGroupChatFrom(groupId, uid);
            // 🔴 受信箱の行（`group#`）の最後の1通が本人のものなら、残った会話の最後の1通で作り直す
            // （退会した人の抜粋と id を、みんなの受信箱に残さない）
            await updateSummary(groupId, (s) => {
                if (s.last?.from !== uid) return null;
                const { last: _gone, ...rest } = s;
                void _gone;
                return kept?.last ? { ...rest, last: kept.last } : rest;
            });
        } catch (e) {
            console.error(`purgeGroupsFor: グループの掃除に失敗（${groupId}）:`, errName(e));
        }
    }
}
