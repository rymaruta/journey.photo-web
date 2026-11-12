import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { assertLiveCaller } from "./liveCaller";
import { hiddenUserIds, blocksId, ids as idsOf } from "./blockCheck";
import { isFollowing } from "./followCheck";
import { deletedAmong } from "./notify";
import { isCloseFriendOf, peerInfos, reserveGroupDaily, mergeReportCopies, DM_REPORT_LAST, type ReportCopy, type PeerInfo } from "./dm";
import { cleanMultilineText } from "./textClean";
import { sanitizeText } from "./sanitize";
import { isReportReason, REPORT_NOTE_MAX } from "./report";
import { readVisiblePhoto, isPhotoId } from "./photoVisibility";
import { photoQuotesFor } from "./dmPhotoQuote";
import { deviceTokensOf, forgetTokens } from "./devices";
import { apnsConfigured, sendPush } from "./apns";
import { UserListError } from "./userList";
import {
    GROUP_ADD_MAX, GROUP_DECLINED_MAX, GROUP_KICKED_MAX, GROUP_MEMBERS_MAX, GROUP_NAME_MAX, GROUP_PREVIEW_IDS,
    GROUP_PUSH_GAP_MS, GROUP_TEXT_MAX, GROUP_UNSENT_KEEP, GROUPS_JOINED_MAX, GROUP_INVITES_MAX,
    appendChat, appendEvent, autoName, countState, deleteGroupRows, dropEntry, groupChatKey, groupKey, groupMembersKey,
    groupReportKey, isGroupId, isLiveInviteEntry, lastOf, lastSentAt, liveInvites, readChat, readHead, readHeads, readJoined,
    readMembers, seatsUsed, unreadOf, userIdsFrom, visibleFor, withInviteEntry, withMemberEntry, withQuota, withRemovedEntry,
    writeHead, writeJoined, writeMembers, chatItemsOf, withTrace,
    type GroupHead, type GroupMembers, type GroupMessage, type GroupsJoined, type JoinedEntry,
} from "./groupChat";
import { updateUserRow } from "./userList";

/**
 * **グループの会話（みんなで話す DM・最大30人）の口**（2026-11-12・札 journey.photo-ios#582・資料「みんなで話す DM」）。
 * owner 承認（2026-11-12）: 同じ表に行の種類を5つ・`dmday#` に欄を2つ・別のスタック（`serverless.groups.yml`）。
 * **新しい GSI・表・TTL・SQS は作らない。** 行の形は `groupChat.ts`。今の1対1の DM（`dm.ts`）は変えない。
 *
 * 土台は旅行プランの会話（`tripShare.ts`・`tripChat.ts`）。1つの関数で、道は `event.routeKey` で分ける:
 *
 *     GET    /groups                          受信箱に並べるグループ（入っている・招待・外された）
 *     POST   /groups                          作る（`userIds` 2〜29人・`name` は無くてよい・`id` で押し直しを1つに）
 *     GET    /groups/{gid}                    グループの中身（名前・メンバー・招待中の人・知らせを止めたか）
 *     PUT    /groups/{gid}                    名前を変える（`name`・誰でも）／知らせを止める（`muted`・自分の分）
 *     GET    /groups/{gid}/messages?since=    会話を読む（読んだ位置も進める・変化なしは `unchanged`）
 *     POST   /groups/{gid}/messages           送る（`text`・`photoId`・`id`）。本文が `{ unsend }` なら自分の1通を取り消す
 *     POST   /groups/{gid}/members            人を足す（`userIds`・メンバーなら誰でも）
 *     DELETE /groups/{gid}/members/{uid}      抜ける（自分）・外す（作った人だけ）・外された会話を受信箱から消す（自分）
 *     POST   /groups/{gid}/join               招待に参加する
 *     DELETE /groups/{gid}/invite             招待を断る
 *     POST   /groups/{gid}/report             通報（自分に見えている直近20通を、誰の通かも付けて写す）
 *
 * ## 規則
 *
 *   - **入っていない人には、グループの有無も教えない**（404）。招待されている人に見えるのは名前・招いた人・メンバーの名前だけ
 *     （参加するまでメッセージは1通も見えない）。**入る前の話は見えない**（入った時刻より後だけ）
 *   - **入れられるのは、入れる人がフォローしている人だけ**。入れられた人が入れた人をフォローしている（か親しい友達）なら
 *     そのまま入り、知らせが1通届く。そうでなければ「招待」としてリクエストの棚に入り、知らせは出さない（今の DM と同じ門）
 *   - **ブロックの間柄の人は入れられない**（入れる人とも、メンバー・招待中の誰かとも）。理由は言わない。入った後にブロックしたら、
 *     その人の通を見る人の画面から隠す（消さない）。参加の時も、メンバーの誰かとブロックの間柄なら参加させない
 *   - 30人まで（招待中の人も数える）。1回に足せるのは29人。断った人には、そのグループからは誰も招待し直せない
 *   - 外すのは作った人だけ。外された人は外されるまでの話を読めるが送れない。作った人がもう一度入れるまで戻れない
 *   - 作った人が抜けたら、いちばん前から入っている人が作った人を受け継ぐ。最後の1人が抜けたらグループを消す
 *   - **既読の人数・「いま見ています」・入力中の印は作らない**（owner の決まり）
 *   - 知らせは**本文を載せない**。同じグループで知らせを送ってから3分の間は鳴らさない。自分が送ってから3分の間は自分に
 *     知らせない。相手全員の端末をまとめて読み（`deviceTokensOf`）、`sendPush` を1回だけ呼んで APNs への接続1本で送る
 *   - 写真は今の DM と同じ: 送れるのは送る人に見せてよい写真だけ。札は**読む人ごとに**見せてよいかを決め直す（`dmPhotoQuote.ts`）。
 *     画像そのものは渡さない（持ち主の写真の頁へ連れて行くだけ・「他人の写真は、その人のもの」）
 */

const ok = (body: unknown, status = 200) => ({
    statusCode: status,
    // 本人向けの答え。共有キャッシュに載せない
    headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
    body: JSON.stringify(body),
});
const notFound = () => jsonError(404, "グループが見つかりません", "notFound");
const errName = (e: unknown) => (e as { name?: string })?.name ?? "Error";
const isCcf = (e: unknown) => errName(e) === "ConditionalCheckFailedException";
const isMessageId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
const DEFAULT_NAME = "名前未設定さん";

function parseJson(body: string | null | undefined): Record<string, unknown> | null {
    try {
        const v = JSON.parse(body ?? "{}") as unknown;
        return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 誰として見るか
// ---------------------------------------------------------------------------

type Access =
    | { role: "member"; m: GroupMembers; box: GroupsJoined; win: { since: string } }
    | { role: "removed"; m: GroupMembers; box: GroupsJoined; win: { since?: string; until?: string } }
    | { role: "invited"; m: GroupMembers; box: GroupsJoined; by: string };

/** メンバーの行（正）とその人の行から、その人の立場を決める。**どれでもなければ null**（グループの有無を教えない） */
async function accessOf(me: string, gid: string): Promise<Access | null> {
    const [m, box] = await Promise.all([readMembers(gid), readJoined(me)]);
    if (!m) return null;
    const mine = m.members.find((x) => x.id === me);
    if (mine) return { role: "member", m, box, win: { since: mine.joinedAt } };
    const e = box.groups[gid];
    // 外された会話として読めるのは、**この行（今のグループ）で外された人だけ**（2026-11-12 確かめ役の指摘2）。
    // 消えたグループと同じ gid で作り直された行では、前のグループの「外された」の印を使わせない:
    // 外した控え（`kicked`）に名があり、外された会話の始まりがこの行を作った時刻より後であること
    if (e?.state === "removed" && m.kicked.includes(me) && (!m.createdAt || (e.since ?? e.at) >= m.createdAt)) {
        return { role: "removed", m, box, win: { since: e.since, until: e.until } };
    }
    const inv = liveInvites(m).find((i) => i.id === me);
    if (inv && isLiveInviteEntry(e)) return { role: "invited", m, box, by: inv.by };
    return null;
}

/** どれかの行が在るか（作る前の確かめ。鍵だけを読む） */
async function rowsExist(keys: readonly string[]): Promise<boolean> {
    const res = await Promise.all(keys.map((id) => ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE, Key: { id }, ProjectionExpression: "#i", ExpressionAttributeNames: { "#i": "id" }, ConsistentRead: true,
    }))));
    return res.some((r) => !!r.Item);
}

/** その人がブロックした人（「ブロック中」の印は自分がブロックした人だけに付ける。ブロックされたことは教えない） */
async function blockedByMe(me: string): Promise<Set<string>> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(me) } }));
    return new Set(idsOf(res.Item as Record<string, unknown> | undefined, "blockedIds"));
}

/**
 * 知らせの文の「グループ『京都』」。**名前の無いグループは「グループ」とだけ言う**（2026-11-12 判断: 名前の無いグループの
 * 呼び名はメンバーの名前の並びで、受け取る人ごとに違う——自分の名前が入る。知らせは全員に同じ文を接続1本で送るので、
 * 名前を付けたときだけ名前を出す）
 */
const groupWord = (name: string | undefined) => (name ? `グループ『${name}』` : "グループ");

/** 名前の写しを1つに（呼び名・知らせの題） */
function titleFor(head: Pick<GroupHead, "name">, memberIds: readonly string[], names: ReadonlyMap<string, PeerInfo>, exclude: string): string {
    return head.name || autoName(memberIds, names, exclude);
}

// ---------------------------------------------------------------------------
// 知らせ（接続1本・本文なし）
// ---------------------------------------------------------------------------

/**
 * 何人かへ同じ知らせを送る。**相手全員の端末を1回でまとめて読み、`sendPush` を1回だけ呼ぶ**（APNs への接続1本・資料 8b章）。
 * 届かない宛先（410 など）は持ち主ごとに外す。**送れなくても本体の操作は成功のまま**（ログだけ）。バッジは変えない
 * （旅行プランの会話と同じ。アプリのアイコンの数字にグループの未読を足すのは後回し・資料 10章）
 */
async function pushTo(uids: readonly string[], alert: { title: string; body: string }, gid: string): Promise<void> {
    if (!apnsConfigured() || uids.length === 0) return;
    try {
        const byUid = await deviceTokensOf(uids);
        const owner = new Map<string, string>();
        for (const [uid, tokens] of byUid) for (const t of tokens) if (!owner.has(t)) owner.set(t, uid);
        if (owner.size === 0) return;
        const result = await sendPush([...owner.keys()], { ...alert, data: { type: "groupchat", groupId: gid }, threadId: `group-${gid}` });
        const dead = new Map<string, string[]>();
        for (const t of result.invalid) {
            const uid = owner.get(t);
            if (uid) dead.set(uid, [...(dead.get(uid) ?? []), t]);
        }
        for (const [uid, tokens] of dead) await forgetTokens(uid, tokens);
    } catch (e) {
        console.error(`groups.pushTo: 送れませんでした（${gid}）:`, errName(e));
    }
}

// ---------------------------------------------------------------------------
// 人を入れる（作る・足す）
// ---------------------------------------------------------------------------

type Plan = { direct: string[]; request: string[]; skipped: number };

/**
 * 入れる人を「そのまま入る」「招待（リクエスト）」「入れない」に分ける。**書かない**（読むだけ）。
 *  - 入れる人がフォローしていない・退会した（読めない）・ブロックの間柄（入れる人とも、今いる人・この回で先に入れた人とも）・
 *    このグループの招待を断った・作った人に外された（作った人が入れるときは除く）人は入れない。**理由は言わない**（数だけ返す）
 *  - そのまま入る人は、50グループの枠が空いていること。招待は、受け取る棚（20）が空いていること
 */
async function planAdds(me: string, targets: readonly string[], present: readonly string[], g: { declined?: readonly string[]; kicked?: readonly string[]; isOwner: boolean }): Promise<Plan> {
    const plan: Plan = { direct: [], request: [], skipped: 0 };
    const fresh = targets.filter((t) => t !== me && !present.includes(t));
    if (fresh.length === 0) return plan;
    const [gone, myHidden] = await Promise.all([deletedAmong(fresh), hiddenUserIds(me)]);
    const facts = await Promise.all(fresh.map(async (t) => {
        const [follows, hidden, box] = await Promise.all([isFollowing(t, me), hiddenUserIds(t), readJoined(t)]);
        const direct = follows ? (await isFollowing(me, t)) || await isCloseFriendOf(t, me) : false;
        return { t, follows, hidden, box, direct };
    }));
    const inGroup = new Set(present);
    for (const f of facts) {
        const refused = gone.deleted.has(f.t) || gone.unread.has(f.t) || myHidden.has(f.t) || !f.follows
            || (g.declined ?? []).includes(f.t) || ((g.kicked ?? []).includes(f.t) && !g.isOwner)
            || [...inGroup].some((x) => f.hidden.has(x))
            || (f.direct ? countState(f.box, "member") >= GROUPS_JOINED_MAX : countState(f.box, "invited") >= GROUP_INVITES_MAX);
        if (refused) { plan.skipped++; continue; }
        (f.direct ? plan.direct : plan.request).push(f.t);
        inGroup.add(f.t);
    }
    return plan;
}

/**
 * 決めた人をメンバーの行とその人の行に書く。**その人の行の枠が先に埋まった（同時の招待）なら、メンバーの行から戻す**。
 * 実際に入った人（そのまま・招待）を返す
 */
async function applyAdds(me: string, gid: string, plan: Plan, now: string, seq: number): Promise<{ direct: string[]; request: string[]; skipped: number }> {
    const done = { direct: [] as string[], request: [] as string[], skipped: plan.skipped };
    let accepted: Plan = { direct: [], request: [], skipped: 0 };
    // 作った人が入れ直して `kicked` から外した人（戻すときに `kicked` へ返す・E2）
    let wasKicked: string[] = [];
    await writeMembers(gid, (m) => {
        accepted = { direct: [], request: [], skipped: 0 };
        wasKicked = [];
        if (!m || !m.members.some((x) => x.id === me)) return null;
        let free = GROUP_MEMBERS_MAX - seatsUsed(m);
        const taken = new Set([...m.members.map((x) => x.id), ...liveInvites(m).map((x) => x.id)]);
        for (const t of plan.direct) if (!taken.has(t) && !m.declined.includes(t) && free > 0) { accepted.direct.push(t); free--; }
        for (const t of plan.request) if (!taken.has(t) && !m.declined.includes(t) && free > 0) { accepted.request.push(t); free--; }
        if (accepted.direct.length + accepted.request.length === 0) return null;
        const readmitted = new Set([...accepted.direct, ...accepted.request]);
        wasKicked = m.kicked.filter((x) => readmitted.has(x));
        return {
            ...m,
            members: [...m.members, ...accepted.direct.map((id) => ({ id, joinedAt: now, addedBy: me }))],
            // 30日を過ぎた招待はここで外す（枠を空ける）
            invited: [...liveInvites(m).filter((i) => !readmitted.has(i.id)), ...accepted.request.map((id) => ({ id, by: me, at: now }))],
            kicked: m.kicked.filter((x) => !readmitted.has(x)),
        };
    });
    done.skipped += plan.direct.length + plan.request.length - accepted.direct.length - accepted.request.length;
    const undo: string[] = [];
    // その人の行が書けなかった（枠が埋まった・ぶつかり続けた・落ちた）人は、メンバーの行から戻す（2026-11-12 確かめ役の指摘5:
    // 落ちたときに戻しが無く、受信箱に出ないグループのメンバー・招待中の人が残っていた）
    const writeEntry = async (t: string, entry: (j: GroupsJoined) => { next: GroupsJoined | null; result: "ok" | "already" | "full" }) => {
        let r = "ok" as "ok" | "already" | "full";
        try {
            await writeJoined(t, (j) => { const w = entry(j); r = w.result; return w.next; });
        } catch (e) {
            console.error(`groups.applyAdds: その人の行を書けませんでした（${gid}）:`, errName(e));
            return false;
        }
        return r !== "full";
    };
    for (const t of accepted.direct) {
        if (await writeEntry(t, (j) => withMemberEntry(j, gid, now, seq))) done.direct.push(t); else undo.push(t);
    }
    for (const t of accepted.request) {
        if (await writeEntry(t, (j) => withInviteEntry(j, gid, me, now))) done.request.push(t); else undo.push(t);
    }
    // 招待を送ったグループを自分の行に覚える（退会したら、送った招待を取り消すため・指摘7）
    if (done.request.length > 0) {
        await writeJoined(me, (j) => withTrace(j, gid))
            .catch((e) => console.error(`groups.applyAdds: 控えを書けませんでした（${gid}）:`, errName(e)));
    }
    if (undo.length > 0) {
        // 同時に枠が埋まった人を戻す（受信箱に無いグループのメンバーにしない）
        // **入れ直しの途中で落ちた人は、外した控え（`kicked`）にも戻す**（E2: 戻さないと、外された人が招待なしの別の道で戻れた）
        const back = wasKicked.filter((x) => undo.includes(x));
        await writeMembers(gid, (m) => m ? {
            ...m, members: m.members.filter((x) => !undo.includes(x.id)), invited: m.invited.filter((x) => !undo.includes(x.id)),
            kicked: [...m.kicked.filter((x) => !back.includes(x)), ...back].slice(-GROUP_KICKED_MAX),
        } : null);
        done.skipped += undo.length;
    }
    return done;
}

/** メンバーの行から、小さい行（人数・顔・作った人）を合わせる */
async function syncHead(gid: string, m: GroupMembers): Promise<void> {
    await writeHead(gid, (h) => {
        if (!h) return null;
        const previewIds = m.members.slice(0, GROUP_PREVIEW_IDS).map((x) => x.id);
        if (h.ownerId === m.ownerId && h.count === m.members.length && previewIds.join() === h.previewIds.join()) return null;
        return { ...h, ownerId: m.ownerId, count: m.members.length, previewIds };
    });
}

// ---------------------------------------------------------------------------
// 口
// ---------------------------------------------------------------------------

/** POST /groups — 作る */
async function create(me: string, body: Record<string, unknown>) {
    const targets = userIdsFrom(body.userIds)?.filter((x) => x !== me);
    if (!targets || targets.length < 2 || targets.length > GROUP_ADD_MAX) {
        return jsonError(400, `2人から${GROUP_ADD_MAX}人まで選んでください`, "badRequest");
    }
    const name = "name" in body && body.name !== null && body.name !== "" ? sanitizeText(body.name, GROUP_NAME_MAX) : undefined;
    if ("name" in body && body.name !== null && body.name !== "" && !name) return jsonError(400, "名前が不正です", "badRequest");
    // 押し直しで2つ作らない（画面が決めた id を使う。無ければここで決める）
    const gid = isGroupId(body.id) ? body.id : randomUUID();
    // **使われた gid は受け付けない**（2026-11-12 確かめ役の指摘2）。自分が入っている行なら押し直しとして中身を返す。
    // ほかの人の行・片付けの残り（小さい行・会話の行だけが残った）は 409——前のグループの行に重ねて作らない
    const [existing, leftover] = await Promise.all([readMembers(gid), rowsExist([groupKey(gid), groupChatKey(gid)])]);
    if (existing?.members.some((x) => x.id === me)) return await detail(me, gid);
    if (existing || leftover) return jsonError(409, "この ID では作れません。もう一度お試しください", "idTaken");

    const myBox = await readJoined(me);
    if (countState(myBox, "member") >= GROUPS_JOINED_MAX) {
        return jsonError(403, `入れるグループは${GROUPS_JOINED_MAX}個までです。使わないものから抜けてください`, "selfFull");
    }
    const plan = await planAdds(me, targets, [me], { isOwner: true });
    if (plan.direct.length + plan.request.length === 0) return jsonError(409, "いまはこの人たちとグループを作れません", "unavailable");
    // 1日の歯止め（人を足した数 → 作った数）。足した数が通らなければ何も書かない
    let quotaOk = false as boolean;
    await writeJoined(me, (j) => { const n = withQuota(j, plan.direct.length, plan.request.length); quotaOk = !!n; return n; });
    if (!quotaOk) return jsonError(429, "今日はこれ以上人を足せません。明日またお試しください", "dailyLimit");
    if (!await reserveGroupDaily(me, "groupNew")) return jsonError(429, "今日はこれ以上グループを作れません。明日またお試しください", "dailyLimit");

    const now = new Date().toISOString();
    // メンバーの行（正）→ 小さい行 → 会話 → 自分の行 → 入れる人の行、の順に書く
    try {
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: {
                id: groupMembersKey(gid), uid: gid, rev: 1, updatedAt: now, gid, ownerId: me, createdAt: now,
                members: [{ id: me, joinedAt: now }], invited: [], declined: [], kicked: [],
            },
            ConditionExpression: "attribute_not_exists(id)",
        }));
    } catch (e) {
        if (!isCcf(e)) throw e;
        return (await readMembers(gid))?.members.some((x) => x.id === me) ? await detail(me, gid) : jsonError(409, "この ID では作れません。もう一度お試しください", "idTaken");
    }
    // 自分の行を先に書く。**枠（50）が同時に埋まった・書けなかったら、作ったメンバーの行を消して断る**（指摘5）
    let selfOk = false as boolean;
    try {
        await writeJoined(me, (j) => { const w = withMemberEntry(j, gid, now, 0, Date.parse(now)); selfOk = w.result !== "full"; return w.next; });
    } catch (e) {
        await deleteGroupRows(gid, []).catch(() => undefined);
        throw e;
    }
    if (!selfOk) {
        await deleteGroupRows(gid, []);
        return jsonError(403, `入れるグループは${GROUPS_JOINED_MAX}個までです。使わないものから抜けてください`, "selfFull");
    }
    const head: GroupHead = { gid, ...(name ? { name } : {}), ownerId: me, count: 1, previewIds: [me], seq: 0, createdAt: now };
    await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: { ...head, id: groupKey(gid), uid: gid, rev: 1, updatedAt: now } }));
    await appendEvent(gid, me, { type: "created" }, new Date(now));
    const done = await applyAdds(me, gid, plan, now, 0);
    const m = await readMembers(gid);
    if (m) await syncHead(gid, m);
    if (done.direct.length > 0) {
        const names = await peerInfos([me]);
        await pushTo(done.direct, { title: "グループ", body: `${names.get(me)?.name ?? DEFAULT_NAME}が${groupWord(name)}を作りました。` }, gid);
    }
    return detail(me, gid, { skipped: done.skipped });
}

/** POST /groups/{gid}/members — 人を足す（メンバーなら誰でも・足した人の名前が残る） */
async function addMembers(me: string, gid: string, body: Record<string, unknown>) {
    const targets = userIdsFrom(body.userIds)?.filter((x) => x !== me);
    if (!targets || targets.length === 0 || targets.length > GROUP_ADD_MAX) return jsonError(400, "人の指定が不正です", "badRequest");
    const a = await accessOf(me, gid);
    if (!a || a.role !== "member") return notFound();
    const present = [...a.m.members.map((x) => x.id), ...liveInvites(a.m).map((x) => x.id)];
    // 30人目は押せない（画面と同じ決まりを、書く前に断る）
    if (present.length + targets.filter((t) => !present.includes(t)).length > GROUP_MEMBERS_MAX) {
        return jsonError(403, `グループは${GROUP_MEMBERS_MAX}人までです`, "groupFull");
    }
    const plan = await planAdds(me, targets, present, { declined: a.m.declined, kicked: a.m.kicked, isOwner: a.m.ownerId === me });
    if (plan.direct.length + plan.request.length === 0) return ok({ added: [], invited: [], skipped: plan.skipped });
    let quotaOk = false as boolean;
    await writeJoined(me, (j) => { const n = withQuota(j, plan.direct.length, plan.request.length); quotaOk = !!n; return n; });
    if (!quotaOk) return jsonError(429, "今日はこれ以上人を足せません。明日またお試しください", "dailyLimit");
    const head = await readHead(gid, true);
    const now = new Date().toISOString();
    const done = await applyAdds(me, gid, plan, now, head?.seq ?? 0);
    if (done.direct.length > 0) await appendEvent(gid, me, { type: "added", ids: done.direct }, new Date(now));
    const m = await readMembers(gid);
    if (m) await syncHead(gid, m);
    if (done.direct.length > 0 && head) {
        const names = await peerInfos([me]);
        await pushTo(done.direct, {
            title: "グループ",
            body: `${names.get(me)?.name ?? DEFAULT_NAME}があなたを${groupWord(head.name)}に入れました。`,
        }, gid);
    }
    return ok({ added: done.direct, invited: done.request, skipped: done.skipped });
}

/** GET /groups/{gid} — 中身（招待されている人には名前・招いた人・メンバーの名前だけ） */
async function detail(me: string, gid: string, extra: Record<string, unknown> = {}) {
    const a = await accessOf(me, gid);
    if (!a) return notFound();
    // 小さい行が無い（作る途中で落ちた）ときはメンバーの行から組む（押し直しで 404 にしない）
    const head: GroupHead = (await readHead(gid, true))
        ?? { gid, ownerId: a.m.ownerId, count: a.m.members.length, previewIds: a.m.members.slice(0, GROUP_PREVIEW_IDS).map((x) => x.id), seq: 0, createdAt: "" };
    // **外された人には今のメンバーを見せない**（2026-11-12 確かめ役の指摘1: 外されたあとに入った人・自分をブロックした人の
    // 名前・ユーザー名・人数まで見えていた）。名前の無いグループは「グループ」とだけ言う
    const removed = a.role === "removed";
    const shownName = removed ? a.box.groups[gid]?.name : head.name;
    const memberIds = removed ? [] : a.m.members.map((x) => x.id);
    const invited = a.role === "member" ? liveInvites(a.m) : [];
    const [names, mine] = await Promise.all([
        peerInfos([...memberIds, ...invited.map((i) => i.id), ...(a.role === "invited" ? [a.by] : [])]),
        a.role === "member" ? blockedByMe(me) : Promise.resolve(new Set<string>()),
    ]);
    const person = (id: string) => {
        const p = names.get(id) ?? { name: DEFAULT_NAME };
        return { id, name: p.name, ...(p.username ? { username: p.username } : {}), ...(p.deleted ? { deleted: true } : {}) };
    };
    const me_ = a.m.members.find((x) => x.id === me);
    return ok({
        group: {
            id: gid,
            // 外された人には、外された時点の名前だけ（今の名前・外したあとの改名は見せない・E1）
            ...(shownName ? { name: shownName } : {}),
            title: removed ? shownName || "グループ" : titleFor(head, memberIds, names, me),
            ...(removed ? {} : { ownerId: a.m.ownerId, isOwner: a.m.ownerId === me, count: memberIds.length }),
            max: GROUP_MEMBERS_MAX,
            state: a.role,
            canSend: a.role === "member",
            ...(me_?.muted ? { muted: true } : {}),
        },
        members: (removed ? [] : a.m.members).map((x) => ({
            ...person(x.id),
            ...(x.id === a.m.ownerId ? { owner: true } : {}),
            // 自分にだけ「ブロック中」（自分がブロックした人だけ）
            ...(mine.has(x.id) ? { blocked: true } : {}),
            ...(a.role === "member" && x.addedBy ? { addedBy: x.addedBy } : {}),
        })),
        ...(a.role === "member" ? { invited: invited.map((i) => ({ ...person(i.id), by: i.by })) } : {}),
        ...(a.role === "invited" ? { invitedBy: person(a.by) } : {}),
        ...extra,
    });
}

/** PUT /groups/{gid} — 名前（誰でも・会話に1行）／知らせを止める（自分の分） */
async function update(me: string, gid: string, body: Record<string, unknown>) {
    const a = await accessOf(me, gid);
    if (!a || a.role !== "member") return notFound();
    if (!("name" in body) && !("muted" in body)) return jsonError(400, "変える項目がありません", "badRequest");
    if ("muted" in body) {
        if (typeof body.muted !== "boolean") return jsonError(400, "不正なリクエスト", "badRequest");
        const muted = body.muted;
        await writeMembers(gid, (m) => {
            if (!m || !m.members.some((x) => x.id === me)) return null;
            return { ...m, members: m.members.map((x) => (x.id !== me ? x : muted ? { ...x, muted: true as const } : { id: x.id, joinedAt: x.joinedAt, ...(x.addedBy ? { addedBy: x.addedBy } : {}) })) };
        });
        await writeJoined(me, (j) => {
            const e = j.groups[gid];
            if (!e) return null;
            const { muted: _m, ...rest } = e;
            void _m;
            return { ...j, groups: { ...j.groups, [gid]: muted ? { ...rest, muted: true } : rest } };
        });
    }
    if ("name" in body) {
        // 空・null は「名前を外す」（メンバーの名前を並べる形に戻す）
        const raw = body.name;
        const name = raw === null || raw === "" ? "" : sanitizeText(raw, GROUP_NAME_MAX);
        if (name === undefined) return jsonError(400, "名前が不正です", "badRequest");
        let changed = false as boolean;
        await writeHead(gid, (h) => {
            changed = false;
            if (!h || (h.name ?? "") === name) return null;
            changed = true;
            const { name: _n, ...rest } = h;
            void _n;
            return name ? { ...rest, name } : rest;
        });
        if (changed) await appendEvent(gid, me, { type: "renamed", name });
    }
    return detail(me, gid);
}

/** 1通を画面に出す形（写真の札は読む人の目で決め直す） */
function shapeMessage(m: GroupMessage, me: string, hidden: ReadonlySet<string>, photos: ReadonlyMap<string, unknown>) {
    const event = m.event?.type === "added" ? { ...m.event, ids: m.event.ids.filter((x) => !hidden.has(x)) } : m.event;
    return {
        id: m.id, from: m.from, mine: m.from === me, t: m.t,
        ...(typeof m.n === "number" ? { n: m.n } : {}),
        ...(m.text ? { text: m.text } : {}),
        ...(m.photoId ? { photoId: m.photoId, ...(photos.get(m.photoId) ? { photo: photos.get(m.photoId) } : {}) } : {}),
        ...(event ? { event } : {}),
    };
}

/** GET /groups/{gid}/messages — 会話（メンバーと、外された人は外されるまで）。読んだ位置を進める */
async function readMessages(me: string, gid: string, sinceRaw: string | undefined) {
    const a = await accessOf(me, gid);
    if (!a || a.role === "invited") return notFound();
    const [chat, hidden] = await Promise.all([readChat(gid), hiddenUserIds(me)]);
    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : "";
    // 変化なしは軽い空応答（定期の読み直しで本文を送り直さない・DM と同じ）
    if (since && chat.updatedAt && chat.updatedAt <= since) return ok({ unchanged: true, messages: [], t: chat.updatedAt });
    const visible = visibleFor(chat.items, a.win, hidden).filter((m) => !(m.event?.type === "added" && m.event.ids.every((x) => hidden.has(x))));
    const photos = await photoQuotesFor(me, visible.flatMap((m) => (m.photoId ? [m.photoId] : [])));
    // 外された人には、見えている通の送り主だけ（今のメンバーを見せない・指摘1）
    const people = new Set<string>([...(a.role === "member" ? a.m.members.map((x) => x.id) : []), ...visible.map((m) => m.from)]);
    if (a.role === "member") for (const m of visible) {
        if (m.event?.type === "added") m.event.ids.forEach((x) => people.add(x));
        if (m.event?.type === "removed") people.add(m.event.target);
    }
    const names = await peerInfos([...people]);
    const readUpTo = a.role === "member" ? chat.seq : Math.max(0, ...visible.map((m) => m.n ?? 0));
    if (readUpTo > (a.box.groups[gid]?.read ?? 0)) {
        await writeJoined(me, (j) => {
            const e = j.groups[gid];
            if (!e || e.state === "invited" || (e.read ?? 0) >= readUpTo) return null;
            return { ...j, groups: { ...j.groups, [gid]: { ...e, read: readUpTo } } };
        }).catch((e) => console.error(`groups.readMessages: 読んだ位置を置けませんでした（${gid}）:`, errName(e)));
    }
    return ok({
        messages: visible.map((m) => shapeMessage(m, me, hidden, photos)),
        people: Object.fromEntries([...people].map((id) => {
            const p = names.get(id) ?? { name: DEFAULT_NAME };
            return [id, { name: p.name, ...(p.username ? { username: p.username } : {}), ...(p.deleted ? { deleted: true } : {}) }];
        })),
        canSend: a.role === "member",
        t: chat.updatedAt,
    });
}

/** POST /groups/{gid}/messages — 送る（メンバーだけ） */
async function send(me: string, gid: string, body: Record<string, unknown>) {
    const text = cleanMultilineText(body.text, GROUP_TEXT_MAX);
    const photoId = body.photoId === undefined || body.photoId === null ? undefined : isPhotoId(body.photoId) ? body.photoId : null;
    if (photoId === null) return jsonError(400, "不正なリクエスト", "badRequest");
    if (!text && !photoId) return jsonError(400, "メッセージを入力してください", "empty");
    const [m, hidden] = await Promise.all([readMembers(gid), hiddenUserIds(me)]);
    // **外された人・抜けた人・招待中の人・外の人は送れない**（グループの有無も言わない）
    if (!m || !m.members.some((x) => x.id === me)) return notFound();
    const msgId = isMessageId(body.id) ? body.id : randomUUID();
    // 写真は送る人に今見せてよい写真だけ（受け取る人に見せるかは、読むたびに決め直す）
    if (photoId && !await readVisiblePhoto(photoId, me)) return jsonError(404, "写真が見つかりません", "photoNotFound");
    if (!await reserveGroupDaily(me, "groupSent")) return jsonError(429, "今日はこれ以上送れません。明日またお試しください", "dailyLimit");

    const now = new Date();
    const appended = await appendChat(gid, { id: msgId, from: me, t: now.toISOString(), ...(text ? { text } : {}), ...(photoId ? { photoId } : {}) });
    const msg = appended.stored;
    if (appended.duplicate) return ok({ message: shapeMessage(msg, me, hidden, new Map()) });

    // 知らせる人: 自分・知らせを止めた人・送った人とブロックの間柄の人（送った人の側の2行で足りる）・
    // 自分が送ってから3分の間の人を除く
    const lastSent = lastSentAt(appended.items.filter((x) => x.id !== msg.id));
    const cut = new Date(now.getTime() - GROUP_PUSH_GAP_MS).toISOString();
    const recipients = m.members.filter((x) => x.id !== me && !x.muted && !hidden.has(x.id) && (lastSent.get(x.id) ?? "") <= cut).map((x) => x.id);
    // 小さい行: 最後の1通と通し番号（**新しい番号のときだけ**）。知らせる人が居て、前の知らせから3分たっていれば知らせる時刻を取る
    const got = { claimed: false, head: null as GroupHead | null };
    await writeHead(gid, (h) => {
        got.claimed = false;
        got.head = h;
        if (!h) return null;
        const newer = (msg.n ?? 0) > h.seq;
        const canNotify = recipients.length > 0 && (!h.notifiedAt || h.notifiedAt <= cut);
        if (!newer && !canNotify) return null;
        got.claimed = canNotify;
        return {
            ...h,
            ...(newer ? { seq: msg.n!, last: lastOf(msg) } : {}),
            ...(canNotify ? { notifiedAt: now.toISOString() } : {}),
        };
    });
    // 自分の通は読んだことにする（自分の送った通で未読を数えない）
    await writeJoined(me, (j) => {
        const e = j.groups[gid];
        if (!e || e.state !== "member" || (e.read ?? 0) >= appended.seq) return null;
        return { ...j, groups: { ...j.groups, [gid]: { ...e, read: appended.seq } } };
    }).catch(() => undefined);
    if (got.claimed && got.head) {
        const ids = m.members.map((x) => x.id);
        const names = await peerInfos(ids);
        await pushTo(recipients, {
            // 名前の無いグループは「グループ」（自動の名前は受け取る人ごとに違い、受け取る人の名前が入る・指摘3）
            title: got.head.name || "グループ",
            body: `${names.get(me)?.name ?? DEFAULT_NAME}からメッセージが届きました。`,
        }, gid);
    }
    const photos = photoId ? await photoQuotesFor(me, [photoId]) : new Map();
    return ok({ message: shapeMessage(msg, me, hidden, photos) });
}

/**
 * 本文 `{ unsend }` — 自分の1通を取り消す（DM と同じ: 期限なし・跡を残さない）。メンバーと、外された人（外されるまでの自分の通）。
 * 未読は小さい行の `unsentSeqs` で数え直す。最後の1通だったら抜粋を前の通に戻す。**通報の写しは消さない**
 */
async function unsend(me: string, gid: string, rawId: unknown) {
    if (!isMessageId(rawId)) return jsonError(400, "不正なリクエスト", "badRequest");
    const a = await accessOf(me, gid);
    if (!a || a.role === "invited") return notFound();
    let removed: GroupMessage | undefined;
    let remaining: GroupMessage[] = [];
    await updateUserRow(groupChatKey(gid), gid, (item) => {
        removed = undefined;
        const items = chatItemsOf(item);
        const target = items.find((x) => x.id === rawId);
        if (!item || !target || target.from !== me || target.event || (a.win.since && target.t < a.win.since)) return null;
        removed = target;
        remaining = items.filter((x) => x.id !== rawId);
        const { id: _i, uid: _u, rev: _r, updatedAt: _t, ...rest } = item;
        void _i; void _u; void _r; void _t;
        return { ...rest, items: remaining, unsentAt: new Date().toISOString() };
    });
    const gone = removed as GroupMessage | undefined;
    if (!gone) return jsonError(404, "メッセージが見つかりません", "messageNotFound");
    const prev = [...remaining].reverse().find((x) => !x.event);
    await writeHead(gid, (h) => {
        if (!h) return null;
        const unsentSeqs = typeof gone.n === "number" ? [...(h.unsentSeqs ?? []).filter((n) => n !== gone.n), gone.n].slice(-GROUP_UNSENT_KEEP) : h.unsentSeqs;
        const { last: _l, ...rest } = h;
        void _l;
        const last = h.last?.id === gone.id ? (prev ? lastOf(prev) : undefined) : h.last;
        return { ...rest, ...(last ? { last } : {}), ...(unsentSeqs ? { unsentSeqs } : {}) };
    });
    return ok({ ok: true });
}

/**
 * DELETE /groups/{gid}/members/{uid} — 抜ける（自分）・外す（作った人が、メンバーか招待中の人を）。
 * 外された人が自分を指すと、受信箱の「グループから外れました。」の行を消す
 */
async function removeMember(me: string, gid: string, target: string | undefined) {
    const t = typeof target === "string" ? target.toLowerCase() : "";
    if (!userIdsFrom([t])) return jsonError(400, "相手の指定が不正です", "badRequest");
    const a = await accessOf(me, gid);
    if (!a) {
        // 自分の受信箱に残った行（本体が消えた・期限の切れた招待）は消せる。ほかの人を指したら、グループの有無も言わない
        if (t !== me) return notFound();
        await writeJoined(me, (j) => dropEntry(j, gid));
        return ok({ ok: true });
    }
    // 招待中の人が自分を消す＝断る（2026-11-12 判断: 受信箱から消す操作を、断る口と同じ扱いにする）
    if (a.role === "invited") return t === me ? decline(me, gid) : notFound();
    if (a.role === "removed") {
        if (t !== me) return notFound();
        await writeJoined(me, (j) => dropEntry(j, gid));
        return ok({ ok: true });
    }
    if (t === me) return ok(await leave(me, gid));
    if (a.m.ownerId !== me) return jsonError(403, "メンバーを外せるのはグループを作った人だけです", "notOwner");
    const now = new Date().toISOString();
    // 外された時点の名前を本人の行に写す（外したあとの改名を見せない・E1）
    const nameAtKick = (await readHead(gid, true))?.name;
    let kind = null as "member" | "invited" | null;
    await writeMembers(gid, (m) => {
        kind = null;
        if (!m || m.ownerId !== me) return null;
        if (m.members.some((x) => x.id === t)) {
            kind = "member";
            return { ...m, members: m.members.filter((x) => x.id !== t), kicked: [...m.kicked.filter((x) => x !== t), t].slice(-GROUP_KICKED_MAX) };
        }
        if (m.invited.some((x) => x.id === t)) {
            kind = "invited";
            return { ...m, invited: m.invited.filter((x) => x.id !== t) };
        }
        return null;
    });
    if (kind === "member") {
        // 外された人の行に「外された会話」を置き、退会の掃除のために gid を覚える（指摘7）
        await writeJoined(t, (j) => { const r = withRemovedEntry(j, gid, now, nameAtKick) ?? j; return withTrace(r, gid) ?? (r === j ? null : r); });
        await appendEvent(gid, me, { type: "removed", target: t }, new Date(now));
    } else if (kind === "invited") {
        await writeJoined(t, (j) => (j.groups[gid]?.state === "invited" ? dropEntry(j, gid) : null));
    }
    const m = await readMembers(gid);
    if (m) await syncHead(gid, m);
    return ok({ ok: true });
}

/**
 * 抜ける。作った人が抜けたら、いちばん前から入っている人が受け継ぐ。**最後の1人ならグループを消す**（会話も）。
 * 会話に「〜が抜けました。」の1行。自分の受信箱から消える。`quiet` は退会の掃除（1行は置く・名前は「退会したユーザー」）
 */
async function leave(me: string, gid: string): Promise<{ ok: true }> {
    let last = false as boolean;
    let invited: string[] = [];
    let left = false as boolean;
    await writeMembers(gid, (m) => {
        last = false; left = false;
        if (!m || !m.members.some((x) => x.id === me)) return null;
        left = true;
        const rest = m.members.filter((x) => x.id !== me);
        if (rest.length === 0) { last = true; invited = m.invited.map((x) => x.id); return null; }
        return { ...m, members: rest, ownerId: m.ownerId === me ? rest[0].id : m.ownerId };
    });
    if (last) {
        await deleteGroupRows(gid, invited);
    } else if (left) {
        await appendEvent(gid, me, { type: "left" });
        const m = await readMembers(gid);
        if (m) await syncHead(gid, m);
    }
    await writeJoined(me, (j) => dropEntry(j, gid));
    return { ok: true };
}

/** POST /groups/{gid}/join — 招待に参加する。**メンバーの誰かとブロックの間柄なら参加させない**（理由は言わない） */
async function join(me: string, gid: string) {
    const a = await accessOf(me, gid);
    if (a?.role === "member") return ok({ ok: true, already: true });
    if (!a || a.role !== "invited") return notFound();
    const hidden = await hiddenUserIds(me);
    if (a.m.members.some((x) => hidden.has(x.id))) return notFound();
    if (countState(a.box, "member") >= GROUPS_JOINED_MAX) {
        return jsonError(403, `入れるグループは${GROUPS_JOINED_MAX}個までです。使わないものから抜けてください`, "selfFull");
    }
    const head = await readHead(gid, true);
    const now = new Date().toISOString();
    let moved = false as boolean;
    let by = a.by;
    await writeMembers(gid, (m) => {
        moved = false;
        const inv = m ? liveInvites(m).find((x) => x.id === me) : undefined;
        if (!m || !inv) return null;
        moved = true;
        by = inv.by;
        return { ...m, invited: m.invited.filter((x) => x.id !== me), members: [...m.members, { id: me, joinedAt: now, addedBy: inv.by }] };
    });
    if (!moved) return notFound();
    let r = "ok" as "ok" | "already" | "full";
    await writeJoined(me, (j) => {
        const { [gid]: _old, ...others } = j.groups;
        void _old;
        const w = withMemberEntry({ ...j, groups: others }, gid, now, head?.seq ?? 0);
        r = w.result;
        return w.next;
    });
    if (r === "full") {
        // 同時に枠が埋まった。メンバーから戻す（招待にも戻す）
        await writeMembers(gid, (m) => m ? { ...m, members: m.members.filter((x) => x.id !== me), invited: [...m.invited, { id: me, by, at: now }] } : null);
        return jsonError(403, `入れるグループは${GROUPS_JOINED_MAX}個までです。使わないものから抜けてください`, "selfFull");
    }
    await appendEvent(gid, me, { type: "joined" }, new Date(now));
    const m = await readMembers(gid);
    if (m) await syncHead(gid, m);
    return detail(me, gid);
}

/** DELETE /groups/{gid}/invite — 招待を断る。**断ったことは誰にも知らせない**。同じグループには誰も招待し直せない */
async function decline(me: string, gid: string, opts: { remember?: boolean } = { remember: true }) {
    await writeMembers(gid, (m) => {
        if (!m || !m.invited.some((x) => x.id === me)) return null;
        return {
            ...m,
            invited: m.invited.filter((x) => x.id !== me),
            declined: opts.remember ? [...m.declined.filter((x) => x !== me), me].slice(-GROUP_DECLINED_MAX) : m.declined,
        };
    });
    await writeJoined(me, (j) => {
        const d = (j.groups[gid]?.state === "invited" ? dropEntry(j, gid) : null) ?? j;
        // 断った記録は本人の行にも覚える（退会したら `declined` の控えから名を外すため・指摘7）
        const t = opts.remember ? withTrace(d, gid) ?? d : d;
        return t === j ? null : t;
    });
    return ok({ ok: true });
}

/** POST /groups/{gid}/report — 通報（自分に見えている直近20通・誰の通か・グループの名前を写す。押し直しで前の写しを残す） */
async function report(me: string, gid: string, body: Record<string, unknown>) {
    if (!isReportReason(body.reason)) return jsonError(400, "理由を選んでください");
    const a = await accessOf(me, gid);
    // ブロック中でも通報できる（ブロックした直後に通報するのがふつう）。招待中の人は中身を見ていない
    if (!a || a.role === "invited") return notFound();
    const [chat, head] = await Promise.all([readChat(gid), readHead(gid, true)]);
    // 自分が読める範囲の通（ブロックで隠した人の通も写しには入れる——2026-11-12 判断: ブロックした直後に通報するのが
    // ふつうで、隠した嫌がらせの通こそ運営が見る必要がある）。会話の中の1行は写さない
    const seen = visibleFor(chat.items, a.win, new Set()).filter((m) => !m.event);
    const messageId = isMessageId(body.messageId) && seen.some((m) => m.id === body.messageId) ? body.messageId : undefined;
    const fresh: ReportCopy[] = seen.slice(-DM_REPORT_LAST).map((m) => ({
        id: m.id, from: m.from, ...(m.text ? { text: m.text } : {}), t: m.t, ...(m.photoId ? { photoId: m.photoId } : {}),
    }));
    // 名指しの1通が直近20通より前なら、それも写す
    if (messageId && !fresh.some((m) => m.id === messageId)) {
        const one = seen.find((m) => m.id === messageId)!;
        fresh.unshift({ id: one.id, from: one.from, ...(one.text ? { text: one.text } : {}), t: one.t, ...(one.photoId ? { photoId: one.photoId } : {}) });
    }
    const prev = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: groupReportKey(gid, me) }, ConsistentRead: true }));
    const note = sanitizeText(body.note, REPORT_NOTE_MAX);
    const names = await peerInfos(a.m.members.map((x) => x.id));
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: {
            id: groupReportKey(gid, me),
            gid, reporterId: me,
            // グループの名前も写す（名前で嫌がらせをされる道があるため・資料 2章）
            groupName: head?.name ?? "",
            groupTitle: head ? titleFor(head, a.m.members.map((x) => x.id), names, me) : "",
            memberIds: a.m.members.map((x) => x.id),
            reason: body.reason,
            ...(note ? { note } : {}),
            ...(messageId ? { messageId, reportedId: seen.find((m) => m.id === messageId)!.from } : {}),
            messages: mergeReportCopies(prev.Item?.messages, fresh),
            createdAt: new Date().toISOString(),
        },
    }));
    return ok({ success: true });
}

/**
 * GET /groups — 受信箱に並べるグループ（最後の通の新しい順）。`groupsjoined#` を1回・小さい行をまとめて読むだけ
 * （メンバーの一覧と会話の行は読まない・資料 8章）。招待は `state: "invited"`（リクエストの棚）。
 * 外されたグループは「グループから外れました。」の行（`state: "removed"`）で、外される前の最後の通までを出す
 */
async function inbox(me: string) {
    const [box, hidden] = await Promise.all([readJoined(me), hiddenUserIds(me)]);
    const now = Date.now();
    const entries = Object.entries(box.groups).filter(([, e]) => e.state !== "invited" || isLiveInviteEntry(e, now));
    const heads = await readHeads(entries.map(([gid]) => gid));
    const want = new Set<string>();
    for (const [gid, e] of entries) {
        const h = heads.get(gid);
        if (!h) continue;
        if (e.state !== "removed") h.previewIds.forEach((x) => want.add(x));
        if (h.last) want.add(h.last.from);
        if (e.by) want.add(e.by);
    }
    const names = await peerInfos([...want]);
    const nameOf = (id: string) => names.get(id)?.name ?? DEFAULT_NAME;
    const items = entries.flatMap(([gid, e]: [string, JoinedEntry]) => {
        const h = heads.get(gid);
        if (!h) return [];
        // 消えたグループと同じ gid で作り直された行を、前のグループの「外された」の行に出さない（指摘2・`accessOf` と同じ考え）
        if (e.state === "removed" && h.createdAt && (e.since ?? e.at) < h.createdAt) return [];
        // 抜粋は見る人に見えている通だけ（ブロックの間柄の人・外された後の通は出さない）
        const last = h.last && !hidden.has(h.last.from) && e.state !== "invited" && (!e.until || h.last.t <= e.until) && (!e.since || h.last.t >= e.since) ? h.last : undefined;
        // 外された人には今のメンバー（顔・人数・自動の名前）を見せない（指摘1）
        const removed = e.state === "removed";
        // 外された人には、外された時点の名前だけ（E1）
        const groupName = removed ? e.name : h.name;
        const faces = removed ? [] : h.previewIds.filter((x) => x !== me && !hidden.has(x)).slice(0, 2);
        return [{
            id: gid,
            ...(groupName ? { name: groupName } : {}),
            title: groupName || (removed ? "グループ" : autoName(h.previewIds, names, me, h.count - (e.state === "member" ? 1 : 0))),
            ...(removed ? {} : { count: h.count }),
            faces: faces.map((x) => ({ id: x, name: nameOf(x) })),
            state: e.state,
            unread: e.state === "member" ? unreadOf(h, e.read ?? 0) : 0,
            ...(e.muted ? { muted: true } : {}),
            ...(e.state === "invited" && e.by ? { invitedBy: { id: e.by, name: nameOf(e.by) } } : {}),
            ...(last ? { last: { excerpt: last.excerpt, from: last.from, fromName: nameOf(last.from), mine: last.from === me, t: last.t, ...(last.photo ? { photo: true } : {}) } } : {}),
            updatedAt: last?.t ?? (e.state === "member" ? h.createdAt : e.at),
        }];
    }).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return ok({
        groups: items,
        unread: items.filter((x) => x.unread > 0 && !x.muted).length,
        requestCount: items.filter((x) => x.state === "invited").length,
    });
}

/**
 * 認証の口（1つの関数・道は `routeKey`）。書く道は入口で退会を確かめる（`assertLiveCaller`）。
 * 削除の道（DELETE）も確かめる——抜ける・断るは退会の掃除と同じ扱いだが、退会した本人のトークンで他人を外させない
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = (getUserId(event) || "").toLowerCase();
    if (!me) return jsonError(401, "認証が必要です");
    const route = event.routeKey;
    const gid = event.pathParameters?.gid ?? "";
    try {
        if (route === "GET /groups") return await inbox(me);
        if (route !== "POST /groups" && !isGroupId(gid)) return notFound();
        if (route === "GET /groups/{gid}") return await detail(me, gid);
        if (route === "GET /groups/{gid}/messages") return await readMessages(me, gid, event.queryStringParameters?.since);
        const gone = await assertLiveCaller(me);
        if (gone) return gone;
        if (route === "DELETE /groups/{gid}/members/{uid}") return await removeMember(me, gid, event.pathParameters?.uid);
        if (route === "DELETE /groups/{gid}/invite") return await decline(me, gid);
        const body = parseJson(event.body);
        if (!body) return jsonError(400, "不正なリクエスト");
        if (route === "POST /groups") return await create(me, body);
        if (route === "PUT /groups/{gid}") return await update(me, gid, body);
        if (route === "POST /groups/{gid}/messages") return body.unsend !== undefined ? await unsend(me, gid, body.unsend) : await send(me, gid, body);
        if (route === "POST /groups/{gid}/members") return await addMembers(me, gid, body);
        if (route === "POST /groups/{gid}/join") return await join(me, gid);
        if (route === "POST /groups/{gid}/report") return await report(me, gid, body);
        return jsonError(404, "見つかりません");
    } catch (e) {
        if (e instanceof UserListError) return jsonError(503, "混み合っています。もう一度お試しください");
        // 本文を含みうる値は出さない。名前だけ
        console.error(`groups ${route} error:`, errName(e));
        return jsonError(500, "うまくいきませんでした。もう一度お試しください");
    }
};

/**
 * 退会（`account.ts` から）。入っていたグループから抜け（作った人なら次の人へ渡す・誰も残らなければ消す）、
 * 招待は黙って外す（断った印は付けない）。**過去の通は残す**（相手が受け取った文面は相手の記録でもある・名前は
 * 「退会したユーザー」。今の DM と同じ・資料 9章）。**1つのグループの失敗で止めない**。
 * 本人の行（`groupsjoined#<uid>`）は `account.ts` が名指しで消す（`accountCleanupRows.test.ts` の見張り）
 */
export async function purgeGroupsFor(uid: string): Promise<void> {
    const box = await readJoined(uid);
    // 入っている・招待されている・外された（受信箱の行）と、断った・外された・招待を送った（`trace`）グループ
    for (const gid of new Set([...Object.keys(box.groups), ...(box.trace ?? [])])) {
        try {
            const e = box.groups[gid];
            if (e?.state === "member") await leave(uid, gid);
            else if (e?.state === "invited") await decline(uid, gid, { remember: false });
            // 断った・外した控えから本人の名を外し、本人が送った招待を取り消す（2026-11-12 確かめ役の指摘7）
            let revoked: string[] = [];
            await writeMembers(gid, (m) => {
                revoked = [];
                if (!m) return null;
                revoked = m.invited.filter((i) => i.by === uid && i.id !== uid).map((i) => i.id);
                const declined = m.declined.filter((x) => x !== uid);
                const kicked = m.kicked.filter((x) => x !== uid);
                if (revoked.length === 0 && declined.length === m.declined.length && kicked.length === m.kicked.length) return null;
                return { ...m, invited: m.invited.filter((i) => i.by !== uid), declined, kicked };
            });
            for (const t of revoked) {
                await writeJoined(t, (j) => (j.groups[gid]?.state === "invited" && j.groups[gid].by === uid ? dropEntry(j, gid) : null))
                    .catch((err) => console.error(`purgeGroupsFor: 招待を取り消せませんでした（${gid}）:`, errName(err)));
            }
        } catch (err) {
            console.error(`purgeGroupsFor: グループの掃除に失敗（${gid}）:`, errName(err));
        }
    }
}
