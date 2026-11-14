import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 旅行プランを仲間と使う（2026-11-12・`tripShare.ts`・`tripPlans.ts` の「共有したプラン」・`tripChat.ts`）。
 *
 * ここで縛ること:
 *  1. **仲間でない人は読めない・書けない**（プランの有無も教えない＝404）。日程・会話・招待・抜ける、どの口も
 *  2. 共有すると本人だけの一覧から `trip#<planId>` へ移り、一覧の口（`GET /user/trips`）に**1回だけ**出る
 *  3. 直接の共有は **DM の会話が承認済みの相手だけ**。**ブロックの間柄なら招待できない**（直接・リンクの両方）
 *  4. 日程は仲間が足せる。**`rev` が古ければ 409 で書かない**。足した人（`by`）はサーバーが付ける
 *  5. 会話の未読は通し番号。読むと 0
 *  6. **退会で行が消える**（本人の通・足した人の印・一覧の行。最後の1人ならプランと会話も）
 *
 * DynamoDB は手元の表（`store`）で真似る。条件つきの書き込み（`attribute_not_exists(id)`・`rev = :rev`）も真似る
 */

type Row = Record<string, unknown>;
const store = vi.hoisted(() => new Map<string, Row>());
const users = vi.hoisted(() => new Map<string, Row>());
const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test", USER_INDEX: "userId-createdAt-index" }));
vi.mock("../liveCaller", async (orig) => ({
    ...(await orig<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => null,
    readLiveCaller: async () => ({ row: undefined }),
}));
const mockPush = vi.hoisted(() => vi.fn(async () => ({ sent: 1, invalid: [] as string[] })));
vi.mock("../apns", async (orig) => ({
    ...(await orig<typeof import("../apns")>()),
    apnsConfigured: () => true,
    sendPush: mockPush,
}));
vi.mock("../devices", async (orig) => ({
    ...(await orig<typeof import("../devices")>()),
    deviceTokens: async (uid: string) => [`tok-${uid}`],
    forgetTokens: async () => undefined,
}));

function fakeSend(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    const name = cmd.constructor.name;
    const i = cmd.input as {
        TableName?: string; Key?: { id?: string; userId?: string }; Item?: Row; ConditionExpression?: string;
        ExpressionAttributeValues?: Record<string, unknown>; RequestItems?: Record<string, { Keys: Array<{ id?: string; userId?: string }> }>;
    };
    const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    if (name === "GetCommand") {
        if (i.TableName === "photos-test") return { Item: clone(store.get(i.Key!.id!)) };
        return { Item: clone(users.get(i.Key!.userId!)) };
    }
    if (name === "PutCommand") {
        const id = i.Item!.id as string;
        const cur = store.get(id);
        const c = i.ConditionExpression;
        if (c === "attribute_not_exists(id)" && cur) throw condFail();
        if (c === "rev = :rev" && (!cur || cur.rev !== i.ExpressionAttributeValues![":rev"])) throw condFail();
        if (c?.startsWith("attribute_not_exists(id) OR attribute_not_exists(rev)") && cur && cur.rev !== undefined
            && cur.rev !== i.ExpressionAttributeValues![":rev"]) throw condFail();
        store.set(id, clone(i.Item!));
        return {};
    }
    if (name === "DeleteCommand") { store.delete(i.Key!.id!); return {}; }
    if (name === "BatchGetCommand") {
        const out: Record<string, Row[]> = {};
        for (const [table, req] of Object.entries(i.RequestItems!)) {
            out[table] = req.Keys.map((k) => (table === "photos-test" ? store.get(k.id!) : users.get(k.userId!)))
                .filter((x): x is Row => !!x).map(clone);
        }
        return { Responses: out };
    }
    if (name === "UpdateCommand") {
        // 1日の歯止め（`dmday#<uid>#<日付>`・`dm.ts` の `reserveDaily` の形）だけ真似る。ほかは何もしない
        const id = i.Key?.id ?? "";
        if (id.startsWith("dmday#")) {
            const cur = store.get(id) ?? { id };
            const vals = i.ExpressionAttributeValues ?? {};
            const expr = String((cmd.input as { UpdateExpression?: string }).UpdateExpression ?? "");
            const field = /ADD (\w+) :one/.exec(expr)?.[1] ?? "sent";
            const max = (vals[":maxTrip"] ?? vals[":maxSent"]) as number;
            if (typeof cur[field] === "number" && (cur[field] as number) >= max) throw condFail();
            store.set(id, { ...cur, [field]: ((cur[field] as number | undefined) ?? 0) + 1 });
        }
        return {};
    }
    throw new Error(`知らない命令 ${name}`);
}

const { handler, getTripInvite, purgeTripSharesFor } = await import("../tripShare");
const { getMyTrips, updateTrip, deleteTrip } = await import("../tripPlans");
const { getInvite: getAlbumInvite } = await import("../albums");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const P = "11111111-2222-4333-8444-555555555555";
const SPOT1 = "sp_0123456789ab";
const SPOT2 = "sp_0123456789ac";

type Res = { statusCode: number; body: string };
const ev = (sub: string | null, routeKey: string, path: Record<string, string> = {}, body?: unknown) =>
    ({
        routeKey,
        requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : undefined, http: { method: routeKey.split(" ")[0] } },
        pathParameters: path,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }) as never;
const call = async (h: unknown, e: unknown) => (await (h as (e: unknown, c: unknown, cb: unknown) => Promise<Res>)(e, {}, () => undefined));
const json = (r: Res) => JSON.parse(r.body);

const api = (sub: string, routeKey: string, path: Record<string, string> = {}, body?: unknown) =>
    call(handler, ev(sub, routeKey, { planId: P, ...path }, body ?? (routeKey.startsWith("GET") ? undefined : {})));
const myTrips = async (sub: string) => json(await call(getMyTrips, ev(sub, "GET /user/trips"))).plans as Array<Record<string, unknown>>;
const putTrip = (sub: string, body: unknown) => call(updateTrip, ev(sub, "PUT /user/trips/{planId}", { planId: P }, body));

/** A が本人だけのプランを1つ持っている */
function seedOwnPlan() {
    store.set(`trips#${A}`, {
        id: `trips#${A}`, uid: A, rev: 1,
        list: [{ planId: P, ownerId: A, title: "秋の金沢", startDate: "2026-11-23", endDate: "2026-11-24",
            days: [{ items: [{ kind: "spot", spotId: SPOT1 }] }], visibility: "private",
            createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }],
    });
}
/** A と B の DM の会話（承認済み） */
function seedDm(state = "inbox", initiator = A) {
    const [lo, hi] = [A, B].sort();
    store.set(`dm#${lo}#${hi}`, { id: `dm#${lo}#${hi}`, state, initiator, items: [] });
}
/** ブロック（`block.ts` が書く3つ: 印・自分の一覧・相手の被ブロックの一覧） */
function block(blocker: string, blocked: string) {
    store.set(`block#${blocker}#${blocked}`, { id: `block#${blocker}#${blocked}` });
    store.set(`blocks#${blocker}`, { id: `blocks#${blocker}`, blockedIds: [blocked] });
    store.set(`blockedby#${blocked}`, { id: `blockedby#${blocked}`, blockerIds: [blocker] });
}

beforeEach(() => {
    store.clear();
    users.clear();
    for (const [id, name] of [[A, "あお"], [B, "べに"], [C, "しろ"]]) users.set(id, { userId: id, displayName: name });
    mockSend.mockReset();
    mockSend.mockImplementation(async (cmd) => fakeSend(cmd));
    mockPush.mockClear();
});

describe("共有する（POST /trip-share/{planId}）", () => {
    it("本人だけの一覧から trip# へ移り、一覧の口に1回だけ出る", async () => {
        seedOwnPlan();
        const r = await api(A, "POST /trip-share/{planId}");
        expect(r.statusCode).toBe(200);
        expect(store.get(`trip#${P}`)).toMatchObject({ ownerId: A, memberIds: [A], visibility: "shared", title: "秋の金沢" });
        expect((store.get(`trips#${A}`)!.list as unknown[])).toHaveLength(0);
        const plans = await myTrips(A);
        expect(plans.map((p) => p.planId)).toEqual([P]);
        expect(plans[0]).toMatchObject({ shared: true, memberIds: [A] });
        expect(typeof plans[0].rev).toBe("number");
        // 🔴 行に `userId` を持たせない（`userId-createdAt-index` に載る）
        expect(store.get(`trip#${P}`)).not.toHaveProperty("userId");
    });

    it("持ち主でない人は共有できない（プランの有無も教えない）", async () => {
        seedOwnPlan();
        expect((await api(B, "POST /trip-share/{planId}")).statusCode).toBe(404);
        expect(store.has(`trip#${P}`)).toBe(false);
    });

    it("🔴 直接の共有は DM の会話が承認済みの相手だけ", async () => {
        seedOwnPlan();
        seedDm("request");
        const r = await api(A, "POST /trip-share/{planId}", {}, { withUserId: B });
        expect(r.statusCode).toBe(404);
        expect(json(r).code).toBe("cannotShare");
        expect(store.has(`trip#${P}`)).toBe(false);
    });

    it("相手から始めた会話なら、承認前でも共有できる（自分が始めたリクエストからはできない・上の試験）", async () => {
        seedOwnPlan();
        seedDm("request", B);
        expect((await api(A, "POST /trip-share/{planId}", {}, { withUserId: B })).statusCode).toBe(200);
        expect(memberIds()).toEqual([A, B]);
    });

    it("承認済みの DM の相手は仲間に入り、その人の一覧に出て、知らせが届く", async () => {
        seedOwnPlan();
        seedDm();
        const r = await api(A, "POST /trip-share/{planId}", {}, { withUserId: B });
        expect(r.statusCode).toBe(200);
        expect(json(r).members.map((m: { id: string }) => m.id)).toEqual([A, B]);
        expect((await myTrips(B)).map((p) => p.planId)).toEqual([P]);
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect((mockPush.mock.calls[0] as unknown[])[0]).toEqual([`tok-${B}`]);
        // 本文は載せない（名前と題だけ）
        expect(JSON.stringify(mockPush.mock.calls[0])).toContain("あお が旅行プランを共有しました");
    });

    it("🔴 ブロックの間柄なら直接共有できない（どちら向きでも）", async () => {
        for (const [x, y] of [[A, B], [B, A]]) {
            store.clear();
            seedOwnPlan();
            seedDm();
            block(x, y);
            const r = await api(A, "POST /trip-share/{planId}", {}, { withUserId: B });
            expect(r.statusCode).toBe(404);
            expect(memberIds()).not.toContain(B);
        }
    });
});

const memberIds = () => ((store.get(`trip#${P}`)?.memberIds as string[] | undefined) ?? []);

/** A が共有し、B が仲間 */
async function sharedWithB() {
    seedOwnPlan();
    seedDm();
    await api(A, "POST /trip-share/{planId}", {}, { withUserId: B });
}

describe("🔴 仲間でない人は読めない・書けない", () => {
    it("詳細・会話・送る・招待・抜ける・日程を直す・消す、どれも 404 で行は変わらない", async () => {
        await sharedWithB();
        const before = JSON.stringify([...store.entries()]);
        for (const [route, path, body] of [
            ["GET /trip-share/{planId}", {}, undefined],
            ["GET /trip-share/{planId}/chat", {}, undefined],
            ["POST /trip-share/{planId}/chat", {}, { text: "こんにちは" }],
            ["POST /trip-share/{planId}/invite", {}, {}],
            ["DELETE /trip-share/{planId}/invite", {}, {}],
            ["DELETE /trip-share/{planId}/members/{uid}", { uid: B }, {}],
            ["POST /trip-share/{planId}", {}, {}],
        ] as Array<[string, Record<string, string>, unknown]>) {
            const r = await api(C, route, path, body);
            expect(r.statusCode, route).toBe(404);
        }
        expect((await putTrip(C, { title: "乗っ取り", days: [] })).statusCode).toBe(404);
        await call(deleteTrip, ev(C, "DELETE /user/trips/{planId}", { planId: P }));
        // C 自身の空の一覧の行（読んだだけで作られる行は無い）以外、何も変わっていない
        expect(JSON.stringify([...store.entries()].filter(([k]) => !k.endsWith(C)))).toBe(before);
        expect(await myTrips(C)).toEqual([]);
    });

    it("仲間から外れた人は読めなくなる", async () => {
        await sharedWithB();
        expect((await api(B, "DELETE /trip-share/{planId}/members/{uid}", { uid: B })).statusCode).toBe(200);
        expect((await api(B, "GET /trip-share/{planId}")).statusCode).toBe(404);
        expect(await myTrips(B)).toEqual([]);
        expect(memberIds()).toEqual([A]);
    });

    it("仲間でない人を外すのは持ち主だけ", async () => {
        await sharedWithB();
        expect((await api(B, "DELETE /trip-share/{planId}/members/{uid}", { uid: A })).statusCode).toBe(403);
        expect(memberIds()).toEqual([A, B]);
    });
});

describe("日程を仲間で直す（PUT /user/trips/{planId}）", () => {
    it("仲間が足すと `by` が付き、会話に「日程に足しました」の通が置かれる", async () => {
        await sharedWithB();
        const rev = store.get(`trip#${P}`)!.rev as number;
        const r = await putTrip(B, {
            rev,
            days: [{ items: [{ kind: "spot", spotId: SPOT1 }, { kind: "spot", spotId: SPOT2, by: A }] }],
        });
        expect(r.statusCode).toBe(200);
        const items = (store.get(`trip#${P}`)!.days as Array<{ items: Array<Record<string, unknown>> }>)[0].items;
        // 前から在った項目は `by` 無しのまま。新しい項目は書いた人（本文の `by` は効かない）
        expect(items[0].by).toBeUndefined();
        expect(items[1].by).toBe(B);
        const chat = store.get(`tripchat#${P}`)!.items as Array<Record<string, unknown>>;
        expect(chat).toHaveLength(1);
        expect(chat[0]).toMatchObject({ from: B, event: { type: "added", item: { kind: "spot", spotId: SPOT2 }, day: 0 } });
        // 応答は一覧（GET と同じ形）
        expect(json(r).plans[0]).toMatchObject({ planId: P, shared: true });
    });

    it("🔴 `rev` が古ければ 409 で書かず、今の姿を添える", async () => {
        await sharedWithB();
        const rev = store.get(`trip#${P}`)!.rev as number;
        expect((await putTrip(A, { rev, title: "金沢と能登" })).statusCode).toBe(200);
        const r = await putTrip(B, { rev, days: [] });
        expect(r.statusCode).toBe(409);
        expect(json(r).code).toBe("conflict");
        expect(json(r).plan.title).toBe("金沢と能登");
        expect((store.get(`trip#${P}`)!.days as unknown[])).toHaveLength(1);
    });

    it("持ち主・仲間・公開範囲は本文から動かない", async () => {
        await sharedWithB();
        await putTrip(B, { ownerId: B, memberIds: [B, C], visibility: "public", title: "x" });
        expect(store.get(`trip#${P}`)).toMatchObject({ ownerId: A, memberIds: [A, B], visibility: "shared" });
    });
});

describe("招待リンク", () => {
    it("作る → 未認証の下見は題・日付・人数・場所の数だけ → 参加すると仲間 → 2回目は already", async () => {
        await sharedWithB();
        const inv = json(await api(B, "POST /trip-share/{planId}/invite"));
        expect(inv.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
        // 仲間の誰が押しても同じリンク（プランに1本）
        expect(json(await api(A, "POST /trip-share/{planId}/invite")).token).toBe(inv.token);
        const preview = await call(getTripInvite, ev(null, "GET /trip-invites/{token}", { token: inv.token }));
        expect(preview.statusCode).toBe(200);
        expect(json(preview)).toEqual({ trip: { title: "秋の金沢", startDate: "2026-11-23", endDate: "2026-11-24", memberCount: 2, spotCount: 1 } });
        expect(preview.body).not.toContain(A);
        const j = await api(C, "POST /trip-invites/{token}/join", { token: inv.token });
        expect(j.statusCode).toBe(200);
        expect(memberIds()).toEqual([A, B, C]);
        expect(json(await api(C, "POST /trip-invites/{token}/join", { token: inv.token })).already).toBe(true);
        expect(memberIds()).toEqual([A, B, C]);
    });

    it("🔴 仲間の誰かとブロックの間柄なら参加できない", async () => {
        await sharedWithB();
        const { token } = json(await api(A, "POST /trip-share/{planId}/invite"));
        block(B, C);
        const r = await api(C, "POST /trip-invites/{token}/join", { token });
        expect(r.statusCode).toBe(404);
        expect(memberIds()).not.toContain(C);
    });

    it("取り消したリンクでは参加できない（取り消せるのは持ち主だけ）", async () => {
        await sharedWithB();
        const { token } = json(await api(A, "POST /trip-share/{planId}/invite"));
        expect((await api(B, "DELETE /trip-share/{planId}/invite")).statusCode).toBe(403);
        expect((await api(A, "DELETE /trip-share/{planId}/invite")).statusCode).toBe(200);
        expect((await api(C, "POST /trip-invites/{token}/join", { token })).statusCode).toBe(410);
        expect((await call(getTripInvite, ev(null, "GET /trip-invites/{token}", { token }))).statusCode).toBe(410);
    });

    it("旅行プランの招待はアルバムの口では開けない", async () => {
        await sharedWithB();
        const { token } = json(await api(A, "POST /trip-share/{planId}/invite"));
        expect((await call(getAlbumInvite, ev(null, "GET /invites/{token}", { token }))).statusCode).toBe(404);
    });
});

describe("会話と受信箱", () => {
    it("送ると相手の受信箱に未読1、読むと0。自分の通では未読にならない", async () => {
        await sharedWithB();
        expect((await api(A, "POST /trip-share/{planId}/chat", {}, { text: "朝の兼六園、雪吊りが見頃らしい" })).statusCode).toBe(200);
        const inboxB = json(await call(handler, ev(B, "GET /trip-share/inbox"))).trips;
        expect(inboxB[0]).toMatchObject({ planId: P, unread: 1, last: { excerpt: "朝の兼六園、雪吊りが見頃らしい", fromName: "あお" } });
        expect(json(await call(handler, ev(A, "GET /trip-share/inbox"))).trips[0].unread).toBe(0);
        const chat = json(await api(B, "GET /trip-share/{planId}/chat"));
        expect(chat.messages.map((m: { text: string }) => m.text)).toEqual(["朝の兼六園、雪吊りが見頃らしい"]);
        expect(json(await call(handler, ev(B, "GET /trip-share/inbox"))).trips[0].unread).toBe(0);
        // 知らせは相手にだけ・本文は載せない
        expect(mockPush.mock.calls.at(-1)![0]).toEqual([`tok-${B}`]);
        expect(JSON.stringify(mockPush.mock.calls.at(-1))).not.toContain("雪吊り");
    });

    it("ブロックの間柄の人の通は、見る人の会話から外れる（消さない）", async () => {
        await sharedWithB();
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "いいね" });
        block(A, B);
        expect(json(await api(A, "GET /trip-share/{planId}/chat")).messages).toEqual([]);
        expect((store.get(`tripchat#${P}`)!.items as unknown[])).toHaveLength(1);
    });
});

describe("消す・抜ける・退会", () => {
    it("持ち主が消すと全員のプランと会話が消える。仲間が消すと抜けるだけ", async () => {
        await sharedWithB();
        await api(A, "POST /trip-share/{planId}/chat", {}, { text: "x" });
        await call(deleteTrip, ev(B, "DELETE /user/trips/{planId}", { planId: P }));
        expect(memberIds()).toEqual([A]);
        await call(deleteTrip, ev(A, "DELETE /user/trips/{planId}", { planId: P }));
        expect(store.has(`trip#${P}`)).toBe(false);
        expect(store.has(`tripchat#${P}`)).toBe(false);
        expect(await myTrips(A)).toEqual([]);
    });

    it("🔴 退会: 持ち主は残った人へ渡り、本人の通と足した人の印が消える", async () => {
        await sharedWithB();
        const rev = store.get(`trip#${P}`)!.rev as number;
        await putTrip(B, { rev, days: [{ items: [{ kind: "spot", spotId: SPOT1 }, { kind: "spot", spotId: SPOT2 }] }] });
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "Bの文" });
        await api(A, "POST /trip-share/{planId}/chat", {}, { text: "Aの文" });
        await purgeTripSharesFor(A);
        await purgeTripSharesFor(B);
        // 最後の1人が抜けたのでプランと会話が消える
        expect(store.has(`trip#${P}`)).toBe(false);
        expect(store.has(`tripchat#${P}`)).toBe(false);
    });

    it("退会したのが持ち主だけなら、プランは残った仲間のもの・本人の通は消える", async () => {
        await sharedWithB();
        await api(A, "POST /trip-share/{planId}/chat", {}, { text: "Aの文" });
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "Bの文" });
        await purgeTripSharesFor(A);
        expect(store.get(`trip#${P}`)).toMatchObject({ ownerId: B, memberIds: [B] });
        expect((store.get(`tripchat#${P}`)!.items as Array<{ text: string }>).map((m) => m.text)).toEqual(["Bの文"]);
        expect(memberIds()).not.toContain(A);
    });

    it("仲間が退会すると、その人が足した場所の印が外れる", async () => {
        await sharedWithB();
        const rev = store.get(`trip#${P}`)!.rev as number;
        await putTrip(B, { rev, days: [{ items: [{ kind: "spot", spotId: SPOT1 }, { kind: "spot", spotId: SPOT2 }] }] });
        await purgeTripSharesFor(B);
        const items = (store.get(`trip#${P}`)!.days as Array<{ items: Array<Record<string, unknown>> }>)[0].items;
        expect(items.map((it) => it.by)).toEqual([undefined, undefined]);
        expect(memberIds()).toEqual([A]);
    });
});

// ---------------------------------------------------------------------------
// 確かめ役の指摘（2026-11-12・札 journey.photo-ios#562）
// ---------------------------------------------------------------------------

/** A と C の DM の会話（承認済み）。持ち主が C を直接仲間に戻す試験で使う */
function seedDmAC() {
    const [lo, hi] = [A, C].sort();
    store.set(`dm#${lo}#${hi}`, { id: `dm#${lo}#${hi}`, state: "inbox", initiator: A, items: [] });
}

describe("🔴 外した仲間は同じ招待リンクで戻れない（指摘1）", () => {
    it("持ち主が外すと、前のリンクは使えず、新しいリンクでも外した人は入れない", async () => {
        await sharedWithB();
        const { token } = json(await api(A, "POST /trip-share/{planId}/invite"));
        expect((await api(C, "POST /trip-invites/{token}/join", { token })).statusCode).toBe(200);
        expect((await api(A, "DELETE /trip-share/{planId}/members/{uid}", { uid: C })).statusCode).toBe(200);
        expect(memberIds()).toEqual([A, B]);
        // 前のリンク
        const again = await api(C, "POST /trip-invites/{token}/join", { token });
        expect(again.statusCode).not.toBe(200);
        expect(memberIds()).toEqual([A, B]);
        // 仲間の手元には作り直したリンクが出る（前と違う）
        const detail = json(await api(B, "GET /trip-share/{planId}"));
        expect(detail.invite?.token).toBeDefined();
        expect(detail.invite.token).not.toBe(token);
        // 作り直したリンクでも、外した人は入れない（理由は言わない＝404）
        const viaNew = await api(C, "POST /trip-invites/{token}/join", { token: detail.invite.token });
        expect(viaNew.statusCode).toBe(404);
        expect(memberIds()).toEqual([A, B]);
        // ほかの人は作り直したリンクで入れる
        const D = "dddddddd-0000-4000-8000-000000000004";
        users.set(D, { userId: D, displayName: "みどり" });
        expect((await api(D, "POST /trip-invites/{token}/join", { token: detail.invite.token })).statusCode).toBe(200);
        expect(memberIds()).toEqual([A, B, D]);
    });

    it("リンクが無いときに外しても、新しいリンクは作らない（作り直すのは前のリンクが生きていたときだけ）", async () => {
        await sharedWithB();
        expect((await api(A, "DELETE /trip-share/{planId}/members/{uid}", { uid: B })).statusCode).toBe(200);
        expect(json(await api(A, "GET /trip-share/{planId}")).invite).toBeUndefined();
        expect([...store.keys()].filter((k) => k.startsWith("invite#"))).toEqual([]);
    });

    it("自分で抜けた人は、リンクでまた入れる（外されたのではない）", async () => {
        await sharedWithB();
        const { token } = json(await api(A, "POST /trip-share/{planId}/invite"));
        expect((await api(B, "DELETE /trip-share/{planId}/members/{uid}", { uid: B })).statusCode).toBe(200);
        expect((await api(B, "POST /trip-invites/{token}/join", { token })).statusCode).toBe(200);
        expect(memberIds()).toEqual([A, B]);
    });

    it("持ち主が改めて直接共有すると、外した人も戻れる（外した印が消える）", async () => {
        await sharedWithB();
        seedDmAC();
        expect((await api(A, "POST /trip-share/{planId}", {}, { withUserId: C })).statusCode).toBe(200);
        expect((await api(A, "DELETE /trip-share/{planId}/members/{uid}", { uid: C })).statusCode).toBe(200);
        expect(store.get(`trip#${P}`)!.removedIds).toEqual([C]);
        expect((await api(A, "POST /trip-share/{planId}", {}, { withUserId: C })).statusCode).toBe(200);
        expect(memberIds()).toEqual([A, B, C]);
        expect(store.get(`trip#${P}`)!.removedIds ?? []).toEqual([]);
    });
});

describe("一覧の口は、仲間でない行を落とす（指摘3）", () => {
    it("一覧の行にプラン ID が残っていても、仲間から外れていれば返さない", async () => {
        await sharedWithB();
        // 外したときに一覧の行から消せなかった（落ちた）形を作る
        store.set(`tripsjoined#${C}`, { id: `tripsjoined#${C}`, uid: C, rev: 1, list: [P], reads: {} });
        expect(await myTrips(C)).toEqual([]);
        // 仲間には出る
        expect((await myTrips(B)).map((p) => p.planId)).toEqual([P]);
    });
});

describe("🔴 共有プランの日程は rev が無ければ書かない（指摘4）", () => {
    it("rev を送らない日程の書き込みは 409 で、今の姿を添える（丸ごと上書きしない）", async () => {
        await sharedWithB();
        const r = await putTrip(B, { days: [] });
        expect(r.statusCode).toBe(409);
        expect(json(r).code).toBe("revRequired");
        expect(json(r).plan.days).toHaveLength(1);
        expect((store.get(`trip#${P}`)!.days as unknown[])).toHaveLength(1);
    });

    it("題だけなら rev が無くても書ける（日程を消さない）", async () => {
        await sharedWithB();
        expect((await putTrip(B, { title: "金沢" })).statusCode).toBe(200);
        expect(store.get(`trip#${P}`)).toMatchObject({ title: "金沢" });
        expect((store.get(`trip#${P}`)!.days as unknown[])).toHaveLength(1);
    });

    it("本人だけのプランは今までどおり rev 無しで書ける", async () => {
        seedOwnPlan();
        expect((await putTrip(A, { days: [] })).statusCode).toBe(200);
    });
});

describe("🔴 退会で前に抜けた・外されたプランの自分の分も消える（指摘5）", () => {
    it("抜けたあとに退会しても、そのプランの自分の通と足した人の印が消える", async () => {
        await sharedWithB();
        const rev = store.get(`trip#${P}`)!.rev as number;
        await putTrip(B, { rev, days: [{ items: [{ kind: "spot", spotId: SPOT1 }, { kind: "spot", spotId: SPOT2 }] }] });
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "Bの文" });
        await api(A, "POST /trip-share/{planId}/chat", {}, { text: "Aの文" });
        expect((await api(B, "DELETE /trip-share/{planId}/members/{uid}", { uid: B })).statusCode).toBe(200);
        expect(store.get(`tripsjoined#${B}`)!.left).toEqual([P]);
        const errors = vi.spyOn(console, "error");
        await purgeTripSharesFor(B);
        // 掃除の途中で投げていない（投げても止めずにログだけ出すので、ログで見る）
        expect(errors.mock.calls.filter((c) => String(c[0]).startsWith("purgeTripSharesFor"))).toEqual([]);
        errors.mockRestore();
        expect(store.get(`tripsjoined#${B}`)!.left).toEqual([]);
        const items = (store.get(`trip#${P}`)!.days as Array<{ items: Array<Record<string, unknown>> }>)[0].items;
        expect(items.map((it) => it.by)).toEqual([undefined, undefined]);
        const chat = store.get(`tripchat#${P}`)!.items as Array<{ from: string }>;
        expect(chat.filter((m) => m.from === B)).toEqual([]);
        expect(chat.filter((m) => m.from === A)).toHaveLength(1);
    });

    it("外されたあとに退会しても同じ（外した印からも消える）", async () => {
        await sharedWithB();
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "Bの文" });
        expect((await api(A, "DELETE /trip-share/{planId}/members/{uid}", { uid: B })).statusCode).toBe(200);
        await purgeTripSharesFor(B);
        const chat = (store.get(`tripchat#${P}`)?.items ?? []) as Array<{ from: string }>;
        expect(chat.filter((m) => m.from === B)).toEqual([]);
        expect(store.get(`trip#${P}`)!.removedIds ?? []).not.toContain(B);
    });

    it("取り消した招待の行も、プランを消すと消える", async () => {
        await sharedWithB();
        const first = json(await api(A, "POST /trip-share/{planId}/invite")).token as string;
        expect((await api(A, "DELETE /trip-share/{planId}/invite")).statusCode).toBe(200);
        const second = json(await api(A, "POST /trip-share/{planId}/invite")).token as string;
        expect(second).not.toBe(first);
        expect(store.has(`invite#${first}`)).toBe(true);
        await call(deleteTrip, ev(A, "DELETE /user/trips/{planId}", { planId: P }));
        expect(store.has(`trip#${P}`)).toBe(false);
        expect([...store.keys()].filter((k) => k.startsWith("invite#"))).toEqual([]);
    });
});

describe("会話の歯止め（指摘6・10）", () => {
    it("1日に送れる数を越えると 429 で、会話に置かない（DM の数とは別に数える）", async () => {
        await sharedWithB();
        const { TRIP_CHAT_DAILY_SENT } = await import("../dm");
        expect((await api(A, "POST /trip-share/{planId}/chat", {}, { text: "1通目" })).statusCode).toBe(200);
        const key = [...store.keys()].find((k) => k.startsWith(`dmday#${A}#`))!;
        expect(key).toBeDefined();
        expect(store.get(key)!.tripSent).toBe(1);
        store.set(key, { ...store.get(key)!, tripSent: TRIP_CHAT_DAILY_SENT });
        const r = await api(A, "POST /trip-share/{planId}/chat", {}, { text: "越えた" });
        expect(r.statusCode).toBe(429);
        expect((store.get(`tripchat#${P}`)!.items as unknown[])).toHaveLength(1);
        expect(store.get(key)!.sent).toBeUndefined();
    });

    it("本文は TRIP_CHAT_TEXT_MAX 字で切る", async () => {
        await sharedWithB();
        const { TRIP_CHAT_TEXT_MAX } = await import("../tripChat");
        await api(A, "POST /trip-share/{planId}/chat", {}, { text: "あ".repeat(TRIP_CHAT_TEXT_MAX + 50) });
        const items = store.get(`tripchat#${P}`)!.items as Array<{ text: string }>;
        expect([...items[0].text].length).toBe(TRIP_CHAT_TEXT_MAX);
    });
});

describe("知らせは並べて送る（指摘7）", () => {
    it("1人目の送信が終わる前に、2人目にも送り始める", async () => {
        await sharedWithB();
        const { token } = json(await api(A, "POST /trip-share/{planId}/invite"));
        await api(C, "POST /trip-invites/{token}/join", { token });
        let started = 0;
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        mockPush.mockImplementation(async () => {
            started += 1;
            if (started >= 2) release();
            // 順に送ると、ここで止まったまま2人目に進まない（1秒で諦める）
            await Promise.race([gate, new Promise((r) => setTimeout(r, 1000))]);
            return { sent: 1, invalid: [] as string[] };
        });
        const t0 = Date.now();
        expect((await api(A, "POST /trip-share/{planId}/chat", {}, { text: "集合は8時" })).statusCode).toBe(200);
        expect(started).toBe(2);
        expect(Date.now() - t0).toBeLessThan(900);
        mockPush.mockImplementation(async () => ({ sent: 1, invalid: [] as string[] }));
    });
});

// ---------------------------------------------------------------------------
// 確かめ役の見直し（2026-11-12・2回目）
// ---------------------------------------------------------------------------

describe("rev を送らない古いアプリへの断り（見直し1）", () => {
    it("rev が無いことで断った回は code が revRequired で、アプリを新しくする文を返す（今の姿も添える）", async () => {
        await sharedWithB();
        const r = await putTrip(B, { days: [] });
        expect(r.statusCode).toBe(409);
        expect(json(r).code).toBe("revRequired");
        expect(json(r).error).toContain("アプリを新しく");
        expect(json(r).plan.planId).toBe(P);
    });

    it("rev が古い回は今までどおり conflict（読み直せば直る）", async () => {
        await sharedWithB();
        const rev = store.get(`trip#${P}`)!.rev as number;
        await putTrip(A, { rev, title: "x" });
        const r = await putTrip(B, { rev, days: [] });
        expect(json(r).code).toBe("conflict");
        expect(json(r).error).not.toContain("アプリを新しく");
    });
});

/** 共有する途中で落ちた形: 共有の行（trip#）があるのに、本人だけの一覧（trips#）にも古い写しが残っている */
async function halfShared() {
    await sharedWithB();
    seedOwnPlan();
}

describe("🔴 共有する途中で両方に行がある間（見直し3）", () => {
    it("PUT は共有の行を直す（本人だけの古い写しを直さない）", async () => {
        await halfShared();
        const rev = store.get(`trip#${P}`)!.rev as number;
        expect((await putTrip(A, { rev, title: "金沢と能登" })).statusCode).toBe(200);
        expect(store.get(`trip#${P}`)!.title).toBe("金沢と能登");
        // 一覧の口にも直した題が出る（共有の方が採られる）
        expect((await myTrips(A)).find((p) => p.planId === P)!.title).toBe("金沢と能登");
    });

    it("持ち主が直したら、本人だけの古い写しを片付ける（共有を終わらせる）", async () => {
        await halfShared();
        const rev = store.get(`trip#${P}`)!.rev as number;
        await putTrip(A, { rev, title: "金沢と能登" });
        expect(((store.get(`trips#${A}`)!.list as Array<{ planId: string }>) ?? []).map((p) => p.planId)).not.toContain(P);
    });

    it("持ち主が消すと、共有の行も消える（本人だけの写しだけ消して共有が残る、をしない）", async () => {
        await halfShared();
        await call(deleteTrip, ev(A, "DELETE /user/trips/{planId}", { planId: P }));
        expect(store.has(`trip#${P}`)).toBe(false);
        expect((await myTrips(A)).map((p) => p.planId)).not.toContain(P);
        expect((await myTrips(B)).map((p) => p.planId)).not.toContain(P);
    });
});

/**
 * 会話の1通の通報（2026-11-14・札 journey.photo-ios#597・審査ガイドライン 1.2）。
 * 仲間だけ・ほかの人の文の通だけ・直近の写しを `tripreport#<plan>#<通>#<通報者>` に残す。相手には知らせない
 */
describe("会話の通報（POST /trip-share/{planId}/report）", () => {
    const report = (sub: string, body: unknown) => api(sub, "POST /trip-share/{planId}/report", {}, body);
    const messagesOf = () => store.get(`tripchat#${P}`)!.items as Array<{ id: string; from: string; text?: string }>;
    const reportRows = () => [...store.entries()].filter(([k]) => k.startsWith("tripreport#"));

    it("ほかの仲間の通を通報すると、直近の写しが残る（1人1通に1件・押し直しは上書き）", async () => {
        await sharedWithB();
        await api(A, "POST /trip-share/{planId}/chat", {}, { text: "朝いちで行こう" });
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "いやな文" });
        const target = messagesOf().find((m) => m.text === "いやな文")!;
        mockPush.mockClear();
        const r = await report(A, { messageId: target.id, reason: "harassment", note: "  何度も  " });
        expect(r.statusCode).toBe(200);
        expect(json(r)).toEqual({ success: true });
        const rows = reportRows();
        expect(rows.map(([k]) => k)).toEqual([`tripreport#${P}#${target.id}#${A}`]);
        const row = rows[0][1];
        expect(row).toMatchObject({ planId: P, messageId: target.id, reporterId: A, reportedId: B, reason: "harassment", note: "何度も" });
        expect((row.messages as Array<{ text: string }>).map((m) => m.text)).toEqual(["朝いちで行こう", "いやな文"]);
        // 🔴 `userId` の欄を持たせない（`userId-createdAt-index` に載る）
        expect(row).not.toHaveProperty("userId");
        // 相手には知らせない
        expect(mockPush).not.toHaveBeenCalled();
        await report(A, { messageId: target.id, reason: "spam" });
        expect(reportRows()).toHaveLength(1);
        expect(reportRows()[0][1]).toMatchObject({ reason: "spam" });
        expect(reportRows()[0][1]).not.toHaveProperty("note");
    });

    it("ブロックした後でも通報できる（写しはブロックした相手の通も入れる）", async () => {
        await sharedWithB();
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "いやな文" });
        const target = messagesOf()[0];
        block(A, B);
        expect((await report(A, { messageId: target.id, reason: "harassment" })).statusCode).toBe(200);
        expect((reportRows()[0][1].messages as Array<{ id: string }>).map((m) => m.id)).toEqual([target.id]);
    });

    it("直近 20 通を写す。古い通を通報したら、その通も頭に入れる", async () => {
        await sharedWithB();
        const { TRIP_REPORT_LAST } = await import("../tripChat");
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "古い文" });
        for (let n = 0; n < TRIP_REPORT_LAST + 2; n++) await api(A, "POST /trip-share/{planId}/chat", {}, { text: `文${n}` });
        const old = messagesOf()[0];
        expect((await report(A, { messageId: old.id, reason: "other" })).statusCode).toBe(200);
        const copied = reportRows()[0][1].messages as Array<{ id: string; text: string }>;
        expect(copied).toHaveLength(TRIP_REPORT_LAST + 1);
        expect(copied[0]).toMatchObject({ id: old.id, text: "古い文" });
        expect(copied.at(-1)!.text).toBe(`文${TRIP_REPORT_LAST + 1}`);
    });

    it("仲間でない人は 404（プランの有無も教えない）・行を書かない", async () => {
        await sharedWithB();
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "こんにちは" });
        const r = await report(C, { messageId: messagesOf()[0].id, reason: "spam" });
        expect(r.statusCode).toBe(404);
        expect(json(r).code).toBe("notFound");
        expect(reportRows()).toEqual([]);
    });

    it("自分の通・「日程に足しました」の通・無い通・形の違う id・理由の無いものは断る", async () => {
        await sharedWithB();
        await api(A, "POST /trip-share/{planId}/chat", {}, { text: "自分の文" });
        const mine = messagesOf()[0];
        const rev = store.get(`trip#${P}`)!.rev as number;
        expect((await putTrip(B, { rev, days: [{ items: [{ kind: "spot", spotId: SPOT1 }, { kind: "spot", spotId: SPOT2 }] }] })).statusCode).toBe(200);
        const event = messagesOf().find((m) => m.from === B && m.text === undefined)!;
        expect(event).toBeDefined();
        expect((await report(A, { messageId: mine.id, reason: "spam" })).statusCode).toBe(400);
        expect((await report(A, { messageId: event.id, reason: "spam" })).statusCode).toBe(400);
        const gone = await report(A, { messageId: "00000000-0000-4000-8000-000000000000", reason: "spam" });
        expect(gone.statusCode).toBe(404);
        expect(json(gone).code).toBe("messageNotFound");
        expect((await report(A, { messageId: "tripreport#x", reason: "spam" })).statusCode).toBe(400);
        expect((await report(A, { messageId: mine.id, reason: "nope" })).statusCode).toBe(400);
        expect(reportRows()).toEqual([]);
    });
});

/** 確かめ役の指摘（2026-11-14）: 押し直しで前の写しを消さない・ブロックの間柄の仲間の通を写さない */
describe("会話の通報の写し（押し直し・ブロックの間柄）", () => {
    const report = (sub: string, body: unknown) => api(sub, "POST /trip-share/{planId}/report", {}, body);
    const messagesOf = () => store.get(`tripchat#${P}`)!.items as Array<{ id: string; from: string; text?: string }>;
    const copied = () => [...store.entries()].filter(([k]) => k.startsWith("tripreport#"))
        .flatMap(([, v]) => v.messages as Array<{ id: string; from: string; text: string }>);

    it("押し直しても、前の写しにあって会話から消えた通は残る（DM の通報と同じ）", async () => {
        await sharedWithB();
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "前の文" });
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "いやな文" });
        const target = messagesOf().find((m) => m.text === "いやな文")!;
        expect((await report(A, { messageId: target.id, reason: "harassment" })).statusCode).toBe(200);
        // 「前の文」が会話から消えた（流れた・取り消された）あとに押し直す
        const row = store.get(`tripchat#${P}`)!;
        store.set(`tripchat#${P}`, { ...row, items: messagesOf().filter((m) => m.text !== "前の文") });
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "後の文" });
        expect((await report(A, { messageId: target.id, reason: "spam" })).statusCode).toBe(200);
        expect(copied().map((m) => m.text)).toEqual(["前の文", "いやな文", "後の文"]);
        expect([...store.keys()].filter((k) => k.startsWith("tripreport#"))).toHaveLength(1);
    });

    async function withC() {
        await sharedWithB();
        const { token } = json(await api(A, "POST /trip-share/{planId}/invite"));
        expect((await api(C, "POST /trip-invites/{token}/join", { token })).statusCode).toBe(200);
        await api(C, "POST /trip-share/{planId}/chat", {}, { text: "しろの文" });
        await api(B, "POST /trip-share/{planId}/chat", {}, { text: "いやな文" });
        return messagesOf().find((m) => m.text === "いやな文")!;
    }

    it("通報した人をブロックしている仲間（C）の通は写さない", async () => {
        const target = await withC();
        block(C, A);
        expect((await report(A, { messageId: target.id, reason: "harassment" })).statusCode).toBe(200);
        expect(copied().map((m) => m.from)).not.toContain(C);
        expect(copied().map((m) => m.text)).toEqual(["いやな文"]);
    });

    it("通報した人がブロックしている仲間（C）の通は写さない", async () => {
        const target = await withC();
        block(A, C);
        expect((await report(A, { messageId: target.id, reason: "harassment" })).statusCode).toBe(200);
        expect(copied().map((m) => m.from)).not.toContain(C);
        expect(copied().map((m) => m.text)).toEqual(["いやな文"]);
    });
});
