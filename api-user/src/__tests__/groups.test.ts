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
const n2 = (id: string) => id.slice(-3);
/** 1日の歯止めの行の日付（`groups.ts` の `dayOf` と同じ JST） */
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
/** フォローを外す（`follower` が `target` を） */
const unfollow = (follower: string, target: string) => store.delete(`follow#${target}#${follower}`);
/**
 * `who` がいったん抜けてから、A が入れ直す。**招待が生まれるのはこの道だけ**（入れられるのは相互フォローの人だけで、
 * 相互フォローの人はそのまま入る。抜けた人・外された人を入れ直すときだけ、相互フォローでも招待になる）
 */
async function reinvite(g: string, who: string) {
    await api(who, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: who });
    const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [who] });
    expect(json(r).invitedNow, r.body).toEqual([who]);
}
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
        // 🔴 入った2人に「入れました」の知らせ。**`sendPush` は1回（接続1本）で2人の端末へ**。題は名前が無ければ「グループ」
        expect(mockPush).toHaveBeenCalledTimes(1);
        const [tokens, msg] = mockPush.mock.calls[0] as [string[], { title: string; body: string; threadId?: string }];
        expect(tokens.sort()).toEqual([`tok-${B}`, `tok-${C}`].sort());
        expect(msg).toMatchObject({ title: "グループ", body: "あお があなたをグループに入れました", threadId: body.group.groupId });
    });

    it("🔴 29人を入れて作っても、知らせは `sendPush` 1回（1人ずつ送ると関数の上限 15 秒を越える）", async () => {
        const many = Array.from({ length: 29 }, (_, n) => uid(0x200 + n));
        for (const id of many) {
            users.set(id, { userId: id, displayName: `人${n2(id)}` });
            store.set(`devices#${id}`, { id: `devices#${id}`, tokens: [`tok-${id}`] });
            mutual(A, id);
        }
        await api(A, "POST /groups", {}, { memberIds: many, name: "大人数" });
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect((mockPush.mock.calls[0][0] as string[]).length).toBe(29);
        expect((mockPush.mock.calls[0][1] as { title: string }).title).toBe("大人数");
    });

    it("🔴 片方だけのフォローの人しか選んでいなければ作れず、作る数も進まない（招待にもしない）", async () => {
        follow(A, B); follow(A, C);   // A は2人をフォローしているが、2人は A をフォローしていない
        const r = await api(A, "POST /groups", {}, { memberIds: [B, C] });
        expect(r.statusCode).toBe(404);
        expect(store.get(`dmday#${A}#${today()}`)?.groupNew).toBeUndefined();
        expect(store.get(`groupsjoined#${B}`)).toBeUndefined();
        expect(store.get(`groupsjoined#${C}`)).toBeUndefined();
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

    it("🔴 相互フォローでない人は、入れる人がフォローしていても入らず、招待にもならない（2026-11-20 owner）", async () => {
        mutual(A, B);
        follow(A, C);   // A は C をフォローしているが、C は A をフォローしていない
        const r = await api(A, "POST /groups", {}, { memberIds: [B, C] });
        expect(r.statusCode).toBe(201);
        expect(json(r).members.map((m: { id: string }) => m.id)).toEqual([A, B]);
        expect(json(r).invited).toEqual([]);
        expect(json(r).notAdded).toBe(1);
        expect(json(await api(C, "GET /groups")).invites).toEqual([]);
        expect(mockPush.mock.calls.flatMap((c) => c[0] as string[])).not.toContain(`tok-${C}`);
    });

    it("🔴 親しい友達に入れていても、相互フォローでなければ入らない", async () => {
        mutual(A, B);
        follow(A, C);
        store.set(`closefriends#${C}`, { id: `closefriends#${C}`, list: [A] });
        const r = await api(A, "POST /groups", {}, { memberIds: [B, C] });
        expect(json(r).members.map((m: { id: string }) => m.id)).toEqual([A, B]);
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
        await expect(read(D, g).then((x) => x.statusCode)).resolves.toBe(404);
    });

    it("招待に参加するとき: 招待のあとにブロックの間柄になったら入れない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await reinvite(g, C);
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
        mutual(A, C);
        const g = await createBy(A, [...many.slice(0, 28), C]);   // 30 人
        await reinvite(g, C);   // C が抜けて 29 人 → 入れ直すと招待（30 人目の席を使う）
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
        // 🔴 外された人を戻せるのは作った人だけ（作った人でない人からは、招待にもならない）
        mutual(B, C);
        const back = await api(B, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [C] });
        expect(json(back).added).toEqual([]);
        expect(json(back).invitedNow).toEqual([]);
        expect(json(back).notAdded).toBe(1);
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
    it("抜けた人を入れ直すと招待になり、参加するまで会話は 404、詳しいは名前・入れた人・人数だけ", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        mockPush.mockClear();
        await reinvite(g, C);
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
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await reinvite(g, C);
        expect((await api(C, "POST /groups/{groupId}/decline", { groupId: g })).statusCode).toBe(200);
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [C] });
        expect(json(r).invitedNow).toEqual([]);
        expect(json(r).notAdded).toBe(1);
        expect((await api(C, "POST /groups/{groupId}/join", { groupId: g })).statusCode).toBe(404);
    });

    it("🔴 参加するとき、招待した人と今も相互フォローかを確かめ直す（外れていれば 403 `notMutualFollow`・招待は残る）", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await reinvite(g, C);
        unfollow(C, A);   // 招待のあとに C が A のフォローを外した
        const r = await api(C, "POST /groups/{groupId}/join", { groupId: g });
        expect(r.statusCode).toBe(403);
        expect(json(r).code).toBe("notMutualFollow");
        expect((await read(C, g)).statusCode).toBe(404);
        expect((store.get(`groupmembers#${g}`)!.members as Array<{ id: string }>).map((m) => m.id)).not.toContain(C);
        expect(json(await api(C, "GET /groups")).invites).toHaveLength(1);
        // 招待した側（A）が外した場合も同じ
        follow(C, A);
        unfollow(A, C);
        expect(json(await api(C, "POST /groups/{groupId}/join", { groupId: g })).code).toBe("notMutualFollow");
        // 相互フォローに戻れば、残っている招待からそのまま参加できる
        follow(A, C);
        expect((await api(C, "POST /groups/{groupId}/join", { groupId: g })).statusCode).toBe(200);
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

describe("確かめ役の指摘（2026-11-20）", () => {
    /** A が B・C と作り、名前「金沢」を付け、C を外す。外したあとに名前を変え、話を続ける */
    async function removedC() {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C], "金沢");
        await say(B, g, "外す前のBの話");
        await api(A, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: C });
        await api(A, "PUT /groups/{groupId}", { groupId: g }, { name: "外したあとの名前" });
        await say(A, g, "外したあとの話");
        return g;
    }

    it("🔴 1. 外された人の受信箱に、外されたあとの話・今の名前・顔・人数を出さない。未読は0", async () => {
        const g = await removedC();
        const box = json(await api(C, "GET /groups"));
        const row = box.groups.find((x: { groupId: string }) => x.groupId === g);
        expect(row).toMatchObject({ state: "removed", unread: 0, name: "金沢", displayName: "金沢", faces: [] });
        expect(row.last).toBeUndefined();
        expect(row.memberCount).toBeUndefined();
        const raw = JSON.stringify(box);
        expect(raw).not.toContain("外したあと");
        expect(raw).not.toContain(B);
    });

    it("🔴 7. 外された人の詳しいと会話に、今の名前・人数・メンバーを返さない（見える範囲の通の送り手だけ）", async () => {
        const g = await removedC();
        const d = await api(C, "GET /groups/{groupId}", { groupId: g });
        expect(json(d)).toEqual({ state: "removed", group: { groupId: g, name: "金沢", displayName: "金沢", faces: [] } });
        const m = json(await read(C, g));
        expect(m.members.map((x: { id: string }) => x.id).sort()).toEqual([A, B].sort());   // A は「作った」の1行・B は話の送り手
        const chat = json(await read(A, g));
        expect(m.seq).toBeLessThan(chat.seq);
        expect(JSON.stringify(m)).not.toContain("外したあと");
        // 送り手でない人（D）は、外したあとに入っても出ない
        mutual(A, D);
        await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [D] });
        expect(JSON.stringify(json(await read(C, g)).members)).not.toContain(D);
    });

    it("🔴 2. 退会した人の通が受信箱の最後の1通だったら、残った会話の最後の1通で作り直す", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await say(A, g, "Aの話");
        await say(B, g, "退会する人の最後の話");
        await purgeGroupsFor(B);
        const row = store.get(`group#${g}`)!;
        expect((row.last as { from: string; excerpt: string })).toMatchObject({ from: A, excerpt: "Aの話" });
        expect(JSON.stringify(row)).not.toContain(B);
        expect(JSON.stringify(json(await api(C, "GET /groups")))).not.toContain("退会する人");
    });

    it("2. 退会した人を指す「足した」の1行も会話から消す", async () => {
        mutual(A, B); mutual(A, C); mutual(A, D);
        const g = await createBy(A, [B, C]);
        await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [D] });
        expect(JSON.stringify(store.get(`groupchat#${g}`))).toContain(D);
        await purgeGroupsFor(D);
        expect(JSON.stringify(store.get(`groupchat#${g}`))).not.toContain(D);
        // 誰も指さなくなった「足した」の1行は残さない
        const evs = (json(await read(A, g)).messages as Array<{ event?: { type: string } }>).map((m) => m.event?.type).filter(Boolean);
        expect(evs).not.toContain("added");
        expect(JSON.stringify(store.get(`group#${g}`))).not.toContain(D);
    });

    it("🔴 4. 抜けた人は、入れ直しても招待になる（知らせは鳴らない・会話は見えない・1日 20 人の数に入る）", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await api(B, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: B });
        mockPush.mockClear();
        const before = (store.get(`dmday#${A}#${today()}`)?.newConv as number | undefined) ?? 0;
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [B] });
        expect(json(r).added).toEqual([]);
        expect(json(r).invitedNow).toEqual([B]);
        expect(mockPush).not.toHaveBeenCalled();
        expect((await read(B, g)).statusCode).toBe(404);
        expect(store.get(`dmday#${A}#${today()}`)!.newConv).toBe(before + 1);
        // 断ったら、もう招待し直せない
        await api(B, "POST /groups/{groupId}/decline", { groupId: g });
        const again = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [B] });
        expect(json(again).invitedNow).toEqual([]);
        expect(json(again).notAdded).toBe(1);
    });

    it("🔴 4. 外された人を作った人が戻すときも招待になる。参加すると、戻ってからの話だけ見える", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await api(A, "DELETE /groups/{groupId}/members/{uid}", { groupId: g, uid: C });
        await say(A, g, "いない間の話");
        mockPush.mockClear();
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [C] });
        expect(json(r).invitedNow).toEqual([C]);
        expect(json(r).added).toEqual([]);
        expect(mockPush).not.toHaveBeenCalled();
        // 招待の棚に出て、外されたグループの行は受信箱から外れる
        const box = json(await api(C, "GET /groups"));
        expect(box.invites.map((x: { groupId: string }) => x.groupId)).toEqual([g]);
        expect(box.groups).toEqual([]);
        expect((await api(C, "POST /groups/{groupId}/join", { groupId: g })).statusCode).toBe(200);
        await say(A, g, "戻ってからの話");
        expect(texts(await read(C, g))).toEqual(["戻ってからの話"]);
        expect(store.get(`groupmembers#${g}`)!.removed).toEqual([]);
    });

    it("5. 他の人の通と同じ id で送っても、他人の通を返さず、自分の通として足す", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await api(B, "POST /groups/{groupId}/messages", { groupId: g }, { text: "Bの通", id: "same-id-0001" });
        const r = await api(A, "POST /groups/{groupId}/messages", { groupId: g }, { text: "Aの通", id: "same-id-0001" });
        expect(r.statusCode).toBe(200);
        expect(json(r).message).toMatchObject({ text: "Aの通", mine: true, from: A });
        expect(texts(await read(C, g))).toEqual(["Bの通", "Aの通"]);
        const ids = (json(await read(C, g)).messages as Array<{ id: string }>).map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("同じ id を同時に2回送っても、1通だけ入り、数は1だけ進む", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        const body = { text: "同時", id: "client-same-1" };
        await Promise.all([
            api(A, "POST /groups/{groupId}/messages", { groupId: g }, body),
            api(A, "POST /groups/{groupId}/messages", { groupId: g }, body),
        ]);
        expect(texts(await read(A, g))).toEqual(["同時"]);
        expect(store.get(`dmday#${A}#${today()}`)!.groupSent).toBe(1);
    });

    it("🔴 6. 名前の変更は送る 1日 300 通に1通として数える。超えたら 429 で変わらない。同じ名前なら数えない", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C], "はじめ");
        await api(B, "PUT /groups/{groupId}", { groupId: g }, { name: "はじめ" });
        expect(store.get(`dmday#${B}#${today()}`)?.groupSent ?? 0).toBe(0);
        await api(B, "PUT /groups/{groupId}", { groupId: g }, { name: "つぎ" });
        expect(store.get(`dmday#${B}#${today()}`)!.groupSent).toBe(1);
        store.set(`dmday#${B}#${today()}`, { id: `dmday#${B}#${today()}`, groupSent: 300 });
        const r = await api(B, "PUT /groups/{groupId}", { groupId: g }, { name: "あらし", muted: true });
        expect(r.statusCode).toBe(429);
        expect(json(r).code).toBe("dailyLimit");
        const d = json(await api(A, "GET /groups/{groupId}", { groupId: g }));
        expect(d.group.name).toBe("つぎ");
        // 429 のときは知らせの設定も書かない
        expect((store.get(`groupmembers#${g}`)!.members as Array<{ id: string; muted?: boolean }>).find((m) => m.id === B)!.muted).toBeUndefined();
    });

    it("空き席は門を通った人の数で見る（通らない人が混じっても、通る人は入る）", async () => {
        const many = Array.from({ length: 28 }, (_, n) => uid(0x300 + n));
        for (const id of many) { users.set(id, { userId: id, displayName: `人${n2(id)}` }); mutual(A, id); }
        const g = await createBy(A, many);   // 29 人
        mutual(A, D);                         // D は入れる。X は A がフォローしていないので通らない
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [X, D] });
        expect(r.statusCode).toBe(200);
        expect(json(r).added).toEqual([D]);
        expect(json(r).notAdded).toBe(1);
    });

    it("参加するときも 50 の枠を見る（書くときに確かめる）", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        await reinvite(g, C);
        const list = Array.from({ length: 50 }, (_, n) => `${(0x400 + n).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);
        store.set(`groupsjoined#${C}`, { ...store.get(`groupsjoined#${C}`)!, list });
        const r = await api(C, "POST /groups/{groupId}/join", { groupId: g });
        expect(r.statusCode).toBe(403);
        expect((store.get(`groupmembers#${g}`)!.members as Array<{ id: string }>).map((m) => m.id)).not.toContain(C);
    });

    it("あとから足された人は、足されたあとの話から見える（入る前の話は見えない）", async () => {
        mutual(A, B); mutual(A, C); mutual(A, D);
        const g = await createBy(A, [B, C]);
        await say(A, g, "Dが入る前");
        await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [D] });
        await say(B, g, "Dが入った後");
        const r = json(await read(D, g));
        expect(texts({ statusCode: 200, body: JSON.stringify(r) })).toEqual(["Dが入った後"]);
        expect((r.messages as Array<{ event?: { type: string } }>).map((m) => m.event?.type)).toContain("added");
        const m = (store.get(`groupmembers#${g}`)!.members as Array<{ id: string; from: number }>).find((x) => x.id === D)!;
        expect(m.from).toBeLessThan(1000);
    });

    it("5. 会話の追記でも、他の人の通と同じ id は送り直しと取り違えない（新しい id で足す）", async () => {
        const { appendGroupChat, draftText, readGroupChat } = await import("../groupChat");
        const g = "11111111-2222-4333-8444-555555555555";
        await appendGroupChat(g, [draftText(B, "Bの通", undefined, "clash-id-0001")]);
        const r = await appendGroupChat(g, [draftText(A, "Aの通", undefined, "clash-id-0001")]);
        expect(r.duplicate).toBe(false);
        expect(r.messages[0]).toMatchObject({ from: A, text: "Aの通" });
        expect(r.messages[0].id).not.toBe("clash-id-0001");
        expect((await readGroupChat(g)).items.map((m) => m.text)).toEqual(["Bの通", "Aの通"]);
        // 自分の送り直しは、今までどおり1通のまま
        const again = await appendGroupChat(g, [draftText(B, "Bの通", undefined, "clash-id-0001")]);
        expect(again.duplicate).toBe(true);
    });
});

describe("🔴 相互フォローだけ（2026-11-20 owner「相互フォローじゃないと話せない方がいい」）", () => {
    it("人を足すとき: 相互フォローの人はそのまま入り、片方だけのフォローの人は招待にもならない", async () => {
        mutual(A, B); mutual(A, C); mutual(A, D);
        follow(A, E);   // A → E だけ
        follow(X, A);   // X → A だけ
        const g = await createBy(A, [B, C]);
        const r = await api(A, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [D, E, X] });
        expect(r.statusCode).toBe(200);
        expect(json(r).added).toEqual([D]);
        expect(json(r).invitedNow).toEqual([]);
        expect(json(r).notAdded).toBe(2);
        expect(json(await api(E, "GET /groups")).invites).toEqual([]);
        expect(json(await api(X, "GET /groups")).invites).toEqual([]);
    });

    it("相互フォローかは、足す人との間で見る（作った人と相互でも、足す人と相互でなければ入らない）", async () => {
        mutual(A, B); mutual(A, C); mutual(A, D);
        follow(B, D);   // B → D だけ（D は B をフォローしていない）
        const g = await createBy(A, [B, C]);
        const r = await api(B, "POST /groups/{groupId}/members", { groupId: g }, { userIds: [D] });
        expect(json(r).added).toEqual([]);
        expect(json(r).notAdded).toBe(1);
    });

    it("入ったあとにフォローを外しても、メンバーからは外さない（読める・送れる）", async () => {
        mutual(A, B); mutual(A, C);
        const g = await createBy(A, [B, C]);
        unfollow(B, A); unfollow(A, B);
        expect((await say(B, g, "まだいる")).statusCode).toBe(200);
        expect(texts(await read(A, g))).toEqual(["まだいる"]);
        expect(json(await api(A, "GET /groups/{groupId}", { groupId: g })).members.map((m: { id: string }) => m.id)).toContain(B);
    });
});
