import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { BatchGetCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { assertLiveCaller } from "./liveCaller";
import { hiddenUserIds, isBlocked } from "./blockCheck";
import { isUserId } from "./userId";
import { UserListError, updateUserRow } from "./userList";
import { cleanDmText, convIdOf, dmConvKey, parseConvId, peerInfos } from "./dm";
import { deviceTokens, forgetTokens } from "./devices";
import { apnsConfigured, sendPush } from "./apns";
import {
    newInviteToken, isValidInviteToken, inviteKey, inviteExpiryFrom, inviteRejection, tripInviteState, type InviteItem,
} from "./invite";
import {
    readSharedTrip, sharedTripView, shareTrip, addTripMember, removeTripMember, isTripMember, memberIdsOf,
    readJoined, markTripRead, listSharedTrips, isPlanId, tripKey, TRIP_MEMBERS_MAX, TRIPS_JOINED_MAX,
    type SharedTrip,
} from "./tripPlans";
import {
    appendTripChat, readTripChat, stripTripChatFrom, textMessage, tripChatKey,
    type TripChatMessage, type TripChatLast,
} from "./tripChat";

/**
 * 旅行プランを仲間と使う口（2026-11-12・資料「SNS をもっと SNS に」2b と 2a の「[名前] と共有する」）。
 * owner 承認（2026-11-12「DB の変更してもいいけどね」）。**新しい GSI・表・TTL は作らない。**
 *
 * 行の形と今のプランの移し方は `tripPlans.ts` の「共有したプラン」の節、会話の行は `tripChat.ts`。
 *
 * ## 置き場（別のスタック・`serverless.trip-share.yml`）
 *
 * user API のスタックは部品が 488/500 で、口を足すと上限を越える（2026-11-12 撮影スポットを払う②で 503 を踏んだ）。
 * **口の URL は user API と同じ**（HTTP API を取り込み、経路だけ足す）。認証の口は `handler` の1つの関数で、
 * 道は `event.routeKey` で分ける（`trunk.ts` と同じ形・部品を増やさない）。
 * 未認証で読める招待の下見（`getTripInvite`）だけは別の関数で、読める行を権限で絞る。
 *
 * 日程を直す・プランを消す／抜けるは今の口（`PUT/DELETE /user/trips/{planId}`）がそのまま効く（`tripPlans.ts`）。
 *
 * ## 規則
 *
 *   - **仲間でない人には、プランの有無も教えない**（404。403 だと実在が分かる）
 *   - 共有する（`POST /trip-share/{planId}`）のは**持ち主だけ**。`withUserId` を付けると、その人を直接仲間に入れる
 *     ——**DM で会話が成り立っている相手だけ**（受信箱の会話が承認済み）。知らない人を勝手に入れさせない
 *   - **ブロックの間柄では仲間にしない**（直接・招待リンクの両方）。招待リンクでは、参加する人と仲間の誰かが
 *     ブロックの間柄なら参加させない（理由は言わず「見つかりません」）
 *   - 招待リンクは**プランに1本**。生きているリンクがあればそれを返す（仲間の誰が押しても同じリンク）。
 *     取り消せるのは持ち主だけ
 *   - 会話は仲間だけが読み書きする。ブロックの間柄の人の通は、見る人の画面から外す（消さない・DM と同じ）
 *   - 知らせ（プッシュ）は**文面で送る**（新しい鍵は古いアプリで鍵の字のまま出る・`lightForecast.ts` と同じ判断）。
 *     **本文は載せない**（DM と同じ）。バッジは変えない
 */

const ok = (body: unknown, status = 200) => ({
    statusCode: status,
    // 本人向けの答え。共有キャッシュに載せない
    headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
    body: JSON.stringify(body),
});
const notFound = () => jsonError(404, "プランが見つかりません", "notFound");
const errName = (e: unknown) => (e as { name?: string })?.name ?? "Error";

function parseJson(body: string | null | undefined): Record<string, unknown> | null {
    try {
        const v = JSON.parse(body ?? "{}") as unknown;
        return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** 仲間の名前（表示のたびに引く・名前は持たない）。退会した人は「退会したユーザー」 */
async function membersOf(row: SharedTrip) {
    const ids = memberIdsOf(row);
    const info = await peerInfos(ids);
    return ids.map((id) => ({ id, ...(info.get(id) ?? { name: "名前未設定さん" }), ...(id === row.ownerId ? { owner: true } : {}) }));
}

/** 詳細の答え（プラン・仲間・招待リンク） */
async function detailBody(row: SharedTrip, me: string) {
    const link = liveInvite(row);
    return {
        plan: sharedTripView(row),
        members: await membersOf(row),
        isOwner: row.ownerId === me,
        membersMax: TRIP_MEMBERS_MAX,
        ...(link ? { invite: link } : {}),
    };
}

/** プランが持つ生きている招待リンク（期限内）。無ければ undefined */
function liveInvite(row: SharedTrip): { token: string; expiresAt: string } | undefined {
    if (!row.inviteToken || !isValidInviteToken(row.inviteToken) || !row.inviteExpiresAt) return undefined;
    return Date.parse(row.inviteExpiresAt) > Date.now() ? { token: row.inviteToken, expiresAt: row.inviteExpiresAt } : undefined;
}

/** DM の会話が成り立っている（承認済みの受信箱の会話）か。直接仲間に入れる門 */
export async function canShareDirectly(me: string, other: string): Promise<boolean> {
    const parsed = parseConvId(convIdOf(me, other));
    if (!parsed) return false;
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: dmConvKey(parsed.lo, parsed.hi) }, ConsistentRead: true }));
    return res.Item?.state === "inbox";
}

/** 2人がブロックの間柄か（どちら向きでも） */
async function blockedEitherWay(a: string, b: string): Promise<boolean> {
    const [x, y] = await Promise.all([isBlocked(a, b), isBlocked(b, a)]);
    return x || y;
}

/**
 * 知らせを送る（文面・バッジは変えない）。**送れなくても本体の操作は成功のまま**（ログだけ）。
 * 受け取る人が送り主とブロックの間柄なら送らない
 */
async function notify(to: readonly string[], fromUid: string, alert: { title: string; body: string }, data: Record<string, string>) {
    if (!apnsConfigured()) return;
    for (const uid of to) {
        try {
            if (uid === fromUid) continue;
            if ((await hiddenUserIds(uid)).has(fromUid)) continue;
            const tokens = await deviceTokens(uid);
            if (tokens.length === 0) continue;
            const result = await sendPush(tokens, { ...alert, data });
            if (result.invalid.length > 0) await forgetTokens(uid, result.invalid);
        } catch (e) {
            console.error(`tripShare.notify: 送れませんでした（${uid}）:`, errName(e));
        }
    }
}

const nameOf = async (uid: string) => (await peerInfos([uid])).get(uid)?.name ?? "名前未設定さん";
const titleOf = (row: SharedTrip) => row.title || "旅行プラン";

// ---------------------------------------------------------------------------
// 口
// ---------------------------------------------------------------------------

/** POST /trip-share/{planId} — 共有する（持ち主）。`withUserId` でその人を直接仲間に */
async function share(me: string, planId: string, body: Record<string, unknown>) {
    const withUserId = body.withUserId;
    if (withUserId !== undefined) {
        if (typeof withUserId !== "string" || !isUserId(withUserId) || withUserId === me) return jsonError(400, "相手の指定が不正です");
        // 門を先に見る（落ちる相手のためにプランを動かさない）。**ブロックと分かる答えを返さない**
        if (await blockedEitherWay(me, withUserId) || !await canShareDirectly(me, withUserId)) {
            return jsonError(404, "この相手とは共有できません", "cannotShare");
        }
    }
    const shared = await shareTrip(me, planId);
    if (shared.kind === "notfound") return notFound();
    if (shared.kind === "limit") return jsonError(403, shared.reason);
    if (shared.row.ownerId !== me) return notFound();
    if (typeof withUserId === "string") {
        const r = await addTripMember(planId, withUserId);
        if (r === "full") return jsonError(403, `このプランは${TRIP_MEMBERS_MAX}人までです`);
        if (r === "joinedFull") return jsonError(403, "相手の旅行プランがいっぱいで共有できませんでした", "peerFull");
        if (r === "notfound") return notFound();
        if (r === "ok") {
            await notify([withUserId], me, {
                title: titleOf(shared.row),
                body: `${await nameOf(me)} が旅行プランを共有しました`,
            }, { type: "tripshare", planId });
        }
    }
    const row = await readSharedTrip(planId, true);
    return row ? ok(await detailBody(row, me)) : notFound();
}

/** GET /trip-share/{planId} — 詳細（仲間だけ） */
async function detail(me: string, planId: string) {
    const row = await readSharedTrip(planId);
    if (!row || !isTripMember(row, me)) return notFound();
    return ok(await detailBody(row, me));
}

/** POST /trip-share/{planId}/invite — 招待リンク（生きているリンクがあればそれを返す） */
async function invite(me: string, planId: string) {
    const row = await readSharedTrip(planId, true);
    if (!row || !isTripMember(row, me)) return notFound();
    const live = liveInvite(row);
    if (live) return ok(live);
    const token = newInviteToken();
    const now = Date.now();
    const expiresAt = inviteExpiryFrom(now);
    const item: InviteItem & { createdAt: string; createdBy: string } = {
        id: inviteKey(token), kind: "trip", planId, createdBy: me, createdAt: new Date(now).toISOString(), expiresAt,
    };
    await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: item, ConditionExpression: "attribute_not_exists(id)" }));
    // 本体に書き戻す（**書き戻せなかったら作った招待を取り消す**——辿れない生きたリンクを残さない・`albums.ts` と同じ）
    let written = false;
    try {
        await updateUserRow(tripKey(planId), planId, (cur) => {
            written = false;
            const r = cur as SharedTrip | undefined;
            if (!r || !memberIdsOf(r).includes(me)) return null;
            // 同時に2人が押して、もう1本が先に書いた: そちらを使う
            if (liveInvite(r)) return null;
            written = true;
            const { id: _i, uid: _u, rev: _r, updatedAt: _t, ...rest } = r as SharedTrip & { id?: string; uid?: string };
            void _i; void _u; void _r; void _t;
            return { ...rest, inviteToken: token, inviteExpiresAt: expiresAt };
        });
    } catch (e) {
        console.error(`tripShare.invite: 書き戻せませんでした（${planId}）:`, errName(e));
    }
    if (!written) {
        await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: { ...item, revoked: true } })).catch(() => undefined);
        const again = await readSharedTrip(planId, true);
        const other = again && isTripMember(again, me) ? liveInvite(again) : undefined;
        return other ? ok(other) : jsonError(500, "招待リンクを作れませんでした。もう一度お試しください");
    }
    return ok({ token, expiresAt });
}

/** DELETE /trip-share/{planId}/invite — 招待リンクを取り消す（持ち主だけ） */
async function revokeInvite(me: string, planId: string) {
    const row = await readSharedTrip(planId, true);
    if (!row || !isTripMember(row, me)) return notFound();
    if (row.ownerId !== me) return jsonError(403, "招待リンクを取り消せるのは作った人だけです");
    const token = row.inviteToken;
    await updateUserRow(tripKey(planId), planId, (cur) => {
        const r = cur as (SharedTrip & { id?: string; uid?: string }) | undefined;
        if (!r || !r.inviteToken) return null;
        const { id: _i, uid: _u, rev: _r, updatedAt: _t, inviteToken: _k, inviteExpiresAt: _e, ...rest } = r;
        void _i; void _u; void _r; void _t; void _k; void _e;
        return rest;
    });
    if (token && isValidInviteToken(token)) {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: inviteKey(token) } }));
        if (res.Item) await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: { ...res.Item, revoked: true } }));
    }
    return ok({ ok: true });
}

/** DELETE /trip-share/{planId}/members/{uid} — 抜ける（自分）・外す（持ち主が他の人を） */
async function removeMember(me: string, planId: string, target: string | undefined) {
    if (!target || !isUserId(target)) return jsonError(400, "相手の指定が不正です");
    const row = await readSharedTrip(planId, true);
    if (!row || !isTripMember(row, me)) return notFound();
    if (target !== me && row.ownerId !== me) return jsonError(403, "仲間を外せるのはプランを作った人だけです");
    if (!isTripMember(row, target)) return ok({ ok: true });
    await removeTripMember(planId, target);
    return ok({ ok: true });
}

/** 会話の1通を画面に出す形（名前は `members` から引く） */
const shapeMessage = (m: TripChatMessage, me: string) => ({
    id: m.id, from: m.from, mine: m.from === me, t: m.t,
    ...(typeof m.text === "string" ? { text: m.text } : {}),
    ...(m.event ? { event: m.event } : {}),
});

/** GET /trip-share/{planId}/chat — 会話（読んだ位置も進める） */
async function readChat(me: string, planId: string) {
    const row = await readSharedTrip(planId);
    if (!row || !isTripMember(row, me)) return notFound();
    const [chat, hidden] = await Promise.all([readTripChat(planId), hiddenUserIds(me)]);
    const items = chat.items.filter((m) => !hidden.has(m.from)).map((m) => shapeMessage(m, me));
    if (chat.seq > 0) {
        await markTripRead(me, planId, chat.seq)
            .catch((e) => console.error(`tripShare.readChat: 読んだ位置を置けませんでした（${planId}）:`, errName(e)));
    }
    return ok({ messages: items, members: await membersOf(row) });
}

/** POST /trip-share/{planId}/chat — 送る */
async function sendChat(me: string, planId: string, body: Record<string, unknown>) {
    const text = cleanDmText(body.text);
    if (!text) return jsonError(400, "メッセージを入力してください");
    const row = await readSharedTrip(planId, true);
    if (!row || !isTripMember(row, me)) return notFound();
    const msg = textMessage(me, text);
    const seq = await appendTripChat(planId, [msg]);
    // 自分の通は読んだことにする（自分の送った通で未読を数えない）
    await markTripRead(me, planId, seq).catch(() => undefined);
    await notify(memberIdsOf(row), me, {
        title: titleOf(row),
        body: `${await nameOf(me)} からメッセージが届きました`,
    }, { type: "tripchat", planId });
    return ok({ message: shapeMessage(msg, me) });
}

/**
 * GET /trip-share/inbox — 受信箱に並べるプランの会話（入っている共有プラン全部・最後の通の新しい順）。
 * 会話の行は**最後の通と通し番号だけ**を射影で読む（行ぜんぶを読まない）
 */
async function inbox(me: string) {
    const [plans, joined, hidden] = await Promise.all([listSharedTrips(me), readJoined(me), hiddenUserIds(me)]);
    const chats = new Map<string, { seq: number; last?: TripChatLast }>();
    if (plans.length > 0) {
        const res = await ddb.send(new BatchGetCommand({
            RequestItems: {
                [PHOTOS_TABLE]: {
                    Keys: plans.map((p) => ({ id: tripChatKey(p.planId) })),
                    ProjectionExpression: "#i, #p, #s, #l",
                    ExpressionAttributeNames: { "#i": "id", "#p": "planId", "#s": "seq", "#l": "last" },
                },
            },
        }));
        for (const c of (res.Responses?.[PHOTOS_TABLE] ?? []) as Record<string, unknown>[]) {
            if (typeof c.planId !== "string") continue;
            const last = c.last as TripChatLast | undefined;
            chats.set(c.planId, {
                seq: typeof c.seq === "number" ? c.seq : 0,
                ...(last && typeof last.from === "string" && typeof last.t === "string" ? { last } : {}),
            });
        }
    }
    const lastFroms = [...chats.values()].map((c) => c.last?.from).filter((v): v is string => !!v);
    const names = await peerInfos([...new Set([...lastFroms, ...plans.flatMap((p) => memberIdsOf(p))])]);
    const items = plans.map((p) => {
        const c = chats.get(p.planId);
        // ブロックの間柄の人の通は抜粋に出さない（会話を開いても外れている）
        const last = c?.last && !hidden.has(c.last.from) ? c.last : undefined;
        const read = joined.reads[p.planId] ?? 0;
        return {
            planId: p.planId,
            title: p.title,
            ...(p.startDate ? { startDate: p.startDate } : {}),
            ...(p.endDate ? { endDate: p.endDate } : {}),
            members: memberIdsOf(p).map((id) => ({ id, name: names.get(id)?.name ?? "名前未設定さん" })),
            unread: Math.max(0, (c?.seq ?? 0) - read),
            ...(last ? { last: { ...last, fromName: names.get(last.from)?.name ?? "名前未設定さん", mine: last.from === me } } : {}),
            updatedAt: last?.t ?? p.updatedAt,
        };
    }).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return ok({ trips: items });
}

/** POST /trip-invites/{token}/join — 招待リンクで参加する（ログインが要る・何度押しても同じ） */
async function join(me: string, token: string | undefined) {
    if (!isValidInviteToken(token)) {
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: inviteKey(token) }, ConsistentRead: true }));
    const inv = (res.Item as InviteItem | undefined) ?? null;
    const state = tripInviteState(inv, Date.now());
    if (state !== "ok") {
        const r = inviteRejection(state);
        return jsonError(r.statusCode, r.error);
    }
    const planId = inv!.planId!;
    const row = await readSharedTrip(planId, true);
    // 本体に書き戻した招待と違う（取り消して出し直した）なら、古いリンクとして断る
    if (!row || row.inviteToken !== token) {
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }
    if (isTripMember(row, me)) return ok({ planId, joined: true, already: true });
    // ブロックの間柄の人が仲間に居れば参加させない（理由は言わない）
    const hidden = await hiddenUserIds(me);
    if (memberIdsOf(row).some((m) => hidden.has(m))) {
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }
    const r = await addTripMember(planId, me);
    if (r === "full") return jsonError(403, `このプランは${TRIP_MEMBERS_MAX}人までです`);
    if (r === "joinedFull") return jsonError(403, `入れる旅行プランは${TRIPS_JOINED_MAX}個までです。使わないものから抜けてください`);
    if (r === "notfound") return notFound();
    if (r === "ok") {
        await notify(memberIdsOf(row), me, {
            title: titleOf(row),
            body: `${await nameOf(me)} が旅行プランに参加しました`,
        }, { type: "tripshare", planId });
    }
    return ok({ planId, joined: true, ...(r === "already" ? { already: true } : {}) });
}

/**
 * 認証の口（1つの関数・道は `routeKey`）。書く道はすべて入口で退会を確かめる（`assertLiveCaller`）
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    if (!me) return jsonError(401, "認証が必要です");
    const route = event.routeKey;
    const planId = event.pathParameters?.planId ?? "";
    try {
        if (route === "GET /trip-share/inbox") return await inbox(me);
        if (route === "POST /trip-invites/{token}/join") {
            const gone = await assertLiveCaller(me);
            if (gone) return gone;
            return await join(me, event.pathParameters?.token);
        }
        if (!isPlanId(planId)) return notFound();
        if (route === "GET /trip-share/{planId}") return await detail(me, planId);
        if (route === "GET /trip-share/{planId}/chat") return await readChat(me, planId);
        // ここから下は書く道
        const gone = await assertLiveCaller(me);
        if (gone) return gone;
        const body = parseJson(event.body);
        if (!body) return jsonError(400, "不正なリクエスト");
        if (route === "POST /trip-share/{planId}") return await share(me, planId, body);
        if (route === "POST /trip-share/{planId}/invite") return await invite(me, planId);
        if (route === "DELETE /trip-share/{planId}/invite") return await revokeInvite(me, planId);
        if (route === "DELETE /trip-share/{planId}/members/{uid}") return await removeMember(me, planId, event.pathParameters?.uid);
        if (route === "POST /trip-share/{planId}/chat") return await sendChat(me, planId, body);
        return jsonError(404, "見つかりません");
    } catch (e) {
        if (e instanceof UserListError) return jsonError(503, "混み合っています。もう一度お試しください");
        console.error(`tripShare ${route} error:`, errName(e));
        return jsonError(500, "うまくいきませんでした。もう一度お試しください");
    }
};

/**
 * GET /trip-invites/{token} — 招待の下見（**未認証で読める**）。
 *
 * 出すのは題・日付・人数・場所の数だけ（仲間の名前・日程の中身・会話は出さない）。
 * この関数の役は招待と本体の行を GetItem で読むだけ（`serverless.trip-share.yml` の `TripInviteReadRole`）。
 */
export const getTripInvite: APIGatewayProxyHandlerV2 = async (event) => {
    const token = event.pathParameters?.token;
    if (!isValidInviteToken(token)) {
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: inviteKey(token) } }));
        const inv = (res.Item as InviteItem | undefined) ?? null;
        const state = tripInviteState(inv, Date.now());
        if (state !== "ok") {
            const r = inviteRejection(state);
            return jsonError(r.statusCode, r.error);
        }
        const row = await readSharedTrip(inv!.planId!);
        if (!row || row.inviteToken !== token) {
            const r = inviteRejection("notfound");
            return jsonError(r.statusCode, r.error);
        }
        return {
            statusCode: 200,
            // **キャッシュさせない**（取り消しが効かなくなる）
            headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
            body: JSON.stringify({
                trip: {
                    title: row.title,
                    ...(row.startDate ? { startDate: row.startDate } : {}),
                    ...(row.endDate ? { endDate: row.endDate } : {}),
                    memberCount: memberIdsOf(row).length,
                    spotCount: row.days.reduce((n, d) => n + (Array.isArray(d.items) ? d.items.length : 0), 0),
                },
            }),
        };
    } catch (e) {
        console.error("getTripInvite error:", errName(e));
        return jsonError(500, "読み込めませんでした");
    }
};

/**
 * 退会（`account.ts` から）。入っていた共有プランから抜け（持ち主なら残った人へ渡す・誰も残らなければ消す）、
 * 会話から本人の通を外し、日程の「足した人」から本人を外し、一覧の行を消す。
 * **1つのプランの失敗で止めない**（ほかの行の掃除を続ける。ログは残す）
 */
export async function purgeTripSharesFor(uid: string): Promise<void> {
    const { list } = await readJoined(uid);
    for (const planId of list) {
        try {
            await stripTripChatFrom(planId, uid);
            const res = await removeTripMember(planId, uid);
            if (res === "ok") {
                await updateUserRow(tripKey(planId), planId, (cur) => {
                    const r = cur as (SharedTrip & { id?: string; uid?: string }) | undefined;
                    if (!r || !Array.isArray(r.days)) return null;
                    let touched = false;
                    const days = r.days.map((d) => ({
                        ...d,
                        items: (Array.isArray(d.items) ? d.items : []).map((it) => {
                            if (it.by !== uid) return it;
                            touched = true;
                            const { by: _b, ...bare } = it;
                            void _b;
                            return bare;
                        }),
                    }));
                    if (!touched) return null;
                    const { id: _i, uid: _u, rev: _r, updatedAt: _t, ...rest } = r;
                    void _i; void _u; void _r; void _t;
                    return { ...rest, days };
                });
            }
        } catch (e) {
            console.error(`purgeTripSharesFor: プランの掃除に失敗（${planId}）:`, errName(e));
        }
    }
    // 一覧の行（`tripsjoined#<uid>`）は `account.ts` が名指しで消す（`accountCleanupRows.test.ts` の見張り）
}
