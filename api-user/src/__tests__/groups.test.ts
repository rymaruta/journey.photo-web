import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * グループの DM（2026-11-20・札 journey.photo-ios#582・`groups.ts`・`groupChat.ts`）。
 *
 * ここで縛ること:
 *  1. **メンバーでない人は読めない・送れない**（グループの有無も教えない＝404）
 *  2. **ブロックの間柄の人を入れられない**（作るとき・足すとき・招待に参加するとき）
 *  3. **30 人を超えられない**（招待中の人も数える）
 *  4. **抜けたら読めない・送れない**（受信箱からも消える）
 *  5. **送信の上限**（1日 300 通・`dmday#` の `groupSent`。DM の `sent` とは別に数える）
 *  6. **招待の承諾前は中身が見えない**（会話は 404・詳しいは名前・入れた人・人数だけ）。参加後も入る前の話は見えない
 *  7. **知らせの宛先にブロックの間柄の人・抜けた人・止めた人・自分がいない**。`sendPush` は1回（接続1本）・束は `thread-id`
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
const mockPush = vi.hoisted(() => vi.fn<(tokens: readonly string[], msg: unknown) => Promise<{ sent: number; invalid: string[] }>>(
    async () => ({ sent: 1, invalid: [] }),
));
vi.mock("../apns", async (orig) => ({
    ...(await orig<typeof import("../apns")>()),
    apnsConfigured: () => true,
    sendPush: mockPush,
}));
vi.mock("../devices", async (orig) => ({
    ...(await orig<typeof import("../devices")>()),
    forgetTokens: async () => undefined,
}));

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function fakeSend(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    const name = cmd.constructor.name;
    const i = cmd.input as {
        TableName?: string; Key?: { id?: string; userId?: string }; Item?: Row; ConditionExpression?: string; UpdateExpression?: string;
        ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown>;
        RequestItems?: Record<string, { Keys: Array<{ id?: string; userId?: string }> }>;
    };
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
        // 1日の歯止め（`groups.ts` の `reserveGroupDaily`: `ADD #f :k`・条件 `#f <= :lim`）だけ真似る
        const id = i.Key?.id ?? "";
        if (id.startsWith("dmday#")) {
            const cur = store.get(id) ?? { id };
            const field = i.ExpressionAttributeNames?.["#f"] ?? "";
            const k = i.ExpressionAttributeValues?.[":k"] as number;
            const lim = i.ExpressionAttributeValues?.[":lim"] as number;
            if (!field || typeof k !== "number") throw new Error(`知らない歯止め ${i.UpdateExpression}`);
            if (typeof cur[field] === "number" && (cur[field] as number) > lim) throw condFail();
            store.set(id, { ...cur, [field]: ((cur[field] as number | undefined) ?? 0) + k });
        }
        return {};
    }
    throw new Error(`知らない命令 ${name}`);
}

const { handler, purgeGroupsFor, GROUP_MEMBERS_MAX } = await import("../groups");
const { pushPayload } = await import("../apns");

const uid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const A = uid(0xa1);
const B = uid(0xb2);
const C = uid(0xc3);
const D = uid(0xd4);
const E = uid(0xe5);
const X = uid(0xf6);   // 関係の無い人

type Res = { statusCode: number; body: string };
const ev = (sub: string | null, routeKey: string, path: Record<string, string> = {}, body?: unknown) =>
    ({
        routeKey,
        requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : undefined, http: { method: routeKey.split(" ")[0] } },
        pathParameters: path,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }) as never;
const call = async (e: unknown) => (await (handler as unknown as (e: unknown, c: unknown, cb: unknown) => Promise<Res>)(e, {}, () => undefined));
const json = (r: Res) => JSON.parse(r.body);
const api = (sub: string, routeKey: string, path: Record<string, string> = {}, body?: unknown) =>
    call(ev(sub, routeKey, path, body ?? (routeKey.startsWith("GET") ? undefined : {})));

/** `follower` が `target` をフォローしている */
function follow(follower: string, target: string) {
    store.set(`follow#${target}#${follower}`, { id: `follow#${target}#${follower}` });
}
/** 2人が互いにフォロー */
const mutual = (a: string, b: string) => { follow(a, b); follow(b, a); };
/** ブロック（`block.ts` が書く3つ: 印・自分の一覧・相手の被ブロックの一覧） */
function block(blocker: string, blocked: string) {
    store.set(`block#${blocker}#${blocked}`, { id: `block#${blocker}#${blocked}` });
    const mine = store.get(`blocks#${blocker}`)?.blockedIds as string[] | undefined;
    store.set(`blocks#${blocker}`, { id: `blocks#${blocker}`, blockedIds: [...(mine ?? []), blocked] });
    const theirs = store.get(`blockedby#${blocked}`)?.blockerIds as string[] | undefined;
    store.set(`blockedby#${blocked}`, { id: `blockedby#${blocked}`, blockerIds: [...(theirs ?? []), blocker] });
}

/** A が作る。返すのはグループの id */
async function createBy(owner: string, memberIds: string[], name?: string): Promise<string> {
    const r = await api(owner, "POST /groups", {}, { memberIds, ...(name ? { name } : {}) });
    expect(r.statusCode, r.body).toBe(201);
    return json(r).group.groupId as string;
}
const say = (sub: string, g: string, text: string) => api(sub, "POST /groups/{groupId}/messages", { groupId: g }, { text });
const read = (sub: string, g: string) => api(sub, "GET /groups/{groupId}/messages", { groupId: g });
const texts = (r: Res) => (json(r).messages as Array<{ text?: string }>).map((m) => m.text).filter(Boolean);
/** 知らせの「3分に1回まで」を外す（続けて送る試験のため） */
const resetQuiet = (g: string) => {
    const row = store.get(`group#${g}`)!;
    delete row.notifiedAt;
    store.set(`group#${g}`, row);
};

beforeEach(() => {
    store.clear();
    users.clear();
    for (const [id, name] of [[A, "あお"], [B, "べに"], [C, "しろ"], [D, "くろ"], [E, "みどり"], [X, "きいろ"]]) {
        users.set(id, { userId: id, displayName: name });
        store.set(`devices#${id}`, { id: `devices#${id}`, tokens: [`tok-${id}`] });
    }
    mockSend.mockReset();
    mockSend.mockImplementation(async (cmd) => fakeSend(cmd));
    mockPush.mockClear();
});

describe("作る（POST /groups）", () => {
    it("2人以上を選ぶと、フォローし合う人はそのまま入り、作った人が作った人になる", async () => {
        mutual(A, B); mutual(A, C);
        const r = await api(A, "POST /groups", {}, { memberIds: [B, C] });
        expect(r.statusCode).toBe(201);
        const body = json(r);
        expect(body.isOwner).toBe(true);
        expect(body.members.map((m: { id: string }) => m.id)).toEqual([A, B, C]);
        expect(body.group.displayName).toBe("べに、しろ");
        expect(body.notAdded).toBe(0);
        // 入った2人に「入れました」の知らせ（本文は載せない）
        expect(mockPush).toHaveBeenCalledTimes(2);
        expect(mockPush.mock.calls.map((c) => (c[1] as { body: string }).body)).toEqual(["あお があなたをグループに入れました", "あお があなたをグループに入れました"]);
    });

    it("作った時に入った人には「作りました」の1行から見える", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        const evs = (json(await read(B, g)).messages as Array<{ event?: { type: string } }>).map((m) => m.event?.type);
        expect(evs).toEqual(["created"]);
        expect(json(await api(B, "GET /groups")).groups[0].unread).toBe(0);
    });

    it("1人だけでは作れない（1対1は今の DM）", async () => {
        mutual(A, B);
        expect((await api(A, "POST /groups", {}, { memberIds: [B] })).statusCode).toBe(400);
    });

    it("🔴 入れる人がフォローしていない人は入らない（知らない人をいきなり入れない）", async () => {
        mutual(A, B);
        follow(C, A);   // C は A をフォローしているが、A は C をフォローしていない
        const r = await api(A, "POST /groups", {}, { memberIds: [B, C] });
        expect(r.statusCode).toBe(201);
        expect(json(r).members.map((m: { id: string }) => m.id)).toEqual([A, B]);
        expect(json(r).invited).toEqual([]);
        expect(json(r).notAdded).toBe(1);
    });

    it("1日に作れるのは 10 まで（`dmday#` の `groupNew`）", async () => {
        mutual(A, B); mutual(A, C);
        for (let n = 0; n < 10; n++) await createBy(A, [B, C]);
        const r = await api(A, "POST /groups", {}, { memberIds: [B, C] });
        expect(r.statusCode).toBe(429);
        expect(json(r).code).toBe("dailyLimit");
    });
});

describe("🔴 1. メンバーでない人は読めない・送れない", () => {
    it("どの口も 404（グループの有無を教えない）", async () => {
        mutual(A, B); mutual(A, C); mutual(A, X);
        const g = await createBy(A, [B, C]);
        await say(A, g, "来月の金沢、3人で行かない？");
        for (const [route, body] of [
            ["GET /groups/{groupId}", undefined],
            ["GET /groups/{groupId}/messages", undefined],
            ["POST /groups/{groupId}/messages", { text: "まぜて" }],
            ["PUT /groups/{groupId}", { name: "のっとり" }],
            ["POST /groups/{groupId}/members", { userIds: [X] }],
            ["POST /groups/{groupId}/report", { reason: "spam" }],
            ["POST /groups/{groupId}/join", {}],
        ] as const) {
            const r = await api(X, route, { groupId: g }, body);
            expect(r.statusCode, route).toBe(404);
        }
        // 書けていない
        expect(texts(await read(A, g))).toEqual(["来月の金沢、3人で行かない？"]);
        expect(json(await api(A, "GET /groups/{groupId}", { groupId: g })).group.name).toBeNull();
    });

    it("受信箱に出ない", async () => {
        mutual(A, B); mutual(A, C);
        await createBy(A, [B, C]);
        expect(json(await api(X, "GET /groups")).groups).toEqual([]);
        expect(json(await api(B, "GET /groups")).groups).toHaveLength(1);
    });
});

describe("🔴 2. ブロックしている人を入れられない", () => {
    it("作るとき: 入れる人とブロックの間柄の人は入らない（理由は言わず、数だけ）", async () => {
        mutual(A, B); mutual(A, C);
        block(C, A);   // C が A をブロック
        const r = await api(A, "POST /groups", {}, { memberIds: [B, C] });
        expect(r.statusCode).toBe(201);
        expect(json(r).members.map((m: { id: string }) => m.id)).toEqual([A, B]);
        expect(json(r).notAdded).toBe(1);
        expect(r.body).not.toMatch(/ブロック/);
    });

    it("足すとき: メンバーの誰かとブロックの間柄の人は入らない", async () => {
        mutual(A, B); mutual(A, C); mutual(A, D);
        const g = await createBy(A, [B, C]);
        block(D, B);   // D が B をブロック（入れる A とは関係が無い）
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [D] });
        expect(r.statusCode).toBe(200);
        expect(json(r).added).toEqual([]);
        expect(json(r).notAdded).toBe(1);
        expect(json(r).members.map((m: { id: string }) => m.id)).not.toContain(D);
        expect(read(D, g).then((x) => x.statusCode)).resolves.toBe(404);
    });

    it("招待に参加するとき: 招待のあとにブロックの間柄になったら入れない", async () => {
        mutual(A, B);
        follow(A, C);   // A は C をフォロー・C は A をフォローしていない → 招待
        const g = await createBy(A, [B, C]);
        block(B, C);
        const r = await api(C, "POST /groups/{groupId}/join", { groupId: g });
        expect(r.statusCode).toBe(404);
        expect((await read(C, g)).statusCode).toBe(404);
    });
});

describe("🔴 3. 30人を超えられない", () => {
    const many = Array.from({ length: 31 }, (_, n) => uid(0x100 + n));
    beforeEach(() => {
        for (const id of many) {
            users.set(id, { userId: id, displayName: `人${id.slice(-3)}` });
            mutual(A, id);
        }
    });

    it("自分を入れて 30 人までは作れる。31 人目は足せない", async () => {
        const g = await createBy(A, many.slice(0, 29));
        const d = json(await api(A, "GET /groups/{groupId}", { groupId: g }));
        expect(d.members).toHaveLength(GROUP_MEMBERS_MAX);
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [many[29]] });
        expect(r.statusCode).toBe(403);
        expect(json(r).code).toBe("full");
        expect(json(await api(A, "GET /groups/{groupId}", { groupId: g })).members).toHaveLength(30);
    });

    it("1回に 30 人を選んで作ることはできない", async () => {
        const r = await api(A, "POST /groups", {}, { memberIds: many.slice(0, 30) });
        expect(r.statusCode).toBe(403);
    });

    it("招待中の人も 30 人の中で数える", async () => {
        const g = await createBy(A, many.slice(0, 28));   // 29 人
        follow(A, C);   // C は A をフォローしていない → 招待（30 人目の席を使う）
        const r1 = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [C] });
        expect(json(r1).invitedNow).toEqual([C]);
        const r2 = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [many[29]] });
        expect(r2.statusCode).toBe(403);
    });
});

describe("🔴 4. 抜けたら読めない", () => {
    it("抜けた人は読めない・送れない・受信箱から消える。残った人には「抜けました」", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await say(A, g, "はじめまして");
        expect((await read(B, g)).statusCode).toBe(200);
        expect((await api(B, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: B })).statusCode).toBe(200);
        expect((await read(B, g)).statusCode).toBe(404);
        expect((await say(B, g, "やっぱり")).statusCode).toBe(404);
        expect((await api(B, "GET /groups/{groupId}", { groupId: g })).statusCode).toBe(404);
        expect(json(await api(B, "GET /groups")).groups).toEqual([]);
        const events = (json(await read(A, g)).messages as Array<{ event?: { type: string } }>).map((m) => m.event?.type).filter(Boolean);
        expect(events).toContain("left");
    });

    it("作った人が抜けたら、いちばん前から居る人が作った人になる。最後の1人が抜けたらグループを消す", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await api(A, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: A });
        expect(json(await api(B, "GET /groups/{groupId}", { groupId: g })).isOwner).toBe(true);
        await api(B, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: B });
        await api(C, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: C });
        expect(store.has(`group#${g}`)).toBe(false);
        expect(store.has(`groupmembers#${g}`)).toBe(false);
        expect(store.has(`groupchat#${g}`)).toBe(false);
    });

    it("外せるのは作った人だけ。外された人は外されるまでの話だけ読めて、送れない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        expect((await api(B, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: C })).statusCode).toBe(403);
        await say(A, g, "外す前");
        expect((await api(A, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: C })).statusCode).toBe(200);
        await say(A, g, "外した後");
        const r = await read(C, g);
        expect(r.statusCode).toBe(200);
        expect(json(r).state).toBe("removed");
        expect(json(r).canSend).toBe(false);
        expect(texts(r)).toEqual(["外す前"]);
        expect((await say(C, g, "戻して")).statusCode).toBe(404);
        // 外された人を戻せるのは作った人だけ
        follow(B, C);
        const back = await api(B, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [C] });
        expect(json(back).added).toEqual([]);
    });
});

describe("🔴 5. 送信の上限", () => {
    const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    it("1日 300 通まで（今の DM と同じ数・同じ数え方）。超えたら 429 で書かない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        store.set(`dmday#${A}#${today()}`, { id: `dmday#${A}#${today()}`, groupSent: 299 });
        expect((await say(A, g, "300通目")).statusCode).toBe(200);
        const r = await say(A, g, "301通目");
        expect(r.statusCode).toBe(429);
        expect(json(r).code).toBe("dailyLimit");
        expect(texts(await read(A, g))).toEqual(["300通目"]);
        expect(store.get(`dmday#${A}#${today()}`)!.groupSent).toBe(300);
    });

    it("DM の送信数（`sent`）・旅行プランの会話（`tripSent`）とは別に数える", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        store.set(`dmday#${A}#${today()}`, { id: `dmday#${A}#${today()}`, sent: 300, tripSent: 300 });
        expect((await say(A, g, "グループでは送れる")).statusCode).toBe(200);
    });

    it("メンバーでない人の送信では数が進まない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await say(X, g, "まぜて");
        expect(store.get(`dmday#${X}#${today()}`)).toBeUndefined();
    });

    it("同じ id で送り直しても二重に入らず、数も進まない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        const body = { text: "一度だけ", id: "client-0001" };
        await api(A, "POST /groups/{groupId}/messages", { groupId: g }, body);
        await api(A, "POST /groups/{groupId}/messages", { groupId: g }, body);
        expect(texts(await read(A, g))).toEqual(["一度だけ"]);
        expect(store.get(`dmday#${A}#${today()}`)!.groupSent).toBe(1);
    });
});

describe("🔴 6. 招待の承諾前は中身が見えない", () => {
    it("入れる人をフォローしていない人は招待になり、参加するまで会話は 404、詳しいは名前・入れた人・人数だけ", async () => {
        mutual(A, B);
        follow(A, C);   // C は A をフォローしていない
        const g = await createBy(A, [B, C]);
        await say(A, g, "参加前の話");
        expect(mockPush.mock.calls.flatMap((c) => c[0] as string[])).not.toContain(`tok-${C}`);   // 招待では知らせない

        expect((await read(C, g)).statusCode).toBe(404);
        expect((await say(C, g, "まだ入っていない")).statusCode).toBe(404);
        const d = await api(C, "GET /groups/{groupId}", { groupId: g });
        expect(d.statusCode).toBe(200);
        const body = json(d);
        expect(body.state).toBe("invited");
        expect(body.invitedBy).toEqual({ id: A, name: "あお" });
        expect(body.group.memberCount).toBe(2);
        expect(body.members).toBeUndefined();
        expect(d.body).not.toContain("参加前の話");
        // 受信箱は招待の棚に出る（会話の抜粋は出さない）
        const box = json(await api(C, "GET /groups"));
        expect(box.groups).toEqual([]);
        expect(box.invites).toHaveLength(1);
        expect(JSON.stringify(box)).not.toContain("参加前の話");

        // 参加すると読める。ただし入る前の話は見えない
        expect((await api(C, "POST /groups/{groupId}/join", { groupId: g })).statusCode).toBe(200);
        await say(B, g, "参加後の話");
        const after = await read(C, g);
        expect(after.statusCode).toBe(200);
        expect(texts(after)).toEqual(["参加後の話"]);
    });

    it("断ると、同じグループからは招待し直せない", async () => {
        mutual(A, B);
        follow(A, C);
        const g = await createBy(A, [B, C]);
        expect((await api(C, "POST /groups/{groupId}/decline", { groupId: g })).statusCode).toBe(200);
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [C] });
        expect(json(r).invitedNow).toEqual([]);
        expect(json(r).notAdded).toBe(1);
        expect((await api(C, "POST /groups/{groupId}/join", { groupId: g })).statusCode).toBe(404);
    });

    it("親しい友達に入れている人からはそのまま入る", async () => {
        mutual(A, B);
        follow(A, C);
        store.set(`closefriends#${C}`, { id: `closefriends#${C}`, list: [A] });
        const g = await createBy(A, [B, C]);
        expect((await read(C, g)).statusCode).toBe(200);
    });
});

describe("🔴 7. 知らせの宛先", () => {
    it("ブロックの間柄の人・抜けた人・止めた人・自分には送らない。`sendPush` は1回で、束はグループの id", async () => {
        mutual(A, B); mutual(A, C); mutual(A, D); mutual(A, E);
        const g = await createBy(A, [B, C, D, E]);
        block(C, A);                                                              // C が A をブロック（入った後）
        await api(D, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: D });   // D は抜けた
        await api(E, "PUT /groups/{groupId}", { groupId: g }, { muted: true });            // E は知らせを止めた
        resetQuiet(g);
        mockPush.mockClear();

        expect((await say(A, g, "集合は9時")).statusCode).toBe(200);
        expect(mockPush).toHaveBeenCalledTimes(1);
        const [tokens, msg] = mockPush.mock.calls[0] as [string[], { title: string; body: string; threadId?: string; data?: Record<string, string> }];
        expect(tokens).toEqual([`tok-${B}`]);
        expect(msg.body).toBe("あお からメッセージが届きました");
        expect(msg.body).not.toContain("集合は9時");
        expect(msg.threadId).toBe(g);
        expect(msg.data).toEqual({ type: "group", groupId: g });
        expect(JSON.parse(pushPayload(msg as never)).aps["thread-id"]).toBe(g);
    });

    it("自分がブロックした人の通では、自分に知らせない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        block(B, C);   // B が C をブロック
        resetQuiet(g);
        mockPush.mockClear();
        await say(C, g, "こんにちは");
        const tokens = mockPush.mock.calls.flatMap((c) => c[0] as string[]);
        expect(tokens).toContain(`tok-${A}`);
        expect(tokens).not.toContain(`tok-${B}`);
        // 読んでも出ない（消してはいない）
        expect(texts(await read(B, g))).toEqual([]);
        expect(texts(await read(A, g))).toEqual(["こんにちは"]);
    });

    it("同じグループで3分以内は鳴らさない（受信箱の未読には入る）", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        resetQuiet(g);
        mockPush.mockClear();
        await say(A, g, "1通目");
        await say(A, g, "2通目");
        expect(mockPush).toHaveBeenCalledTimes(1);
        const box = json(await api(B, "GET /groups"));
        expect(box.groups[0].unread).toBeGreaterThanOrEqual(2);
        expect(box.groups[0].last.excerpt).toBe("2通目");
    });

    it("3分以内に自分で送った人には鳴らさない（その会話を見ているはず）", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await say(B, g, "いま見てる");
        resetQuiet(g);
        mockPush.mockClear();
        await say(A, g, "返事");
        const tokens = mockPush.mock.calls.flatMap((c) => c[0] as string[]);
        expect(tokens).toEqual([`tok-${C}`]);
    });
});

describe("名前・写真・通報・退会", () => {
    it("名前はメンバーなら誰でも変えられ、会話に1行残る。20字まで", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        const r = await api(B, "PUT /groups/{groupId}", { groupId: g }, { name: "金沢 秋の旅".padEnd(30, "!") });
        expect(r.statusCode).toBe(200);
        expect([...json(r).group.name as string]).toHaveLength(20);
        const evs = (json(await read(A, g)).messages as Array<{ event?: { type: string } }>).map((m) => m.event?.type);
        expect(evs).toContain("renamed");
    });

    it("🔴 写真は送る人に見せてよい写真だけ。読む人ごとに決め直し、見られない人には札を出さない", async () => {
        mutual(A, B); mutual(A, C);
        store.set("photo-1", { id: "photo-1", src: "https://cdn.example/a.jpg", thumbSrc: "https://cdn.example/a_t.jpg", userId: X });
        const g = await createBy(A, [B, C]);
        const r = await api(A, "POST /groups/{groupId}/messages", { groupId: g }, { photoId: "photo-1" });
        expect(r.statusCode).toBe(200);
        block(X, C);   // 写真の持ち主が C をブロック
        const forB = json(await read(B, g)).messages.find((m: { photo?: unknown }) => m.photo).photo;
        const forC = json(await read(C, g)).messages.find((m: { photo?: unknown }) => m.photo).photo;
        expect(forB).toMatchObject({ id: "photo-1", state: "live", src: "https://cdn.example/a_t.jpg" });
        expect(forC).toEqual({ id: "photo-1", state: "gone" });
        // 下書き（非公開）の写真は送れない
        store.set("photo-2", { id: "photo-2", src: "https://cdn.example/b.jpg", userId: A, published: false });
        expect((await api(A, "POST /groups/{groupId}/messages", { groupId: g }, { photoId: "photo-2" })).statusCode).toBe(404);
    });

    it("通報は直近の通の写しを残す。自分の通は通報できない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await say(B, g, "いやな言葉");
        const msg = (json(await read(A, g)).messages as Array<{ id: string; text?: string }>).find((m) => m.text === "いやな言葉")!;
        expect((await api(B, "POST /groups/{groupId}/report", { groupId: g }, { reason: "harassment", messageId: msg.id })).statusCode).toBe(400);
        expect((await api(A, "POST /groups/{groupId}/report", { groupId: g }, { reason: "harassment", messageId: msg.id })).statusCode).toBe(200);
        const copy = store.get(`groupreport#${g}#${A}`)!;
        expect(copy.reportedId).toBe(B);
        expect((copy.messages as Array<{ text?: string }>).map((m) => m.text)).toContain("いやな言葉");
    });

    it("退会: 入っていたグループから抜け、本人の通を外す（作った人なら次の人へ渡す）", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await say(A, g, "退会する人の通");
        await purgeGroupsFor(A);
        const d = json(await api(B, "GET /groups/{groupId}", { groupId: g }));
        expect(d.members.map((m: { id: string }) => m.id)).toEqual([B, C]);
        expect(d.isOwner).toBe(true);
        expect(JSON.stringify(json(await read(B, g)))).not.toContain(A);
    });
});
