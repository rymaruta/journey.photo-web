import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handler, purgeGroupsFor } from "../groups";
import { resetDeletedUsersCache } from "../notify";

/**
 * グループの会話（みんなで話す DM・最大30人。2026-11-12・札 journey.photo-ios#582・`groups.ts`・`groupChat.ts`）。
 *
 * ここで縛ること（権限の抜けを先に）:
 *  1. **入っていない人は読めない・書けない**（グループの有無も教えない＝404）。招待中の人もメッセージは読めない
 *  2. **外された人は送れない**（外されるまでの話だけ読める）。外せるのは作った人だけ
 *  3. **ブロックの間柄の人は入れられない**（入れる人とも、メンバーの誰かとも）。参加のときも同じ
 *  4. **上限を越えない**（30人・1回29人・招待の棚20・入れるグループ50・1日の作る数と人を足す数）
 *  5. フォローしていない人は入れられない。相手が自分をフォローしていなければ招待（リクエスト）になり、知らせない
 *  6. 知らせは相手全員の端末をまとめて **sendPush 1回**。本文を載せない。3分に1回まで。自分が送ってから3分は自分に知らせない。
 *     知らせを止めた人には送らない
 *  7. 入る前の話は見えない。未読は通し番号で数え、取り消した通は数えない
 *
 * DynamoDB は手元の表（`store`）で真似る（`tripShare.test.ts` と同じ形）
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
const mockPush = vi.hoisted(() => vi.fn<(tokens: string[], msg: unknown) => Promise<{ sent: number; invalid: string[] }>>(async () => ({ sent: 1, invalid: [] })));
vi.mock("../apns", async (orig) => ({
    ...(await orig<typeof import("../apns")>()),
    apnsConfigured: () => true,
    sendPush: mockPush,
}));

/**
 * 書く前に一度だけ割り込む（同時の書き込みを真似る）。`true` を返したら使い終わり。
 * 例: 事前の確かめのあとで枠が埋まる場面（行を書き換えて `rev` を進めると、書き込みの条件が外れて読み直す）
 */
const hooks: Array<(name: string, input: Record<string, unknown>) => boolean> = [];
/** 試験で実際に送った命令（最後の試験が、スタックの権限と突き合わせる） */
const seen: Array<{ name: string; input: Record<string, unknown> }> = [];
/** 行を書き換えて rev を進める（同時に別の人が書いた） */
const bump = (id: string, patch: (cur: Row) => Row) => {
    const cur = store.get(id) ?? { id };
    store.set(id, { ...patch(cur), id, rev: ((cur.rev as number | undefined) ?? 0) + 1 });
};

function fakeSend(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    const name = cmd.constructor.name;
    seen.push({ name, input: cmd.input });
    for (let k = 0; k < hooks.length; k++) if (hooks[k](name, cmd.input)) { hooks.splice(k, 1); break; }
    const i = cmd.input as {
        TableName?: string; Key?: { id?: string; userId?: string }; Item?: Row; ConditionExpression?: string; UpdateExpression?: string;
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
        const id = i.Key?.id ?? "";
        if (id.startsWith("dmday#")) {
            const cur = store.get(id) ?? { id };
            const vals = i.ExpressionAttributeValues ?? {};
            const field = /ADD (\w+) :one/.exec(i.UpdateExpression ?? "")![1];
            const max = vals[":maxGroup"] as number;
            if (typeof cur[field] === "number" && (cur[field] as number) >= max) throw condFail();
            store.set(id, { ...cur, [field]: ((cur[field] as number | undefined) ?? 0) + 1 });
        }
        return {};
    }
    throw new Error(`知らない命令 ${name}`);
}


const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const E = "eeeeeeee-0000-4000-8000-000000000005";
const G = "11111111-2222-4333-8444-555555555555";

type Res = { statusCode: number; body: string };
const ev = (sub: string, routeKey: string, path: Record<string, string> = {}, body?: unknown, query?: Record<string, string>) =>
    ({
        routeKey,
        requestContext: { authorizer: { jwt: { claims: { sub } } }, http: { method: routeKey.split(" ")[0] } },
        pathParameters: path,
        ...(query ? { queryStringParameters: query } : {}),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }) as never;
const call = async (e: unknown) => (await (handler as unknown as (e: unknown, c: unknown, cb: unknown) => Promise<Res>)(e, {}, () => undefined));
const json = (r: Res) => JSON.parse(r.body);
const api = (sub: string, routeKey: string, path: Record<string, string> = {}, body?: unknown, query?: Record<string, string>) =>
    call(ev(sub, routeKey, { gid: G, ...path }, body ?? (routeKey.startsWith("GET") || routeKey.startsWith("DELETE") ? undefined : {}), query));

/** follower が target をフォローしている */
function follow(follower: string, target: string) {
    store.set(`follow#${target}#${follower}`, { id: `follow#${target}#${follower}` });
}
function block(blocker: string, blocked: string) {
    store.set(`block#${blocker}#${blocked}`, { id: `block#${blocker}#${blocked}` });
    const mine = store.get(`blocks#${blocker}`)?.blockedIds as string[] | undefined;
    store.set(`blocks#${blocker}`, { id: `blocks#${blocker}`, blockedIds: [...(mine ?? []), blocked] });
    const theirs = store.get(`blockedby#${blocked}`)?.blockerIds as string[] | undefined;
    store.set(`blockedby#${blocked}`, { id: `blockedby#${blocked}`, blockerIds: [...(theirs ?? []), blocker] });
}
const devices = (uid: string, ...tokens: string[]) => store.set(`devices#${uid}`, { id: `devices#${uid}`, tokens });
const members = () => ((store.get(`groupmembers#${G}`)?.members ?? []) as Array<{ id: string }>).map((m) => m.id);
const invited = () => ((store.get(`groupmembers#${G}`)?.invited ?? []) as Array<{ id: string }>).map((m) => m.id);
const entry = (uid: string) => ((store.get(`groupsjoined#${uid}`)?.groups ?? {}) as Record<string, { state: string }>)[G];
const pushedTokens = () => mockPush.mock.calls.map((c) => [...(c[0] as string[])].sort());
const say = (sub: string, text: string, id?: string) => api(sub, "POST /groups/{gid}/messages", {}, { text, ...(id ? { id } : {}) });
const read = async (sub: string) => json(await api(sub, "GET /groups/{gid}/messages")) as { messages: Array<{ text?: string; from: string; event?: { type: string } }> };
const inbox = async (sub: string) => json(await api(sub, "GET /groups")).groups as Array<Record<string, unknown>>;

/** A が B（A をフォローし返している＝そのまま入る）と C（A をフォローしていない＝招待）でグループを作る */
async function seedGroup(extra: string[] = []) {
    for (const x of [B, C, ...extra]) follow(A, x);
    follow(B, A);
    const r = await api(A, "POST /groups", {}, { id: G, userIds: [B, C, ...extra] });
    expect(r.statusCode).toBe(200);
    mockPush.mockClear();
    return r;
}

let clock = Date.parse("2026-11-12T03:00:00.000Z");
const tick = (ms: number) => { clock += ms; vi.setSystemTime(clock); };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    clock = Date.parse("2026-11-12T03:00:00.000Z");
    vi.setSystemTime(clock);
    store.clear();
    users.clear();
    resetDeletedUsersCache();
    for (const [id, name] of [[A, "ゆう"], [B, "けん"], [C, "みお"], [D, "そら"], [E, "はな"]]) users.set(id, { userId: id, displayName: name });
    for (const u of [A, B, C, D, E]) devices(u, `tok-${u}`);
    mockSend.mockReset();
    mockSend.mockImplementation(async (cmd) => fakeSend(cmd));
    mockPush.mockClear();
    hooks.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe("作る（POST /groups）", () => {
    it("フォローし返している人はそのまま入り、そうでない人は招待（リクエスト）になる。知らせはそのまま入った人だけ", async () => {
        for (const x of [B, C]) follow(A, x);
        follow(B, A);
        const r = await api(A, "POST /groups", {}, { id: G, userIds: [B, C] });
        expect(r.statusCode).toBe(200);
        expect(members()).toEqual([A, B]);
        expect(invited()).toEqual([C]);
        expect(entry(B)).toMatchObject({ state: "member" });
        expect(entry(C)).toMatchObject({ state: "invited", by: A });
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(pushedTokens()).toEqual([[`tok-${B}`]]);
        expect(JSON.stringify(mockPush.mock.calls[0][1])).toContain("ゆうがグループを作りました。");
        // 🔴 行に `userId` を持たせない（`userId-createdAt-index` に載る）
        for (const k of [`group#${G}`, `groupmembers#${G}`, `groupchat#${G}`]) expect(store.get(k)).not.toHaveProperty("userId");
        // 押し直しでもう1つ作らない
        expect((await api(A, "POST /groups", {}, { id: G, userIds: [B, C] })).statusCode).toBe(200);
        expect(members()).toEqual([A, B]);
    });

    it("2人から29人まで（1人だけ・30人は 400）", async () => {
        expect((await api(A, "POST /groups", {}, { userIds: [B] })).statusCode).toBe(400);
        const many = Array.from({ length: 30 }, (_, k) => `${String(k).padStart(8, "0")}-0000-4000-8000-000000000000`);
        expect((await api(A, "POST /groups", {}, { userIds: many })).statusCode).toBe(400);
        expect([...store.keys()].some((k) => k.startsWith("group"))).toBe(false);
    });

    it("🔴 フォローしていない人は入れられない（誰も入れられなければ作らない）", async () => {
        const r = await api(A, "POST /groups", {}, { id: G, userIds: [B, C] });
        expect(r.statusCode).toBe(409);
        expect(store.has(`groupmembers#${G}`)).toBe(false);
        expect(entry(B)).toBeUndefined();
    });

    it("🔴 ブロックの間柄の人は入れられない（入れる人と・どちら向きでも。メンバー同士でも）", async () => {
        for (const [x, y] of [[A, B], [B, A]]) {
            store.clear();
            for (const u of [B, C, D]) follow(A, u);
            block(x, y);
            const r = await api(A, "POST /groups", {}, { id: G, userIds: [B, C, D] });
            expect(r.statusCode).toBe(200);
            expect([...members(), ...invited()]).not.toContain(B);
            expect(entry(B)).toBeUndefined();
            expect(json(r).skipped).toBe(1);
        }
        // C が D をブロックしている: 先に入った C と間柄なので D は入らない
        store.clear();
        for (const u of [C, D]) follow(A, u);
        block(C, D);
        await api(A, "POST /groups", {}, { id: G, userIds: [C, D] });
        expect([...members(), ...invited()]).toEqual([A, C]);
    });

    it("🔴 受け取る側の招待の棚（20）・入れるグループ（50）が埋まっていれば入れない", async () => {
        for (const x of [B, C]) follow(A, x);
        follow(B, A);
        const full = (state: string) => Object.fromEntries(Array.from({ length: state === "member" ? 50 : 20 }, (_, k) =>
            [`${String(k).padStart(8, "0")}-1111-4111-8111-111111111111`, { state, at: new Date(clock).toISOString() }]));
        store.set(`groupsjoined#${B}`, { id: `groupsjoined#${B}`, rev: 1, groups: full("member") });
        store.set(`groupsjoined#${C}`, { id: `groupsjoined#${C}`, rev: 1, groups: full("invited") });
        expect((await api(A, "POST /groups", {}, { id: G, userIds: [B, C] })).statusCode).toBe(409);
        expect(store.has(`groupmembers#${G}`)).toBe(false);
    });

    it("🔴 1日に作れるのは10まで・リクエストに入る招待は1日20人まで", async () => {
        for (const x of [B, C]) follow(A, x);
        for (let k = 0; k < 10; k++) {
            const gid = `${String(k).padStart(8, "0")}-2222-4222-8222-222222222222`;
            expect((await api(A, "POST /groups", { gid }, { id: gid, userIds: [B, C] })).statusCode).toBe(200);
        }
        // 招待（C・B とも A をフォローしていない）は10回で20人。次はどちらの上限でも止まる
        const r = await api(A, "POST /groups", {}, { userIds: [B, C] });
        expect(r.statusCode).toBe(429);
        expect(json(r).code).toBe("dailyLimit");
    });
});

describe("🔴 入っていない人・招待中の人・外された人", () => {
    it("入っていない人は中身も会話も読めず、送れず、人も足せない（グループの有無も教えない）", async () => {
        await seedGroup();
        await say(A, "こんにちは");
        for (const route of ["GET /groups/{gid}", "GET /groups/{gid}/messages"]) {
            expect((await api(D, route)).statusCode).toBe(404);
        }
        expect((await say(D, "入れて")).statusCode).toBe(404);
        expect((await api(D, "POST /groups/{gid}/members", {}, { userIds: [E] })).statusCode).toBe(404);
        expect((await api(D, "PUT /groups/{gid}", {}, { name: "乗っ取り" })).statusCode).toBe(404);
        expect((await api(D, "POST /groups/{gid}/report", {}, { reason: "spam" })).statusCode).toBe(404);
        expect((await api(D, "DELETE /groups/{gid}/members/{uid}", { uid: B })).statusCode).toBe(404);
        expect(members()).toEqual([A, B]);
        expect((await inbox(D))).toEqual([]);
    });

    it("招待中の人はメッセージを読めない・送れない。見えるのは名前・招いた人・メンバーの名前だけ", async () => {
        await seedGroup();
        await say(A, "ひみつの話");
        expect((await api(C, "GET /groups/{gid}/messages")).statusCode).toBe(404);
        expect((await say(C, "まだ入っていない")).statusCode).toBe(404);
        const d = json(await api(C, "GET /groups/{gid}"));
        expect(d.group.state).toBe("invited");
        expect(d.invitedBy).toMatchObject({ id: A, name: "ゆう" });
        expect(d.members.map((m: { name: string }) => m.name)).toEqual(["ゆう", "けん"]);
        expect(JSON.stringify(d)).not.toContain("ひみつの話");
        const box = await inbox(C);
        expect(box).toHaveLength(1);
        expect(box[0]).toMatchObject({ state: "invited", unread: 0 });
        expect(box[0]).not.toHaveProperty("last");
    });

    it("🔴 外された人は送れない。外されるまでの話は読め、後の話は見えない。外せるのは作った人だけ", async () => {
        follow(D, A);
        await seedGroup([D]);
        expect(members()).toEqual([A, B, D]);
        expect((await api(B, "DELETE /groups/{gid}/members/{uid}", { uid: D })).statusCode).toBe(403);
        await say(A, "前の話");
        tick(1000);
        expect((await api(A, "DELETE /groups/{gid}/members/{uid}", { uid: D })).statusCode).toBe(200);
        tick(1000);
        await say(A, "後の話");
        expect(members()).toEqual([A, B]);
        expect(entry(D)).toMatchObject({ state: "removed" });
        const r = await say(D, "まだ送れる？");
        expect(r.statusCode).toBe(404);
        const texts = (await read(D)).messages.map((m) => m.text).filter(Boolean);
        expect(texts).toEqual(["前の話"]);
        // 外された人は人を足せない・名前も変えられない
        expect((await api(D, "POST /groups/{gid}/members", {}, { userIds: [E] })).statusCode).toBe(404);
        expect((await api(D, "PUT /groups/{gid}", {}, { name: "x" })).statusCode).toBe(404);
        // 招待のリンクの代わりに自分で戻ることはできない（作った人以外が入れても入らない）
        follow(B, D); follow(D, B);
        const back = json(await api(B, "POST /groups/{gid}/members", {}, { userIds: [D] }));
        expect(back.added).toEqual([]);
        expect(members()).not.toContain(D);
        // 作った人が入れ直すと戻る
        await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] });
        expect(members()).toContain(D);
        // 外された行は自分で消せる（戻った後は使わないが、消す口は自分だけ）
    });

    it("外された人は受信箱の「外れました」の行を自分で消せる", async () => {
        await seedGroup();
        await api(A, "DELETE /groups/{gid}/members/{uid}", { uid: B });
        expect((await inbox(B))[0]).toMatchObject({ state: "removed" });
        expect((await api(B, "DELETE /groups/{gid}/members/{uid}", { uid: B })).statusCode).toBe(200);
        expect(await inbox(B)).toEqual([]);
    });
});

describe("参加・断る", () => {
    it("参加すると入る前の話は見えず、会話に「参加しました」の1行。知らせは送らない", async () => {
        await seedGroup();
        await say(A, "入る前の話");
        tick(1000);
        mockPush.mockClear();
        const r = await api(C, "POST /groups/{gid}/join");
        expect(r.statusCode).toBe(200);
        expect(members()).toEqual([A, B, C]);
        expect(invited()).toEqual([]);
        expect(mockPush).not.toHaveBeenCalled();
        const msgs = (await read(C)).messages;
        expect(msgs.map((m) => m.text).filter(Boolean)).toEqual([]);
        expect(msgs.map((m) => m.event?.type)).toEqual(["joined"]);
        // ほかの人には「参加しました」が見える
        expect((await read(A)).messages.map((m) => m.event?.type).filter(Boolean)).toEqual(["created", "joined"]);
    });

    it("🔴 メンバーの誰かとブロックの間柄なら参加させない（理由は言わない）", async () => {
        await seedGroup();
        block(B, C);
        expect((await api(C, "POST /groups/{gid}/join")).statusCode).toBe(404);
        expect(members()).toEqual([A, B]);
    });

    it("🔴 断ると、そのグループには誰も招待し直せない。断ったことは知らせない", async () => {
        await seedGroup();
        expect((await api(C, "DELETE /groups/{gid}/invite")).statusCode).toBe(200);
        expect(invited()).toEqual([]);
        expect(entry(C)).toBeUndefined();
        expect(mockPush).not.toHaveBeenCalled();
        follow(B, C);
        const r = json(await api(B, "POST /groups/{gid}/members", {}, { userIds: [C] }));
        expect(r).toMatchObject({ added: [], invited: [] });
        expect(invited()).toEqual([]);
        // 断った人が後から B をフォローしても（そのまま入る形でも）入らない
        follow(C, B);
        expect(json(await api(B, "POST /groups/{gid}/members", {}, { userIds: [C] }))).toMatchObject({ added: [] });
        expect(members()).not.toContain(C);
        // 招待されていない人が「参加」しても入れない
        expect((await api(C, "POST /groups/{gid}/join")).statusCode).toBe(404);
        expect((await api(D, "POST /groups/{gid}/join")).statusCode).toBe(404);
        expect(members()).toEqual([A, B]);
    });

    it("返事の無い招待は30日で外れ、参加できない", async () => {
        await seedGroup();
        tick(31 * 24 * 3600 * 1000);
        expect((await api(C, "POST /groups/{gid}/join")).statusCode).toBe(404);
        expect(await inbox(C)).toEqual([]);
    });
});

describe("🔴 人数の上限（30人・招待中も数える）", () => {
    it("30人に達していたら足せない（1人でも越えるなら書かない）", async () => {
        await seedGroup();
        // 招待中の C を入れて 3 席。27人ぶんの招待を置いて 30 席にする
        const filler = Array.from({ length: 27 }, (_, k) => ({ id: `${String(k).padStart(8, "0")}-3333-4333-8333-333333333333`, by: A, at: new Date(clock).toISOString() }));
        const m = store.get(`groupmembers#${G}`)!;
        store.set(`groupmembers#${G}`, { ...m, invited: [...(m.invited as unknown[]), ...filler] });
        follow(A, D);
        const r = await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] });
        expect(r.statusCode).toBe(403);
        expect(json(r).code).toBe("groupFull");
        expect(invited()).not.toContain(D);
    });
});

describe("送る・読む・未読", () => {
    it("相手の受信箱に未読が付き、読むと 0。自分の通は未読にしない。抜粋に本文", async () => {
        await seedGroup();
        await say(A, "京都いつにする？");
        const b = await inbox(B);
        expect(b[0]).toMatchObject({ state: "member", unread: 1, title: "ゆう" });
        expect((b[0].last as { excerpt: string }).excerpt).toBe("京都いつにする？");
        expect((await inbox(A))[0]).toMatchObject({ unread: 0 });
        await read(B);
        expect((await inbox(B))[0]).toMatchObject({ unread: 0 });
    });

    it("同じ id の押し直しで二重に入れない", async () => {
        await seedGroup();
        await say(A, "1回だけ", "msg-00000001");
        await say(A, "1回だけ", "msg-00000001");
        expect((await read(B)).messages.filter((m) => m.text === "1回だけ")).toHaveLength(1);
    });

    it("ブロックの間柄の人の通は、見る人の画面と抜粋から外す（消さない）", async () => {
        await seedGroup();
        follow(A, D); follow(D, A);
        await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] });
        block(B, D);
        await say(D, "けんには見えない");
        expect((await read(B)).messages.map((m) => m.text)).not.toContain("けんには見えない");
        expect((await inbox(B))[0]).not.toHaveProperty("last");
        expect((await read(A)).messages.map((m) => m.text)).toContain("けんには見えない");
        // 「ブロック中」は自分がブロックした人にだけ
        const d = json(await api(B, "GET /groups/{gid}"));
        expect(d.members.find((m: { id: string }) => m.id === D).blocked).toBe(true);
        const fromD = json(await api(D, "GET /groups/{gid}"));
        expect(fromD.members.find((m: { id: string }) => m.id === B)).not.toHaveProperty("blocked");
    });

    it("送信の取り消し: 跡を残さず消え、未読と抜粋も戻る。他人の通は取り消せない", async () => {
        await seedGroup();
        await say(A, "はじめ", "msg-00000001");
        await say(A, "まちがい", "msg-00000002");
        expect((await inbox(B))[0]).toMatchObject({ unread: 2 });
        expect((await api(B, "POST /groups/{gid}/messages", {}, { unsend: "msg-00000002" })).statusCode).toBe(404);
        expect((await api(A, "POST /groups/{gid}/messages", {}, { unsend: "msg-00000002" })).statusCode).toBe(200);
        const b = (await inbox(B))[0];
        expect(b).toMatchObject({ unread: 1 });
        expect((b.last as { excerpt: string }).excerpt).toBe("はじめ");
        expect((await read(B)).messages.map((m) => m.text).filter(Boolean)).toEqual(["はじめ"]);
    });

    it("🔴 他人の写真で見せてはいけないもの（非公開）は送れない。札は読む人の目で決め直す", async () => {
        await seedGroup();
        store.set("photo-1", { id: "photo-1", src: "https://x/1.jpg", userId: D, published: false });
        expect((await api(A, "POST /groups/{gid}/messages", {}, { photoId: "photo-1" })).statusCode).toBe(404);
        store.set("photo-2", { id: "photo-2", src: "https://x/2.jpg", thumbSrc: "https://x/2t.jpg", userId: D });
        expect((await api(A, "POST /groups/{gid}/messages", {}, { photoId: "photo-2" })).statusCode).toBe(200);
        block(D, B);
        const forB = (await read(B)).messages.find((m) => (m as { photoId?: string }).photoId === "photo-2") as { photo?: { state: string } };
        expect(forB.photo).toEqual({ id: "photo-2", state: "gone" });
        const forA = (await read(A)).messages.find((m) => (m as { photoId?: string }).photoId === "photo-2") as { photo?: { state: string } };
        expect(forA.photo).toMatchObject({ state: "live" });
    });

    it("🔴 1日に送れるのは300通まで", async () => {
        await seedGroup();
        const day = new Date(clock + 9 * 3600 * 1000).toISOString().slice(0, 10);
        store.set(`dmday#${A}#${day}`, { id: `dmday#${A}#${day}`, groupSent: 300 });
        const r = await say(A, "もう1通");
        expect(r.statusCode).toBe(429);
        expect((await read(B)).messages.map((m) => m.text)).not.toContain("もう1通");
    });
});

describe("知らせ（接続1本・本文なし・3分に1回まで）", () => {
    it("相手全員の端末をまとめて sendPush 1回。本文は載せない。自分・知らせを止めた人には送らない", async () => {
        for (const x of [D, E]) follow(x, A);
        await seedGroup([D, E]);
        expect(members()).toEqual([A, B, D, E]);
        devices(D, `tok-${D}`, `tok-${D}-ipad`);
        await api(E, "PUT /groups/{gid}", {}, { muted: true });
        mockPush.mockClear();
        await say(A, "ないしょの本文");
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(pushedTokens()).toEqual([[`tok-${B}`, `tok-${D}`, `tok-${D}-ipad`].sort()]);
        const msg = mockPush.mock.calls[0][1] as { title: string; body: string; threadId: string; data: Record<string, string> };
        expect(JSON.stringify(msg)).not.toContain("ないしょの本文");
        expect(msg.body).toBe("ゆうからメッセージが届きました。");
        expect(msg.threadId).toBe(`group-${G}`);
        expect(msg.data).toEqual({ type: "groupchat", groupId: G });
    });

    it("同じグループの知らせは3分に1回まで。3分たてばまた鳴る", async () => {
        await seedGroup();
        await say(A, "1通目");
        tick(60 * 1000);
        await say(A, "2通目");
        expect(mockPush).toHaveBeenCalledTimes(1);
        tick(2 * 60 * 1000 + 1);
        await say(A, "3通目");
        expect(mockPush).toHaveBeenCalledTimes(2);
    });

    it("自分が送ってから3分の間は、自分に知らせない", async () => {
        await seedGroup();
        follow(A, D); follow(D, A);
        await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] });
        mockPush.mockClear();
        await say(B, "けんの返事");
        expect(pushedTokens()).toEqual([[`tok-${A}`, `tok-${D}`].sort()]);
        // 2分後に D が送る（3分の間なので鳴らさない）。3分と少したって A が送る: B は3分より前に送った → 知らせる。
        // D は1分前に送った → 今この会話にいるはずなので知らせない
        tick(2 * 60 * 1000);
        await say(D, "そらの返事");
        tick(60 * 1000 + 1);
        mockPush.mockClear();
        await say(A, "ゆうから");
        expect(pushedTokens()).toEqual([[`tok-${B}`]]);
    });

    it("届かない宛先（410）だけ、その持ち主の端末から外す", async () => {
        await seedGroup();
        // 本物の形のトークン（64桁の16進）でないと `forgetTokens` が外さない
        const dead = "ab".repeat(32);
        devices(B, dead);
        mockPush.mockResolvedValueOnce({ sent: 0, invalid: [dead] });
        await say(A, "届く？");
        // `forgetTokens` は UpdateCommand で `devices#<B>` から外す（手元の表では何もしないので呼ばれたかを見る）
        const updates = mockSend.mock.calls.map((c) => c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } })
            .filter((c) => c.constructor.name === "UpdateCommand").map((c) => c.input.Key?.id);
        expect(updates).toContain(`devices#${B}`);
        expect(updates).not.toContain(`devices#${A}`);
    });
});

describe("名前・抜ける・作った人の受け継ぎ", () => {
    it("名前は誰でも変えられ、会話に1行残る。20字まで", async () => {
        await seedGroup();
        expect((await api(B, "PUT /groups/{gid}", {}, { name: "京都の週末" })).statusCode).toBe(200);
        expect(store.get(`group#${G}`)!.name).toBe("京都の週末");
        const ev = (await read(A)).messages.find((m) => m.event?.type === "renamed") as unknown as { event: { name: string }; from: string };
        expect(ev).toMatchObject({ from: B, event: { name: "京都の週末" } });
        await api(B, "PUT /groups/{gid}", {}, { name: "あ".repeat(30) });
        expect((store.get(`group#${G}`)!.name as string).length).toBe(20);
    });

    it("作った人が抜けたら、いちばん前から入っている人が受け継ぐ。最後の1人が抜けたらグループを消す", async () => {
        await seedGroup();
        expect((await api(A, "DELETE /groups/{gid}/members/{uid}", { uid: A })).statusCode).toBe(200);
        expect(members()).toEqual([B]);
        expect(store.get(`groupmembers#${G}`)!.ownerId).toBe(B);
        expect(store.get(`group#${G}`)!.ownerId).toBe(B);
        expect(entry(A)).toBeUndefined();
        expect((await api(A, "GET /groups/{gid}/messages")).statusCode).toBe(404);
        await api(B, "DELETE /groups/{gid}/members/{uid}", { uid: B });
        for (const k of [`group#${G}`, `groupmembers#${G}`, `groupchat#${G}`]) expect(store.has(k)).toBe(false);
        // 招待中だった人の棚からも外れる
        expect(entry(C)).toBeUndefined();
    });
});

describe("通報", () => {
    it("自分に見えている直近20通を、誰の通かとグループの名前も付けて写す。押し直しで前の写しを残す", async () => {
        await seedGroup();
        await api(A, "PUT /groups/{gid}", {}, { name: "いやな名前" });
        for (let k = 0; k < 22; k++) { tick(1000); await say(k % 2 ? A : B, `通${k}`, `msg-${String(k).padStart(8, "0")}`); }
        expect((await api(B, "POST /groups/{gid}/report", {}, { reason: "harassment" })).statusCode).toBe(200);
        const row = store.get(`groupreport#${G}#${B}`)!;
        const msgs = row.messages as Array<{ from: string; text: string }>;
        expect(msgs).toHaveLength(20);
        expect(msgs[0]).toMatchObject({ text: "通2", from: B });
        expect(row).toMatchObject({ groupName: "いやな名前", reporterId: B, reason: "harassment" });
        expect(row).not.toHaveProperty("userId");
        // 相手が取り消しても、押し直しの写しから消えない
        await api(A, "POST /groups/{gid}/messages", {}, { unsend: "msg-00000021" });
        await api(B, "POST /groups/{gid}/report", {}, { reason: "harassment", messageId: "msg-00000003" });
        const again = store.get(`groupreport#${G}#${B}`)!;
        expect((again.messages as Array<{ text: string }>).map((m) => m.text)).toContain("通21");
        expect(again).toMatchObject({ messageId: "msg-00000003", reportedId: A });
        // 理由が無ければ 400
        expect((await api(B, "POST /groups/{gid}/report", {}, {})).statusCode).toBe(400);
    });
});

describe("退会", () => {
    it("入っていたグループから抜け、招待は黙って外す。過去の通は残る", async () => {
        await seedGroup();
        await say(B, "けんの通");
        await purgeGroupsFor(B);
        await purgeGroupsFor(C);
        expect(members()).toEqual([A]);
        expect(invited()).toEqual([]);
        expect((store.get(`groupmembers#${G}`)!.declined as string[])).toEqual([]);
        expect((await read(A)).messages.map((m) => m.text)).toContain("けんの通");
    });
});

// ---------------------------------------------------------------------------
// 2026-11-12 確かめ役の指摘（PR #630）
// ---------------------------------------------------------------------------

const day = () => new Date(clock + 9 * 3600 * 1000).toISOString().slice(0, 10);
const putTo = (id: string, has?: (item: Row) => boolean) => (name: string, input: Record<string, unknown>) =>
    name === "PutCommand" && (input.Item as Row).id === id && (!has || has(input.Item as Row));
const fullBox = (state: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, k) =>
    [`${String(k).padStart(8, "0")}-9999-4999-8999-999999999999`, { state, at: new Date(clock).toISOString() }]));

describe("🔴 指摘1: 外された人に今のメンバーを見せない", () => {
    it("中身・会話の人・受信箱に、外されたあとに入った人も自分をブロックした人も出ない（人数・自動の名前も）", async () => {
        for (const x of [D, E]) follow(x, A);
        await seedGroup([D]);
        await say(B, "けんの通");
        tick(1000);
        await say(D, "そらの通");
        tick(1000);
        await api(A, "DELETE /groups/{gid}/members/{uid}", { uid: D });
        tick(1000);
        follow(A, E);
        await api(A, "POST /groups/{gid}/members", {}, { userIds: [E] });
        expect(members()).toContain(E);
        block(B, D);
        const d = json(await api(D, "GET /groups/{gid}"));
        expect(d.group).toMatchObject({ state: "removed", title: "グループ", canSend: false });
        expect(d.group).not.toHaveProperty("count");
        expect(d.group).not.toHaveProperty("ownerId");
        expect(d.members).toEqual([]);
        expect(JSON.stringify(d)).not.toMatch(/はな|けん|ゆう/);
        const r = json(await api(D, "GET /groups/{gid}/messages"));
        // 見えている通の送り主だけ（自分をブロックした B の通は隠れ、外されたあとに入った E は出ない）
        expect(Object.keys(r.people)).not.toContain(E);
        expect(Object.keys(r.people)).not.toContain(B);
        expect(Object.keys(r.people).sort()).toEqual([A, D].sort());
        const box = (await inbox(D))[0];
        expect(box).toMatchObject({ state: "removed", title: "グループ", faces: [] });
        expect(box).not.toHaveProperty("count");
        // 名前を付けたグループは名前だけ
        await api(A, "PUT /groups/{gid}", {}, { name: "京都" });
        expect((await inbox(D))[0].title).toBe("京都");
    });
});

describe("🔴 指摘2: 消えたグループと同じ gid", () => {
    it("作り直されたグループを、前のグループで外された人は読めない", async () => {
        follow(D, A);
        await seedGroup([D]);
        await api(A, "DELETE /groups/{gid}/members/{uid}", { uid: D });
        expect(entry(D)).toMatchObject({ state: "removed" });
        await api(B, "DELETE /groups/{gid}/members/{uid}", { uid: B });
        await api(A, "DELETE /groups/{gid}/members/{uid}", { uid: A });
        expect(store.has(`groupmembers#${G}`)).toBe(false);
        tick(1000);
        follow(B, C); follow(B, E); follow(C, B);
        expect((await api(B, "POST /groups", {}, { id: G, userIds: [C, E], name: "新しい" })).statusCode).toBe(200);
        expect(entry(D)).toMatchObject({ state: "removed" });
        for (const route of ["GET /groups/{gid}", "GET /groups/{gid}/messages"]) expect((await api(D, route)).statusCode).toBe(404);
        expect(JSON.stringify(await inbox(D))).not.toContain("新しい");
    });

    it("使われている gid・片付けの残りがある gid では作れない（409）", async () => {
        await seedGroup();
        follow(D, B); follow(D, C);
        const r = await api(D, "POST /groups", {}, { id: G, userIds: [B, C] });
        expect(r.statusCode).toBe(409);
        expect(json(r).code).toBe("idTaken");
        const G2 = "22222222-2222-4333-8444-555555555555";
        store.set(`groupchat#${G2}`, { id: `groupchat#${G2}`, gid: G2, items: [] });
        expect((await api(D, "POST /groups", { gid: G2 }, { id: G2, userIds: [B, C] })).statusCode).toBe(409);
        expect(store.has(`groupmembers#${G2}`)).toBe(false);
    });
});

describe("🔴 指摘3: 名前の無いグループの知らせの題", () => {
    it("「グループ」とだけ言い、受け取る人の名前を入れない。名前があれば名前", async () => {
        await seedGroup();
        await say(A, "やあ");
        const msg = mockPush.mock.calls[0][1] as { title: string };
        expect(msg.title).toBe("グループ");
        expect(msg.title).not.toContain("けん");
        await api(A, "PUT /groups/{gid}", {}, { name: "京都" });
        tick(3 * 60 * 1000 + 1);
        await say(A, "また");
        expect((mockPush.mock.calls[1][1] as { title: string }).title).toBe("京都");
    });
});

describe("🔴 知らせ: ブロックの間柄の人には送らない", () => {
    it("送った人をブロックした人・送った人がブロックした人", async () => {
        for (const x of [D, E]) follow(x, A);
        await seedGroup([D, E]);
        block(B, A);
        block(A, D);
        await say(A, "みんなへ");
        expect(pushedTokens()).toEqual([[`tok-${E}`]]);
    });
});

describe("🔴 1日に人を足す数（招待20人・そのまま100人）", () => {
    it("そのまま入る人が100人を越えるなら断る（何も書かない）", async () => {
        follow(D, A);
        store.set(`groupsjoined#${A}`, { id: `groupsjoined#${A}`, rev: 1, groups: {}, quota: { day: day(), direct: 99, request: 0 } });
        for (const x of [B, D]) follow(A, x);
        follow(B, A);
        const r = await api(A, "POST /groups", {}, { id: G, userIds: [B, D] });
        expect(r.statusCode).toBe(429);
        expect(store.has(`groupmembers#${G}`)).toBe(false);
    });

    it("招待が20人を越えるなら断る。日が変われば数え直す", async () => {
        store.set(`groupsjoined#${A}`, { id: `groupsjoined#${A}`, rev: 1, groups: {}, quota: { day: day(), direct: 0, request: 19 } });
        for (const x of [C, E]) follow(A, x);
        expect((await api(A, "POST /groups", {}, { id: G, userIds: [C, E] })).statusCode).toBe(429);
        tick(24 * 3600 * 1000);
        expect((await api(A, "POST /groups", {}, { id: G, userIds: [C, E] })).statusCode).toBe(200);
        expect(invited().sort()).toEqual([C, E].sort());
    });
});

describe("🔴 書くときの守り（事前の確かめのあとで枠が埋まる）", () => {
    it("30人の枠: 確かめたあとに埋まったら入れない", async () => {
        await seedGroup();
        follow(A, D); follow(D, A);
        hooks.push((name, input) => {
            if (!putTo(`groupmembers#${G}`, (it) => JSON.stringify(it).includes(D))(name, input)) return false;
            bump(`groupmembers#${G}`, (cur) => ({ ...cur, invited: [...(cur.invited as unknown[]),
                ...Array.from({ length: 27 }, (_, k) => ({ id: `${String(k).padStart(8, "0")}-3333-4333-8333-333333333333`, by: A, at: new Date(clock).toISOString() }))] }));
            return true;
        });
        const r = json(await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] }));
        expect(r.added).toEqual([]);
        expect(members()).not.toContain(D);
        expect(entry(D)).toBeUndefined();
    });

    it("断った人: 確かめたあとに断っていたら入れない", async () => {
        await seedGroup();
        follow(A, D); follow(D, A);
        hooks.push((name, input) => {
            if (!putTo(`groupmembers#${G}`, (it) => JSON.stringify(it).includes(D))(name, input)) return false;
            bump(`groupmembers#${G}`, (cur) => ({ ...cur, declined: [D] }));
            return true;
        });
        expect(json(await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] })).added).toEqual([]);
        expect(members()).not.toContain(D);
    });

    it("招待の棚20: 確かめたあとに埋まったら、メンバーの行から戻す", async () => {
        await seedGroup();
        follow(A, D);
        hooks.push((name, input) => {
            if (!putTo(`groupsjoined#${D}`)(name, input)) return false;
            bump(`groupsjoined#${D}`, (cur) => ({ ...cur, groups: fullBox("invited", 20) }));
            return true;
        });
        expect(json(await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] })).invited).toEqual([]);
        expect(invited()).not.toContain(D);
    });

    it("50グループ: 確かめたあとに埋まったら、メンバーの行から戻す", async () => {
        await seedGroup();
        follow(A, D); follow(D, A);
        hooks.push((name, input) => {
            if (!putTo(`groupsjoined#${D}`)(name, input)) return false;
            bump(`groupsjoined#${D}`, (cur) => ({ ...cur, groups: fullBox("member", 50) }));
            return true;
        });
        expect(json(await api(A, "POST /groups/{gid}/members", {}, { userIds: [D] })).added).toEqual([]);
        expect(members()).not.toContain(D);
    });
});

describe("🔴 指摘5: その人の行を書けなかったときの戻し", () => {
    it("入れる人の行が落ちたら、メンバーの行から戻す（グループは作る）", async () => {
        for (const x of [B, C]) follow(A, x);
        follow(B, A);
        hooks.push((name, input) => {
            if (!putTo(`groupsjoined#${B}`)(name, input)) return false;
            throw Object.assign(new Error("boom"), { name: "InternalServerError" });
        });
        const r = await api(A, "POST /groups", {}, { id: G, userIds: [B, C] });
        expect(r.statusCode).toBe(200);
        expect(members()).toEqual([A]);
        expect(invited()).toEqual([C]);
        expect(json(r).skipped).toBe(1);
    });

    it("作る人の50グループが同時に埋まったら、作った行を消して断る", async () => {
        for (const x of [B, C]) follow(A, x);
        follow(B, A);
        hooks.push((name, input) => {
            if (!putTo(`groupsjoined#${A}`, (it) => JSON.stringify(it).includes(G))(name, input)) return false;
            bump(`groupsjoined#${A}`, (cur) => ({ ...cur, groups: fullBox("member", 50) }));
            return true;
        });
        const r = await api(A, "POST /groups", {}, { id: G, userIds: [B, C] });
        expect(r.statusCode).toBe(403);
        expect(json(r).code).toBe("selfFull");
        for (const k of [`group#${G}`, `groupmembers#${G}`, `groupchat#${G}`]) expect(store.has(k)).toBe(false);
        expect(entry(B)).toBeUndefined();
    });
});

describe("🔴 指摘7: 退会の掃除", () => {
    it("断った・外された控えから名を外し、送った招待を取り消す", async () => {
        for (const x of [D, E]) follow(x, A);
        await seedGroup([D, E]);
        follow(A, C);
        // C は断る・D は外される
        await api(C, "DELETE /groups/{gid}/invite");
        await api(A, "DELETE /groups/{gid}/members/{uid}", { uid: D });
        expect(store.get(`groupmembers#${G}`)!.declined).toEqual([C]);
        expect(store.get(`groupmembers#${G}`)!.kicked).toEqual([D]);
        // D は自分で「外れました」の行を消しても、掃除で辿れる
        await api(D, "DELETE /groups/{gid}/members/{uid}", { uid: D });
        await purgeGroupsFor(C);
        await purgeGroupsFor(D);
        expect(store.get(`groupmembers#${G}`)!.declined).toEqual([]);
        expect(store.get(`groupmembers#${G}`)!.kicked).toEqual([]);
        // B が招待した人は、B の退会で取り消される
        const F = "ffffffff-0000-4000-8000-000000000006";
        users.set(F, { userId: F, displayName: "ふう" });
        follow(B, F);
        await api(B, "POST /groups/{gid}/members", {}, { userIds: [F] });
        expect(invited()).toEqual([F]);
        expect(entry(F)).toMatchObject({ state: "invited", by: B });
        await purgeGroupsFor(B);
        expect(invited()).toEqual([]);
        expect(entry(F)).toBeUndefined();
        expect(members()).not.toContain(B);
    });
});

/**
 * 🔴 試験で実際に読み書きした行が、スタックの権限（`serverless.groups.yml`）の中にあること（指摘4）。
 * 鍵の頭で絞れない写真の行は、ProjectionExpression の欄が許した欄の中にあること。**AWS の上で効くかは確かめていない**
 */
describe("使う行はスタックの権限の中", () => {
    it("この試験ファイルで送った命令を、権限の文と突き合わせる", async () => {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const yml = readFileSync(join(__dirname, "..", "..", "serverless.groups.yml"), "utf8").replace(/^\s*#.*$/gm, "");
        const body = yml.split(/\n {6}statements:\n/)[1].split(/\n(?=[a-zA-Z]|  [a-zA-Z])/)[0];
        const sts = body.split(/\n(?= {8}- Effect:)/).filter((b) => b.includes("photosTable")).map((b) => ({
            actions: [...b.matchAll(/^\s*-\s+dynamodb:([A-Za-z]+)\s*$/gm)].map((m) => m[1]),
            keys: [...b.matchAll(/^\s*-\s+([a-z]+#)\*\s*$/gm)].map((m) => m[1]),
            attrs: b.includes("dynamodb:Attributes:") ? b.split("dynamodb:Attributes:\n")[1].split(/\n\s+[A-Z']/)[0].match(/- (\w+)/g)!.map((x) => x.slice(2)) : null,
        }));
        const allows = (action: string, id: string, projected?: string[]) => sts.some((st) => st.actions.includes(action) && (
            st.keys.length > 0 ? st.keys.some((k) => id.startsWith(k)) : !!st.attrs && !!projected && projected.every((a) => st.attrs!.includes(a))));
        expect(seen.length).toBeGreaterThan(1000);
        const bad = new Set<string>();
        for (const { name, input } of seen) {
            if (input.TableName !== undefined && input.TableName !== "photos-test" && !(input as { RequestItems?: object }).RequestItems) continue;
            const action = name.replace(/Command$/, "Item");
            if (name === "BatchGetCommand") {
                const req = (input.RequestItems as Record<string, { Keys: Array<{ id?: string }> }>)["photos-test"];
                for (const k of req?.Keys ?? []) if (!allows("BatchGetItem", k.id!)) bad.add(`BatchGetItem ${k.id}`);
                continue;
            }
            const id = ((input.Key as { id?: string }) ?? (input.Item as { id?: string }))?.id ?? "";
            const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
            const projected = typeof input.ProjectionExpression === "string"
                ? input.ProjectionExpression.split(",").map((x) => x.trim()).map((x) => names[x] ?? x) : undefined;
            if (!allows(action, id, projected)) bad.add(`${action} ${id.replace(/[0-9a-f-]{36}/g, "<id>")}`);
        }
        expect([...bad]).toEqual([]);
    });
});
