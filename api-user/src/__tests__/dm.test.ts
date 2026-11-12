import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * DM 第1段（`dm.ts`・札 #505）。`storyReplies.test.ts` と同じ粒度——DynamoDB は境界でモックし、
 * 「どの行をどの条件で書いたか」と「どの判定で断ったか」を見る。書き込みの条件式そのもの
 * （未読の原子的な加算・上限・物理削除の条件）は入力の文字列で縛る。
 */

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test", USER_INDEX: "userId-createdAt-index" }));

const mockReadLive = vi.hoisted(() => vi.fn());
vi.mock("../liveCaller", async (orig) => ({
    ...(await orig<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => null,
    readLiveCaller: (...a: unknown[]) => mockReadLive(...a),
}));

const mockPushDm = vi.hoisted(() => vi.fn());
const mockPushNotification = vi.hoisted(() => vi.fn());
const mockDeleted = vi.hoisted(() => vi.fn<() => { deleted: Set<string>; unread: Set<string> }>());
vi.mock("../notify", () => ({
    pushDmMessage: mockPushDm,
    pushNotification: mockPushNotification,
    displayNameOf: (r?: { displayName?: unknown }) => (typeof r?.displayName === "string" && r.displayName.trim()) || undefined,
    DEFAULT_NAME: "名前未設定さん",
    DELETED_USER_NAME: "退会したユーザー",
    deletedAmong: async () => mockDeleted(),
    withUnreadAsDeleted: (r: { deleted: Set<string>; unread: Set<string> }) => new Set([...r.deleted, ...r.unread]),
}));

const mockHidden = vi.hoisted(() => vi.fn(async (...a: string[]) => { void a; return new Set<string>(); }));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    hiddenUserIds: (uid: string) => mockHidden(uid),
}));

const { QUOTE_LOOKUP_MAX } = await import("../dmStoryQuote");
const [dm, { DM_CONVS_MAX, DM_REQUESTS_MAX, DM_INBOX_HARD_MAX, DM_DECLINED_MAX }, { postStoryReply, storyReplyTimeouts }] = await Promise.all([import("../dm"), import("../dmInbox"), import("../storyReplies")]);
const { handler, sendDm, purgeDmFor, convIdOf, parseConvId, containsUrl, cleanDmText, overBudgetCount,
    DM_REQUEST_MAX, DM_DAILY_NEW_CONVS, DM_DAILY_SENT, DM_MESSAGES_MAX, DM_REPORT_LAST } = dm;

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const CONV = `${ME}_${PEER}`;
const SECRET = "ひみつの本文-9f3a";
const USERS = process.env.USERS_TABLE as string;

type Row = Record<string, unknown>;
let rows: Record<string, Row>;
let users: Record<string, Row>;
let ccf: (cmd: string, input: Record<string, unknown>) => boolean;
let calls: { cmd: string; input: Record<string, any> }[];   // eslint-disable-line @typescript-eslint/no-explicit-any

const entry = (peer: string, o: Record<string, unknown> = {}) => ({ peer, t: "2026-11-09T00:00:00.000Z", excerpt: "x", unread: 0, state: "inbox", ...o });
const boxRow = (uid: string, convs: Record<string, unknown>, extra: Row = {}) => ({ id: `dminbox#${uid}`, convs, ...extra });
const msg = (from: string, text: string, t: string, id = `m-${t}-${text}`.slice(0, 40).replace(/[^\w-]/g, "_").padEnd(8, "_")) => ({ id, from, text, t });
const convRow = (items: unknown[], o: Row = {}) => ({
    id: `dm#${ME}#${PEER}`, lo: ME, hi: PEER, items, state: "inbox", initiator: ME, reqCount: 0,
    updatedAt: "2026-11-09T01:00:00.000Z", ...o,
});
const KEY = `dm#${ME}#${PEER}`;
const follows = (target: string, follower: string) => { rows[`follow#${target}#${follower}`] = { id: "f" }; };

beforeEach(() => {
    rows = {};
    users = { [PEER]: { userId: PEER, displayName: "旅人B", username: "tabi_b" } };
    ccf = () => false;
    calls = [];
    mockSend.mockReset().mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
        const cmd = c.constructor.name;
        calls.push({ cmd, input: c.input });
        if (ccf(cmd, c.input)) throw Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" });
        if (cmd === "GetCommand") { const r = rows[c.input.Key.id]; return r ? { Item: r } : {}; }
        if (cmd === "BatchGetCommand" && c.input.RequestItems["photos-test"]) {
            const ids = (c.input.RequestItems["photos-test"].Keys as { id: string }[]).map((k) => k.id);
            return { Responses: { "photos-test": ids.map((k) => rows[k]).filter(Boolean) } };
        }
        if (cmd === "BatchGetCommand") {
            const keys = (c.input.RequestItems[USERS].Keys as { userId: string }[]).map((k) => k.userId);
            return { Responses: { [USERS]: keys.map((k) => users[k]).filter(Boolean) } };
        }
        if (cmd === "UpdateCommand" && c.input.ReturnValues === "ALL_NEW") return { Attributes: rows[c.input.Key.id] };
        return {};
    });
    mockReadLive.mockReset().mockImplementation(async (uid: string) => ({ row: { userId: uid, displayName: "旅人A" } }));
    mockPushDm.mockReset().mockResolvedValue(undefined);
    mockPushNotification.mockReset().mockResolvedValue(undefined);
    mockDeleted.mockReset().mockReturnValue({ deleted: new Set(), unread: new Set() });
    mockHidden.mockReset().mockResolvedValue(new Set());
});

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);
const ev = (route: string, sub: string | undefined, o: { id?: string; body?: unknown; since?: string } = {}) => ({
    routeKey: route,
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: o.id ? { id: o.id } : undefined,
    queryStringParameters: o.since ? { since: o.since } : undefined,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
});
const bodyOf = (r: Result) => JSON.parse(r.body);
const send = (text: unknown, sub = ME, to = PEER, extra: Record<string, unknown> = {}) =>
    invoke(handler, ev("POST /dm", sub, { body: { to, text, ...extra } }));
const writes = () => calls.filter((c) => ["PutCommand", "UpdateCommand", "DeleteCommand"].includes(c.cmd));
const convWrites = () => writes().filter((c) => (c.input.Key?.id ?? c.input.Item?.id) === KEY);
const entryWrites = (uid: string) => writes().filter((c) => c.input.Key?.id === `dminbox#${uid}` && String(c.input.UpdateExpression).includes("convs.#c.#peer"));
const dayWrites = () => writes().filter((c) => String(c.input.Key?.id ?? "").startsWith("dmday#"));

describe("会話 ID と本文の整え", () => {
    it("2人から一意に決まる（順序に依らない）・形の違うものは割れない", () => {
        expect(convIdOf(PEER, ME)).toBe(CONV);
        expect(convIdOf(ME, PEER)).toBe(CONV);
        expect(parseConvId(CONV)).toEqual({ lo: ME, hi: PEER });
        expect(parseConvId(`${PEER}_${ME}`), "順序が逆の ID を通している").toBeNull();
        expect(parseConvId(`${ME}_${ME}`)).toBeNull();
        expect(parseConvId("abc")).toBeNull();
        expect(parseConvId(`${ME}_${PEER}_x`)).toBeNull();
        expect(parseConvId(undefined)).toBeNull();
    });

    it("改行は残し、見えない制御文字と3つ以上の空行は落とす・上限で切る", () => {
        expect(cleanDmText("  こんにちは\r\n\n\n\n元気\u0000？ ")).toBe("こんにちは\n\n元気？");
        expect(cleanDmText("   ")).toBe("");
        expect(cleanDmText(123)).toBe("");
        expect(cleanDmText("あ".repeat(900)).length).toBeLessThanOrEqual(500);
    });

    it("URL の判定（スキーム・www・ドメイン・全角）", () => {
        for (const t of ["https://example.com/a", "http://x", "www.example.org", "example.com", "ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ", "見て bit.ly/abc", "foo.jp"]) {
            expect(containsUrl(t), t).toBe(true);
        }
        for (const t of ["こんにちは", "写真きれいですね。", "3.5mm の話", "v1.2 です"]) expect(containsUrl(t), t).toBe(false);
    });
});

describe("送信: 入口の門", () => {
    it("未認証は 401・何も書かない", async () => {
        const r = await invoke(handler, ev("POST /dm", undefined, { body: { to: PEER, text: "こんにちは" } }));
        expect(r.statusCode).toBe(401);
        expect(writes()).toHaveLength(0);
    });

    it("退会した本人（墓石）は 410 で何も書かない", async () => {
        mockReadLive.mockResolvedValue({ gone: { statusCode: 410, body: "{}" } });
        follows(PEER, ME);
        expect((await send("こんにちは")).statusCode).toBe(410);
        expect(writes()).toHaveLength(0);
        expect(mockPushDm).not.toHaveBeenCalled();
    });

    it("壊れた JSON・自分宛て・形の違う相手は 400", async () => {
        expect((await invoke(handler, { ...ev("POST /dm", ME), body: "{broken" })).statusCode).toBe(400);
        expect((await send("やあ", ME, ME)).statusCode).toBe(400);
        expect((await send("やあ", ME, "not-a-uid")).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("空の本文は 400（何も書かない）", async () => {
        follows(PEER, ME);
        const r = await send("   \n ");
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).code).toBe("empty");
        expect(writes()).toHaveLength(0);
    });

    it("相手をフォローしていない人は会話を始められない（404・何も書かない）", async () => {
        const r = await send("こんにちは");
        expect(r.statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
        expect(dayWrites(), "断る回は歯止めを進めない").toHaveLength(0);
    });

    it("🔴 ブロックされていたら 404（ブロックと分かる応答にしない）・何も書かず知らせない", async () => {
        follows(PEER, ME);
        rows[`block#${PEER}#${ME}`] = { id: "b" };
        const r = await send("こんにちは");
        expect(r.statusCode).toBe(404);
        expect(r.body).not.toMatch(/ブロック|block/i);
        expect(writes()).toHaveLength(0);
        expect(mockPushDm).not.toHaveBeenCalled();
    });

    it("自分がブロックした相手には 403 で理由を言う（自分の操作）", async () => {
        follows(PEER, ME);
        rows[`block#${ME}#${PEER}`] = { id: "b" };
        const r = await send("こんにちは");
        expect(r.statusCode).toBe(403);
        expect(bodyOf(r).code).toBe("blockedByMe");
        expect(writes()).toHaveLength(0);
    });

    it("退会した相手には送れない（404）・読めなかったときは通さない（500）", async () => {
        follows(PEER, ME);
        mockDeleted.mockReturnValue({ deleted: new Set([PEER]), unread: new Set() });
        expect((await send("こんにちは")).statusCode).toBe(404);
        mockDeleted.mockReturnValue({ deleted: new Set(), unread: new Set([PEER]) });
        expect((await send("こんにちは")).statusCode).toBe(500);
        expect(writes()).toHaveLength(0);
    });
});

describe("送信: 受信箱へ直行する人・リクエストになる人", () => {
    it("🔴 相手が自分をフォローしていなければ「リクエスト」（本体は request・相手の行は request・自分は pending・プッシュなし）", async () => {
        follows(PEER, ME);
        const r = await send("はじめまして");
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).state).toBe("pending");
        expect(bodyOf(r).conversationId).toBe(CONV);
        const put = convWrites().find((c) => c.cmd === "PutCommand")!;
        expect(put.input.Item).toMatchObject({ state: "request", initiator: ME, reqCount: 1, lo: ME, hi: PEER });
        expect(put.input.ConditionExpression).toBe("attribute_not_exists(id)");
        expect(entryWrites(PEER)[0].input.ExpressionAttributeValues[":s"]).toBe("request");
        expect(entryWrites(ME)[0].input.ExpressionAttributeValues[":s"]).toBe("pending");
        expect(mockPushDm, "リクエストにはプッシュしない").not.toHaveBeenCalled();
    });

    it("相手が自分をフォローしていれば受信箱へ直行・プッシュは名前と会話 ID だけ（本文を渡さない）", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        const r = await send("はじめまして");
        expect(bodyOf(r).state, "送り主には、リクエストと同じ形（pending）で返す").toBe("pending");
        expect(entryWrites(ME)[0].input.ExpressionAttributeValues[":s"]).toBe("pending");
        expect(convWrites().find((c) => c.cmd === "PutCommand")!.input.Item).toMatchObject({ state: "request", reqCount: 1, direct: true });
        expect(entryWrites(PEER)[0].input.ExpressionAttributeValues[":s"]).toBe("inbox");
        expect(mockPushDm).toHaveBeenCalledTimes(1);
        const [to, arg] = mockPushDm.mock.calls[0];
        expect(to).toBe(PEER);
        expect(arg).toEqual({ byName: "旅人A", byId: ME, convId: CONV });
        expect(JSON.stringify(mockPushDm.mock.calls)).not.toContain("はじめまして");
    });

    it("相手の親しい友達に入っていれば受信箱へ直行", async () => {
        follows(PEER, ME);
        rows[`closefriends#${PEER}`] = { id: "c", list: [ME] };
        expect(bodyOf(await send("やあ")).state).toBe("pending");
        expect(mockPushDm).toHaveBeenCalledTimes(1);
    });

    it("親しい友達の名簿が読めなければ、リクエストに倒す（厳しい側）", async () => {
        follows(PEER, ME);
        const real = mockSend.getMockImplementation()!;
        mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
            if (c.constructor.name === "GetCommand" && c.input.Key.id === `closefriends#${PEER}`) throw new Error("boom");
            return real(c);
        });
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(bodyOf(await send("やあ")).state).toBe("pending");
    });
});

describe("リクエストの規則", () => {
    it("🔴 URL を含む文はリクエストの段階では断る（何も書かない）・承認後は通す", async () => {
        follows(PEER, ME);
        const r = await send("見てね https://example.com/x");
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).code).toBe("requestUrl");
        expect(writes()).toHaveLength(0);
        // 🔴 会話の最初の1通は、受信箱へ直行する相手でも同じ理由で断る（断るかどうかで関係を読み取らせない）
        follows(ME, PEER);
        const direct = await send("見てね https://example.com/x");
        expect(direct.statusCode).toBe(400);
        expect(bodyOf(direct).code).toBe("requestUrl");
        expect(direct.body).toBe(r.body);
        expect(writes()).toHaveLength(0);
        // 承認後（本体が inbox）の会話では通す
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        expect((await send("見てね https://example.com/x")).statusCode).toBe(200);
    });

    it("既に会話がリクエストの間も URL は断る", async () => {
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:00.000Z")], { state: "request", initiator: ME, reqCount: 1 });
        expect((await send("http://example.com")).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("🔴 承認か返信まで文字3通まで: 3通目は通り、4通目は 429", async () => {
        rows[KEY] = convRow([msg(ME, "1", "2026-11-09T00:00:01.000Z"), msg(ME, "2", "2026-11-09T00:00:02.000Z")], { state: "request", initiator: ME, reqCount: 2 });
        const third = await send("3通目");
        expect(third.statusCode).toBe(200);
        const upd = convWrites().find((c) => c.cmd === "UpdateCommand")!;
        expect(upd.input.UpdateExpression).toContain("reqCount = if_not_exists(reqCount, :z) + :one");
        expect(mockPushDm).not.toHaveBeenCalled();

        calls = [];
        rows[KEY] = convRow([], { state: "request", initiator: ME, reqCount: DM_REQUEST_MAX });
        const fourth = await send("4通目");
        expect(fourth.statusCode).toBe(429);
        expect(bodyOf(fourth).code).toBe("requestLimit");
        expect(writes()).toHaveLength(0);
    });

    it("🔴 受け取った人の返信が承認（本体 state→inbox・双方の行が inbox・始めた人にプッシュ）", async () => {
        rows[KEY] = convRow([msg(PEER, "もしもし", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: PEER, reqCount: 1 });
        const r = await send("返事です");
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).state).toBe("inbox");
        const upd = convWrites().find((c) => c.cmd === "UpdateCommand")!;
        expect(upd.input.UpdateExpression).toContain("#state = :inbox");
        expect(upd.input.UpdateExpression).not.toContain("reqCount");
        expect(entryWrites(PEER)[0].input.ExpressionAttributeValues[":s"]).toBe("inbox");
        expect(entryWrites(ME)[0].input.ExpressionAttributeValues[":s"]).toBe("inbox");
        expect(mockPushDm).toHaveBeenCalledTimes(1);
        expect(mockPushDm.mock.calls[0][0]).toBe(PEER);
    });

    it("🔴 断ったあとの再送でも通数は戻らない（相手が残した印 `dec_` から数える）", async () => {
        follows(PEER, ME);
        rows[`dminbox#${PEER}`] = boxRow(PEER, {}, { [`dec_${ME}`]: DM_REQUEST_MAX });
        const r = await send("もう一度");
        expect(r.statusCode).toBe(429);
        expect(bodyOf(r).code).toBe("requestLimit");
        expect(writes()).toHaveLength(0);

        rows[`dminbox#${PEER}`] = boxRow(PEER, {}, { [`dec_${ME}`]: 1 });
        expect((await send("もう一度")).statusCode).toBe(200);
        expect(convWrites().find((c) => c.cmd === "PutCommand")!.input.Item.reqCount, "前の1通に続けて数える").toBe(2);
    });
});

describe("歯止め・上限", () => {
    it("🔴 1日の送信と新規会話は原子的な条件つき加算（新しい会話だけ新規の数も進める）", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        await send("はじめて");
        const first = dayWrites()[0].input;
        expect(first.Key.id).toMatch(/^dmday#1{8}-.*#\d{4}-\d{2}-\d{2}$/);
        expect(first.UpdateExpression).toContain("ADD sent :one, newConv :one");
        expect(first.ConditionExpression).toContain("sent < :maxSent");
        expect(first.ConditionExpression).toContain("newConv < :maxNew");
        expect(first.ExpressionAttributeValues[":maxNew"]).toBe(DM_DAILY_NEW_CONVS);
        expect(first.ExpressionAttributeValues[":maxSent"]).toBe(DM_DAILY_SENT);

        calls = [];
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:00.000Z")]);
        await send("続き");
        const second = dayWrites()[0].input;
        expect(second.UpdateExpression).toBe("SET uid = :uid, #d = :day ADD sent :one");
        expect(second.ConditionExpression).not.toContain("newConv");
    });

    it("🔴 歯止めに当たったら 429 で、本体にも受信箱にも書かない・プッシュしない", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        ccf = (cmd, input) => cmd === "UpdateCommand" && String((input.Key as { id: string }).id).startsWith("dmday#");
        const r = await send("たくさん");
        expect(r.statusCode).toBe(429);
        expect(bodyOf(r).code).toBe("dailyLimit");
        expect(convWrites()).toHaveLength(0);
        expect(entryWrites(PEER)).toHaveLength(0);
        expect(mockPushDm).not.toHaveBeenCalled();
    });

    it("🔴 同じ id の再送: 歯止めを進めず・追記せず・受信箱の未読を二重に足さない（行は復活させない）", async () => {
        const id = "client-id-0001";
        const T = "2026-11-09T00:00:00.000Z";
        rows[KEY] = convRow([{ id, from: ME, text: "もう入っている", t: T }]);
        // 受信箱の更新は「この通は反映済み」で条件が外れる（lastId が同じ）。行は在る
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME, { t: T }) });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { t: T }) });
        ccf = (cmd, input) => cmd === "UpdateCommand" && String(input.ConditionExpression ?? "").includes("#lid");
        const r = await send("もう入っている", ME, PEER, { id });
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).message.id).toBe(id);
        expect(dayWrites()).toHaveLength(0);
        expect(convWrites()).toHaveLength(0);
        expect(mockPushDm, "二重にプッシュしない").not.toHaveBeenCalled();
        const creates = calls.filter((c) => c.cmd === "UpdateCommand" && (String(c.input.UpdateExpression).includes("convs = if_not_exists") || c.input.UpdateExpression === "SET convs.#c = :entry"));
        expect(creates, "行が在るのに作り直している").toHaveLength(0);
        // 再送を繰り返しても、未読を増やす書き込みは1度も通らない（条件で外れ続ける）
        await send("もう入っている", ME, PEER, { id });
        await send("もう入っている", ME, PEER, { id });
        expect(calls.filter((c) => c.cmd === "UpdateCommand" && !String(c.input.ConditionExpression ?? "").includes("#lid") && String(c.input.Key?.id).startsWith("dminbox#"))).toHaveLength(0);
    });

    it("🔴 同じ id の再送で、相手が消した会話の行を復活させない（消したのがこの通より後なら作らない・まだ作っていなければ作る）", async () => {
        const id = "client-id-0002";
        const T = "2026-11-09T00:00:00.000Z";
        ccf = (cmd, input) => cmd === "UpdateCommand" && String(input.ConditionExpression ?? "").includes("#lid");
        // 相手（PEER=hi）が、この通より後に自分の側を消した
        rows[KEY] = { ...convRow([{ id, from: ME, text: "x", t: T }]), hiClearedAt: "2026-11-09T00:10:00.000Z" };
        rows[`dminbox#${PEER}`] = boxRow(PEER, {});
        await send("x", ME, PEER, { id });
        expect(calls.filter((c) => c.input.Key?.id === `dminbox#${PEER}` && String(c.input.UpdateExpression).includes("SET convs.#c = :entry")), "消した会話が復活した").toHaveLength(0);
        // 相手はまだ消していない（応答が落ちて行を作れなかった正当なケース）→ 作る
        calls = [];
        rows[KEY] = convRow([{ id, from: ME, text: "x", t: T }]);
        await send("x", ME, PEER, { id });
        const made = calls.filter((c) => c.input.Key?.id === `dminbox#${PEER}` && c.input.UpdateExpression === "SET convs.#c = :entry");
        expect(made).toHaveLength(1);
        expect(made[0].input.ExpressionAttributeValues[":entry"]).toMatchObject({ unread: 1, lastId: id });
    });

    it("🔴 会話数の上限: 相手の受信箱が満杯なら新しい会話を断る（既存の会話の続きは通す）", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        const full = Object.fromEntries(Array.from({ length: DM_CONVS_MAX }, (_, i) => [`c${i}`, entry(THIRD)]));
        rows[`dminbox#${PEER}`] = boxRow(PEER, full);
        const r = await send("こんにちは");
        expect(r.statusCode).toBe(409);
        expect(bodyOf(r).code).toBe("unavailable");
        expect(writes()).toHaveLength(0);

        // 既にある会話なら、満杯でも続きを送れる（行を増やさない）
        rows[`dminbox#${PEER}`] = boxRow(PEER, { ...full, [CONV]: entry(ME) });
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:00.000Z")]);
        expect((await send("続き")).statusCode).toBe(200);
    });

    it("🔴 自分の受信箱が満杯なら、自分の新しい会話を断る（古い会話を押し出さない）", async () => {
        follows(PEER, ME);
        const full = Object.fromEntries(Array.from({ length: DM_CONVS_MAX }, (_, i) => [`c${i}`, entry(THIRD)]));
        rows[`dminbox#${ME}`] = boxRow(ME, full);
        const r = await send("こんにちは");
        expect(r.statusCode).toBe(409);
        expect(bodyOf(r).code).toBe("selfFull");
        expect(writes()).toHaveLength(0);
    });

    it("上限の競り合い: 作る書き込みが条件で外れ、満杯と分かれば 409（行は増えない）", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        const full = Object.fromEntries(Array.from({ length: DM_CONVS_MAX }, (_, i) => [`c${i}`, entry(THIRD)]));
        ccf = (cmd, input) => {
            const id = (input.Key as { id?: string } | undefined)?.id;
            if (cmd !== "UpdateCommand" || id !== `dminbox#${PEER}`) return false;
            const cond = String(input.ConditionExpression ?? "");
            if (cond.startsWith("attribute_exists(convs")) { rows[`dminbox#${PEER}`] = boxRow(PEER, full); return true; }
            return cond.includes("size(convs)");
        };
        const r = await send("こんにちは");
        expect(r.statusCode).toBe(409);
        expect(bodyOf(r).code).toBe("unavailable");
        const create = calls.find((c) => String(c.input.ConditionExpression ?? "").includes("size(convs) < :cap"))!;
        expect(create.input.ExpressionAttributeValues[":cap"]).toBe(DM_INBOX_HARD_MAX);
        expect(create.input.ConditionExpression).toContain("attribute_not_exists(convs.#c)");
    });
});

describe("受信箱への書き込み", () => {
    it("🔴 未読は原子的な加算（相手: if_not_exists + :one・自分: 0 に戻す）・既存の行は条件つき", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        await send("こんにちは");
        const theirs = entryWrites(PEER)[0].input;
        expect(theirs.UpdateExpression).toContain("convs.#c.#u = if_not_exists(convs.#c.#u, :z) + :one");
        expect(theirs.ConditionExpression).toContain("attribute_exists(convs.#c)");
        expect(theirs.ConditionExpression, "同じ通で二度加算しない").toContain("convs.#c.#lid <> :id");
        expect(theirs.ConditionExpression, "古い通の再送で時刻を巻き戻さない").toContain("convs.#c.#t <= :t");
        expect(theirs.ExpressionAttributeNames["#c"]).toBe(CONV);
        const mine = entryWrites(ME)[0].input;
        expect(mine.UpdateExpression).toContain("convs.#c.#u = :z");
        expect(mine.UpdateExpression).not.toContain("if_not_exists(convs.#c.#u");
    });

    it("行が無い人には、map を用意してから上限つきで1行を足す（未読は 1）", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        ccf = (cmd, input) => cmd === "UpdateCommand" && (input.Key as { id: string }).id === `dminbox#${PEER}`
            && String(input.ConditionExpression ?? "").startsWith("attribute_exists(convs");
        expect((await send("こんにちは")).statusCode).toBe(200);
        const mine = calls.filter((c) => c.cmd === "UpdateCommand" && c.input.Key.id === `dminbox#${PEER}`);
        expect(mine[1].input.UpdateExpression).toContain("convs = if_not_exists(convs, :empty)");
        expect(mine[2].input.UpdateExpression).toBe("SET convs.#c = :entry");
        expect(mine[2].input.ExpressionAttributeValues[":entry"]).toMatchObject({ peer: ME, unread: 1, state: "inbox", excerpt: "こんにちは" });
    });

    it("受信箱の行は本文そのものではなく抜粋（40字）・改行は空白にする", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        await send(`${"あ".repeat(30)}\n${"い".repeat(30)}`);
        const x = entryWrites(PEER)[0].input.ExpressionAttributeValues[":x"] as string;
        expect(x.length).toBeLessThanOrEqual(40);
        expect(x).not.toContain("\n");
    });
});

describe("本体の追記", () => {
    it("既存の会話は『長さが読んだときのまま』を条件に追記する・競合したら読み直してやり直す", async () => {
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:00.000Z")]);
        let first = true;
        ccf = (cmd, input) => {
            if (cmd === "UpdateCommand" && (input.Key as { id: string }).id === KEY && first) { first = false; return true; }
            return false;
        };
        expect((await send("続き")).statusCode).toBe(200);
        const ups = convWrites().filter((c) => c.cmd === "UpdateCommand");
        expect(ups).toHaveLength(2);
        expect(ups[1].input.ConditionExpression).toBe("size(#items) = :len AND updatedAt = :prev");
        expect(ups[1].input.ExpressionAttributeValues[":prev"], "読んだときの更新時刻").toBe("2026-11-09T01:00:00.000Z");
        expect(ups[1].input.UpdateExpression).toContain("list_append(#items, :new)");
    });

    it("競合が続けば 409（黙って成功にしない）", async () => {
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:00.000Z")]);
        ccf = (cmd, input) => cmd === "UpdateCommand" && (input.Key as { id: string }).id === KEY;
        const r = await send("続き");
        expect(r.statusCode).toBe(409);
        expect(bodyOf(r).code).toBe("busy");
        expect(entryWrites(PEER)).toHaveLength(0);
    });

    it("🔴 200通を超えたら古い方から落とす（新しい1通は必ず入る）", async () => {
        const items = Array.from({ length: DM_MESSAGES_MAX }, (_, i) => msg(PEER, `m${i}`, `2026-11-09T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, `old-${String(i).padStart(4, "0")}`));
        rows[KEY] = convRow(items, { initiator: PEER });
        expect((await send("最新")).statusCode).toBe(200);
        const up = convWrites().find((c) => c.cmd === "UpdateCommand")!.input;
        const kept = up.ExpressionAttributeValues[":kept"] as { id: string; text: string }[];
        expect(kept).toHaveLength(DM_MESSAGES_MAX);
        expect(kept[0].id).toBe("old-0001");
        expect(kept.at(-1)!.text).toBe("最新");
        expect(up.UpdateExpression).toContain("#items = :kept");
    });

    it("バイト予算を超えるときも古い方から落とす（件数だけでは 400KB を守れない）", () => {
        const big = (i: number) => ({ id: `b-${i}`.padEnd(8, "_"), from: ME, text: "あ".repeat(500), t: `2026-11-09T00:00:${String(i).padStart(2, "0")}.000Z` });
        const existing = Array.from({ length: 40 }, (_, i) => big(i));
        const drop = overBudgetCount(existing, big(41));
        expect(drop).toBeGreaterThan(0);
        expect(Buffer.byteLength(JSON.stringify([...existing.slice(drop), big(41)]), "utf8")).toBeLessThanOrEqual(40 * 1024);
    });
});

describe("受信箱の一覧（GET /dm）", () => {
    it("新しい順・リクエストは未読数に含めない・ブロックの相手は隠す（消さない）・退会した人は名前を伏せる", async () => {
        const OLD = "44444444-4444-4444-8444-444444444444";
        const GONE = "55555555-5555-4555-8555-555555555555";
        rows[`dminbox#${ME}`] = boxRow(ME, {
            [CONV]: entry(PEER, { t: "2026-11-09T05:00:00.000Z", unread: 2, excerpt: "最新" }),
            [`${ME}_${THIRD}`]: entry(THIRD, { t: "2026-11-09T06:00:00.000Z", unread: 1, state: "request" }),
            [`${ME}_${OLD}`]: entry(OLD, { t: "2026-11-09T01:00:00.000Z", unread: 3 }),
            [`${ME}_${GONE}`]: entry(GONE, { t: "2026-11-09T04:00:00.000Z", unread: 1 }),
        });
        users[GONE] = { userId: GONE, deletedAt: "2026-11-01T00:00:00.000Z", username: "old_handle" };
        users[OLD] = { userId: OLD, displayName: "旅人Old" };
        users[THIRD] = { userId: THIRD, displayName: "旅人C" };
        mockHidden.mockResolvedValue(new Set([OLD]));
        const r = await invoke(handler, ev("GET /dm", ME));
        expect(r.statusCode).toBe(200);
        const b = bodyOf(r);
        expect(b.items.map((i: { peerId: string }) => i.peerId)).toEqual([THIRD, PEER, GONE]);
        expect(JSON.stringify(b)).not.toContain(OLD);
        expect(b.unread, "未読のある会話は PEER・GONE の2（リクエストと隠した相手は数えない）").toBe(2);
        expect(b.requestCount).toBe(1);
        const gone = b.items.find((i: { peerId: string }) => i.peerId === GONE);
        expect(gone).toMatchObject({ name: "退会したユーザー", deleted: true });
        expect(gone.username, "墓石の旧ハンドルを出さない").toBeUndefined();
        expect(b.items.find((i: { peerId: string }) => i.peerId === PEER)).toMatchObject({ name: "旅人B", username: "tabi_b", unread: 2, state: "inbox" });
        expect(r as unknown as { headers: Record<string, string> }).toMatchObject({ headers: { "Cache-Control": "private, no-store" } });
        expect(writes(), "隠すだけで消さない").toHaveLength(0);
    });

    it("ブロックの一覧が読めなければ 500（隠すべき会話を出さない）", async () => {
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        mockHidden.mockRejectedValue(new Error("boom"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect((await invoke(handler, ev("GET /dm", ME))).statusCode).toBe(500);
    });

    it("受信箱が空でも 200（空の一覧）", async () => {
        const r = await invoke(handler, ev("GET /dm", ME));
        expect(bodyOf(r)).toEqual({ items: [], unread: 0, requestCount: 0 });
    });
});

describe("会話を読む（GET /dm/{id}）", () => {
    beforeEach(() => {
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        rows[KEY] = convRow([
            msg(PEER, "古い", "2026-11-09T00:00:01.000Z", "m-old-0001"),
            msg(ME, "返事", "2026-11-09T00:00:02.000Z", "m-mine-001"),
            msg(PEER, "新しい", "2026-11-09T00:00:03.000Z", "m-new-0001"),
        ], { updatedAt: "2026-11-09T00:00:03.000Z" });
    });

    it("参加者でない・形の違う ID は 404", async () => {
        expect((await invoke(handler, ev("GET /dm/{id}", THIRD, { id: CONV }))).statusCode).toBe(404);
        expect((await invoke(handler, ev("GET /dm/{id}", ME, { id: "x" }))).statusCode).toBe(404);
    });

    it("自分の側から見た形（mine・相手の名前・送れるか）", async () => {
        const b = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV })));
        expect(b).toMatchObject({ id: CONV, peerId: PEER, name: "旅人B", state: "inbox", canSend: true });
        expect(b.items.map((m: { text: string; mine: boolean }) => [m.text, m.mine])).toEqual([["古い", false], ["返事", true], ["新しい", false]]);
    });

    it("🔴 ブロックの相手の会話は 404（両向き・消さない）", async () => {
        mockHidden.mockResolvedValue(new Set([PEER]));
        expect((await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV }))).statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
        mockHidden.mockResolvedValue(new Set());
        expect((await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV }))).statusCode, "解除すれば戻る").toBe(200);
    });

    it("自分の側を消した会話（受信箱に行が無い）は、本体が残っていても 404", async () => {
        rows[`dminbox#${ME}`] = boxRow(ME, {});
        expect((await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV }))).statusCode).toBe(404);
    });

    it("自分の側を消した時刻より前のメッセージは見せない（相手が続きを送っても過去は戻らない）", async () => {
        rows[KEY] = { ...(rows[KEY] as Row), loClearedAt: "2026-11-09T00:00:02.000Z" };
        const b = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV })));
        expect(b.items.map((m: { text: string }) => m.text)).toEqual(["新しい"]);
    });

    it("🔴 since: 変化なしは軽い空応答・変化があれば since より後だけ", async () => {
        const same = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV, since: "2026-11-09T00:00:03.000Z" })));
        expect(same).toEqual({ id: CONV, unchanged: true, items: [] });
        const some = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV, since: "2026-11-09T00:00:02.000Z" })));
        expect(some.items.map((m: { text: string }) => m.text)).toEqual(["新しい"]);
        const junk = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV, since: "???" })));
        expect(junk.items).toHaveLength(3);
    });

    it("承認待ちの3通を使い切った人は送れない（残り数を返す）・退会した相手にも送れない", async () => {
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: ME, reqCount: 3 });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "pending" }) });
        const b = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV })));
        expect(b).toMatchObject({ canSend: false, requestRemaining: 0, state: "pending" });

        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z")]);
        users[PEER] = { userId: PEER, deletedAt: "2026-11-01T00:00:00.000Z" };
        const g = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV })));
        expect(g).toMatchObject({ canSend: false, name: "退会したユーザー", deleted: true });
    });
});

describe("既読・承認", () => {
    it("既読は自分の行の未読だけを 0 にする（行が無ければ何もしないで 200）", async () => {
        expect((await invoke(handler, ev("PUT /dm/{id}/read", ME, { id: CONV, body: {} }))).statusCode).toBe(200);
        const u = writes()[0].input;
        expect(u.Key.id).toBe(`dminbox#${ME}`);
        expect(u.UpdateExpression).toBe("SET convs.#c.#u = :z");
        expect(u.ConditionExpression).toBe("attribute_exists(convs.#c)");
        calls = [];
        ccf = (cmd) => cmd === "UpdateCommand";
        expect((await invoke(handler, ev("PUT /dm/{id}/read", ME, { id: CONV, body: {} }))).statusCode).toBe(200);
        expect((await invoke(handler, ev("PUT /dm/{id}/read", THIRD, { id: CONV, body: {} }))).statusCode, "参加者でない人").toBe(404);
    });

    it("🔴 リクエストの承認: 本体・自分の行・始めた人の行が inbox になり、断りの印を外す（プッシュなし）", async () => {
        rows[KEY] = convRow([msg(PEER, "もしもし", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: PEER, reqCount: 1 });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "request", unread: 1 }) });
        const r = await invoke(handler, ev("POST /dm/{id}/accept", ME, { id: CONV, body: {} }));
        expect(r.statusCode).toBe(200);
        const w = writes();
        expect(w[0].input.Key.id).toBe(KEY);
        expect(w[0].input.UpdateExpression).toContain("#state = :inbox");
        expect(w[0].input.ConditionExpression).toBe("#state = :request");
        expect(w[1].input.Key.id).toBe(`dminbox#${ME}`);
        expect(w[1].input.UpdateExpression).toContain("REMOVE #dec");
        expect(w[1].input.ExpressionAttributeNames["#dec"]).toBe(`dec_${PEER}`);
        expect(w.some((c) => c.input.Key?.id === `dminbox#${PEER}`), "🔴 承認だけでは、送り主の行（見える状態）を変えない").toBe(false);
        expect(w).toHaveLength(2);
        expect(mockPushDm).not.toHaveBeenCalled();
    });

    it("始めた人は承認できない（400）・承認済みの押し直しは何も書かない・ブロックの相手は 404", async () => {
        rows[KEY] = convRow([], { state: "request", initiator: ME, reqCount: 1 });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "request" }) });
        expect((await invoke(handler, ev("POST /dm/{id}/accept", ME, { id: CONV, body: {} }))).statusCode).toBe(400);

        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "inbox" }) });
        rows[KEY] = convRow([], { state: "inbox", initiator: PEER });
        calls = [];
        expect((await invoke(handler, ev("POST /dm/{id}/accept", ME, { id: CONV, body: {} }))).statusCode).toBe(200);
        expect(writes()).toHaveLength(0);

        mockHidden.mockResolvedValue(new Set([PEER]));
        expect((await invoke(handler, ev("POST /dm/{id}/accept", ME, { id: CONV, body: {} }))).statusCode).toBe(404);
    });
});

describe("会話の削除", () => {
    it("🔴 片側: 自分の行を外し・自分の側を消した時刻を書く。相手に行が残っていれば本体は消さない", async () => {
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME) });
        const r = await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }));
        expect(r.statusCode).toBe(200);
        const w = writes();
        expect(w[0].input.Key.id).toBe(`dminbox#${ME}`);
        expect(w[0].input.UpdateExpression).toBe("REMOVE convs.#c");
        expect(w[1].input.Key.id).toBe(KEY);
        expect(w[1].input.UpdateExpression).toBe("SET loClearedAt = :now");
        expect(w.some((c) => c.cmd === "DeleteCommand"), "相手が持っているのに本体を消している").toBe(false);
    });

    it("🔴 両側: 相手の受信箱にも無ければ本体を物理削除する（読んだときの updatedAt が変わっていないときだけ）", async () => {
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        rows[`dminbox#${PEER}`] = boxRow(PEER, {});
        await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }));
        const del = writes().find((c) => c.cmd === "DeleteCommand")!;
        expect(del.input.Key.id).toBe(KEY);
        expect(del.input.ConditionExpression).toBe("updatedAt = :u");
        expect(del.input.ExpressionAttributeValues[":u"]).toBe("2026-11-09T01:00:00.000Z");
    });

    it("削除の間に相手が送っていたら（条件が外れたら）本体を消さずに 200", async () => {
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        ccf = (cmd) => cmd === "DeleteCommand";
        expect((await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }))).statusCode).toBe(200);
    });

    it("🔴 受け取ったリクエストを消す（断る）と、送り主の通数を相手の `dec_` に残す・本体は始めた人が持っているので消さない", async () => {
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: PEER, reqCount: 2 });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "request" }) });
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME, { state: "pending" }) });
        const r = await invoke(handler, ev("DELETE /dm/{id}/request", ME, { id: CONV }));
        expect(r.statusCode).toBe(200);
        const first = writes()[0].input;
        expect(first.UpdateExpression).toBe("REMOVE convs.#c SET #dec = :n");
        expect(first.ExpressionAttributeNames["#dec"]).toBe(`dec_${PEER}`);
        expect(first.ExpressionAttributeValues[":n"]).toBe(2);
        expect(writes().some((c) => c.cmd === "DeleteCommand")).toBe(false);
    });

    it("リクエストではない会話を『リクエスト削除』に渡すと 400（何も書かない）・参加者でなければ 404", async () => {
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        expect((await invoke(handler, ev("DELETE /dm/{id}/request", ME, { id: CONV }))).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
        expect((await invoke(handler, ev("DELETE /dm/{id}", THIRD, { id: CONV }))).statusCode).toBe(404);
    });

    it("退会した本人でも削除は通る（削除の系統）", async () => {
        mockReadLive.mockResolvedValue({ gone: { statusCode: 410, body: "{}" } });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        expect((await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }))).statusCode).toBe(200);
    });
});

describe("送信の取り消し（POST /dm/{id}/messages の { unsend }・2026-11-12）", () => {
    const A = msg(PEER, "やあ", "2026-11-09T00:00:01.000Z", "m-peer-0001");
    const B = msg(ME, "まちがい", "2026-11-09T00:00:02.000Z", "m-mine-0002");
    const unsend = (id: unknown, sub = ME) => invoke(handler, ev("POST /dm/{id}/messages", sub, { id: CONV, body: { unsend: id } }));
    const convUpdates = () => convWrites().filter((c) => String(c.input.UpdateExpression).startsWith("REMOVE #items["));
    const inboxWrites = (uid: string) => writes().filter((c) => c.input.Key?.id === `dminbox#${uid}`);

    beforeEach(() => {
        rows[KEY] = convRow([A, B], { updatedAt: B.t });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { t: B.t, excerpt: "まちがい", from: ME }) });
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME, { t: B.t, excerpt: "まちがい", unread: 1, from: ME }) });
        // 本体の取り消しを模型の行にも反映する（受信箱の直しは、取り消した後の本体を読む）
        ccf = (cmd, input) => {
            if (cmd === "UpdateCommand" && input.Key?.id === KEY && String(input.UpdateExpression).startsWith("REMOVE #items[")) {
                const row = rows[KEY] as Row & { items: { id: string }[] };
                const i = Number(/REMOVE #items\[(\d+)\]/.exec(String(input.UpdateExpression))![1]);
                rows[KEY] = { ...row, items: row.items.filter((_, j) => j !== i), updatedAt: input.ExpressionAttributeValues[":now"], unsentAt: input.ExpressionAttributeValues[":now"] };
            }
            return false;
        };
    });

    it("🔴 自分の1通を消す（その位置の id と updatedAt を条件に・跡を残さない）・本文を返さない", async () => {
        const r = await unsend(B.id);
        expect(r.statusCode).toBe(200);
        expect(r.body).not.toContain("まちがい");
        const [u] = convUpdates();
        expect(u.input.UpdateExpression).toBe("REMOVE #items[1] SET updatedAt = :now, unsentAt = :now, lastUnsent = :lu");
        expect(u.input.ExpressionAttributeValues[":lu"], "押し直しで未読を直す手がかり").toEqual({ id: B.id, fromEnd: 0 });
        expect(u.input.ConditionExpression).toBe("#items[1].#mid = :mid AND updatedAt = :prev");
        expect(u.input.ExpressionAttributeValues).toMatchObject({ ":mid": B.id, ":prev": B.t });
        // 「取り消しました」の通も印も足さない（本体に残るのは相手の1通だけ）
        expect((rows[KEY] as { items: unknown[] }).items).toEqual([A]);
        expect(writes().some((c) => c.cmd === "PutCommand"), "取り消しの跡を書いている").toBe(false);
    });

    it("🔴 受信箱: 抜粋と時刻を残った最後の通に戻し、相手の未読を1つ減らす（自分の行の未読は触らない）", async () => {
        await unsend(B.id);
        const [peerW] = inboxWrites(PEER);
        expect(peerW.input.ConditionExpression).toBe("convs.#c.#t = :t0 AND convs.#c.#u = :u0");
        expect(peerW.input.ExpressionAttributeValues).toMatchObject({ ":t": A.t, ":x": "やあ", ":lid": A.id, ":from": PEER, ":u": 0, ":t0": B.t, ":u0": 1 });
        const [meW] = inboxWrites(ME);
        expect(meW.input.ExpressionAttributeValues).toMatchObject({ ":t": A.t, ":x": "やあ", ":u": 0 });
    });

    it("相手がもう読んだ通（未読 0）・未読より前の通では未読を減らさない", async () => {
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME, { t: B.t, unread: 0 }) });
        await unsend(B.id);
        expect(inboxWrites(PEER)[0].input.ExpressionAttributeValues[":u"]).toBe(0);

        // 自分の通が2つ・相手の未読は1（新しい方だけ未読）。古い方を消しても未読はそのまま・抜粋も触らない
        calls = [];
        const C = msg(ME, "つづき", "2026-11-09T00:00:03.000Z", "m-mine-0003");
        rows[KEY] = convRow([A, B, C], { updatedAt: C.t });
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME, { t: C.t, unread: 1 }) });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { t: C.t }) });
        await unsend(B.id);
        expect(inboxWrites(PEER), "読んだ通・最後でない通で受信箱を書き換えている").toHaveLength(0);
        expect(inboxWrites(ME)).toHaveLength(0);
    });

    it("🔴 相手に見える通が無くなったら、相手の受信箱から会話ごと外す（自分の行は残し、抜粋を空に）", async () => {
        rows[KEY] = convRow([B], { updatedAt: B.t, state: "request", initiator: ME, reqCount: 1 });
        await unsend(B.id);
        const [peerW] = inboxWrites(PEER);
        // 承認前の会話を受け取った側の行を外すときは、断った印を同じ書き込みで残す（取り消し → 削除で通数を戻させない）
        expect(peerW.input.UpdateExpression).toBe("REMOVE convs.#c SET #dec = :n");
        expect(peerW.input.ExpressionAttributeNames["#dec"]).toBe(`dec_${ME}`);
        expect(peerW.input.ExpressionAttributeValues[":n"]).toBe(1);
        const [meW] = inboxWrites(ME);
        expect(meW.input.UpdateExpression).toBe("SET convs.#c.#x = :x, convs.#c.#u = :u, convs.#c.#uid = :mid REMOVE convs.#c.#f");
        expect(meW.input.ExpressionAttributeValues[":x"]).toBe("");
        // 本体は残す（承認前の通数 reqCount を消さない——取り消しで3通の歯止めを戻させない）
        expect(writes().some((c) => c.cmd === "DeleteCommand"), "本体を消して通数の歯止めを戻している").toBe(false);
    });

    it("🔴 他人の通は取り消せない（404・何も書かない）・参加者でない人・形の違う id も同じ", async () => {
        const other = await unsend(A.id);
        expect(other.statusCode).toBe(404);
        expect(writes(), "相手のメッセージを消している").toHaveLength(0);
        expect((await unsend(B.id, THIRD)).statusCode).toBe(404);
        expect((await unsend("x")).statusCode).toBe(400);
        expect((await unsend("a b c d e f g")).statusCode).toBe(400);
        expect((await unsend(123)).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("自分の側を消す前の通・自分の側を消した会話・ブロックの相手は 404（何も書かない）", async () => {
        rows[KEY] = { ...(rows[KEY] as Row), loClearedAt: B.t };
        expect((await unsend(B.id)).statusCode).toBe(404);
        rows[KEY] = convRow([A, B], { updatedAt: B.t });
        rows[`dminbox#${ME}`] = boxRow(ME, {});
        expect((await unsend(B.id)).statusCode).toBe(404);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        mockHidden.mockResolvedValue(new Set([PEER]));
        expect((await unsend(B.id)).statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
    });

    it("自分が取り消した通の押し直しは 200・本体は書かず、受信箱の直しだけやり直す（覚えた位置で未読を1回だけ減らす）", async () => {
        rows[KEY] = convRow([A], { updatedAt: B.t, lastUnsent: { id: B.id, fromEnd: 0 } });
        const r = await unsend(B.id);
        expect(r.statusCode).toBe(200);
        expect(convUpdates()).toHaveLength(0);
        expect(inboxWrites(PEER)[0].input.ExpressionAttributeValues).toMatchObject({ ":x": "やあ", ":u": 0, ":mid": B.id });
    });

    it("🔴 取り消した覚えの無い・もう無い通は、他人の通と同じ 404 messageNotFound（何も書かない）", async () => {
        rows[KEY] = convRow([A], { updatedAt: B.t });
        const gone = await unsend(B.id);
        const other = await unsend(A.id);
        expect([gone.statusCode, gone.body]).toEqual([other.statusCode, other.body]);
        expect(bodyOf(gone).code).toBe("messageNotFound");
        expect(writes()).toHaveLength(0);
    });

    it("同時の書き込みで条件が外れたら読み直してやり直す・続けば 409", async () => {
        let n = 0;
        const apply = ccf;
        ccf = (cmd, input) => {
            if (cmd === "UpdateCommand" && input.Key?.id === KEY && n++ === 0) return true;
            return apply(cmd, input);
        };
        expect((await unsend(B.id)).statusCode).toBe(200);
        expect(convUpdates()).toHaveLength(2);

        calls = [];
        rows[KEY] = convRow([A, B], { updatedAt: B.t });
        ccf = (cmd, input) => cmd === "UpdateCommand" && input.Key?.id === KEY;
        expect((await unsend(B.id)).statusCode).toBe(409);
    });

    it("退会した本人は取り消せない（書く口として 410）", async () => {
        mockReadLive.mockResolvedValueOnce({ gone: { statusCode: 410, body: "{}" } });
        expect((await unsend(B.id)).statusCode).toBe(410);
        expect(writes()).toHaveLength(0);
    });

    it("🔴 相手の読み直し: since より後に取り消しがあれば、差分ではなく全部を full で返す（無ければ今までどおり差分）", async () => {
        rows[KEY] = convRow([A], { updatedAt: "2026-11-09T00:00:05.000Z", unsentAt: "2026-11-09T00:00:05.000Z" });
        const full = bodyOf(await invoke(handler, ev("GET /dm/{id}", PEER, { id: CONV, since: B.t })));
        expect(full.full).toBe(true);
        expect(full.items.map((m: { id: string }) => m.id)).toEqual([A.id]);
        const after = bodyOf(await invoke(handler, ev("GET /dm/{id}", PEER, { id: CONV, since: "2026-11-09T00:00:05.000Z" })));
        expect(after).toEqual({ id: CONV, unchanged: true, items: [] });
        rows[KEY] = convRow([A, B], { updatedAt: B.t, unsentAt: "2026-11-09T00:00:00.500Z" });
        const diff = bodyOf(await invoke(handler, ev("GET /dm/{id}", PEER, { id: CONV, since: A.t })));
        expect(diff.full).toBeUndefined();
        expect(diff.items.map((m: { id: string }) => m.id)).toEqual([B.id]);
    });

    it("通報の写しは取り消しで消さない（通報の行に触れない）", async () => {
        rows[`dmreport#${CONV}#${PEER}`] = { id: `dmreport#${CONV}#${PEER}`, messages: [B] };
        await unsend(B.id);
        expect(writes().some((c) => String(c.input.Key?.id ?? "").startsWith("dmreport#")), "通報の写しを書き換えている").toBe(false);
    });
});

describe("通報（POST /dm/{id}/report）", () => {
    const many = () => Array.from({ length: 25 }, (_, i) =>
        msg(i % 2 ? ME : PEER, `本文${i}`, `2026-11-09T00:00:${String(i).padStart(2, "0")}.000Z`, `rep-${String(i).padStart(4, "0")}`));

    beforeEach(() => {
        rows[KEY] = convRow(many());
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
    });

    it("🔴 通報時点の直近20通を写して保存する（理由・補足つき・本文を返さない）", async () => {
        const r = await invoke(handler, ev("POST /dm/{id}/report", ME, { id: CONV, body: { reason: "harassment", note: " ひどい " } }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ success: true });
        const put = writes()[0].input;
        expect(put.Item.id).toBe(`dmreport#${CONV}#${ME}`);
        expect(put.Item).toMatchObject({ convId: CONV, reporterId: ME, reportedId: PEER, reason: "harassment", note: "ひどい" });
        expect(put.Item.messages).toHaveLength(DM_REPORT_LAST);
        expect(put.Item.messages[0].text).toBe("本文5");
        expect(put.Item.messages.at(-1).text).toBe("本文24");
        expect(put.ConditionExpression, "押し直しは上書き").toBeUndefined();
    });

    it("「未成年へのいやな接触・誘い出し」の理由を受ける・知らない理由は 400", async () => {
        expect((await invoke(handler, ev("POST /dm/{id}/report", ME, { id: CONV, body: { reason: "minor" } }))).statusCode).toBe(200);
        calls = [];
        expect((await invoke(handler, ev("POST /dm/{id}/report", ME, { id: CONV, body: { reason: "nope" } }))).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("ブロックした直後でも通報できる・参加者でない人と、自分の側を消した人は 404", async () => {
        mockHidden.mockResolvedValue(new Set([PEER]));
        expect((await invoke(handler, ev("POST /dm/{id}/report", ME, { id: CONV, body: { reason: "spam" } }))).statusCode).toBe(200);
        expect((await invoke(handler, ev("POST /dm/{id}/report", THIRD, { id: CONV, body: { reason: "spam" } }))).statusCode).toBe(404);
        rows[`dminbox#${ME}`] = boxRow(ME, {});
        expect((await invoke(handler, ev("POST /dm/{id}/report", ME, { id: CONV, body: { reason: "spam" } }))).statusCode).toBe(404);
    });

    it("自分の側を消した時刻より前のメッセージは写さない", async () => {
        rows[KEY] = { ...(rows[KEY] as Row), loClearedAt: "2026-11-09T00:00:22.000Z" };
        await invoke(handler, ev("POST /dm/{id}/report", ME, { id: CONV, body: { reason: "spam" } }));
        expect(writes()[0].input.Item.messages.map((m: { text: string }) => m.text)).toEqual(["本文23", "本文24"]);
    });
});

describe("退会の掃除（purgeDmFor）", () => {
    it("🔴 会話ごとに自分の側を外し、相手に行が無ければ本体を消し、受信箱を消す（通報の写しは消さない）", async () => {
        const OTHER = `${ME}_${THIRD}`;
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER), [OTHER]: entry(THIRD) });
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        rows[`dm#${ME}#${THIRD}`] = { ...convRow([], { hi: THIRD }), id: `dm#${ME}#${THIRD}`, hi: THIRD };
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME) });   // 相手は残している
        rows[`dminbox#${THIRD}`] = boxRow(THIRD, {});                   // こちらは相手も消している
        await purgeDmFor(ME);
        const w = writes();
        expect(w.filter((c) => c.cmd === "UpdateCommand").map((c) => c.input.Key.id).sort()).toEqual([KEY, `dm#${ME}#${THIRD}`].sort());
        expect(w.some((c) => c.input.UpdateExpression === "REMOVE convs.#c"), "受信箱は丸ごと消すので行ごとには外さない").toBe(false);
        const deletes = w.filter((c) => c.cmd === "DeleteCommand").map((c) => c.input.Key.id);
        expect(deletes).toContain(`dm#${ME}#${THIRD}`);
        expect(deletes, "相手が持っている会話は残る").not.toContain(KEY);
        expect(deletes).toContain(`dminbox#${ME}`);
        expect(deletes.filter((i: string) => i.startsWith("dmday#"))).toHaveLength(2);
        expect(deletes.some((i: string) => i.startsWith("dmreport#"))).toBe(false);
    });

    it("1つの会話で失敗しても、ほかの会話と受信箱の掃除は続ける・ログに本文を出さない", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        rows[KEY] = convRow([msg(PEER, SECRET, "2026-11-09T00:00:01.000Z")]);
        const real = mockSend.getMockImplementation()!;
        mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
            if (c.constructor.name === "UpdateCommand" && c.input.Key.id === KEY) throw Object.assign(new Error(SECRET), { name: "Boom" });
            return real(c);
        });
        await purgeDmFor(ME);
        expect(calls.some((c) => c.cmd === "DeleteCommand" && c.input.Key.id === `dminbox#${ME}`)).toBe(true);
        expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    });

    it("相手の画面には「退会したユーザー」と出る（会話は残る）", async () => {
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME) });
        users[ME] = { userId: ME, deletedAt: "2026-11-09T00:00:00.000Z", displayName: "出ないはず" };
        const b = bodyOf(await invoke(handler, ev("GET /dm", PEER)));
        expect(b.items[0]).toMatchObject({ peerId: ME, name: "退会したユーザー", deleted: true });
        expect(JSON.stringify(b)).not.toContain("出ないはず");
    });
});

describe("サーバーのログに本文を出さない", () => {
    let spies: ReturnType<typeof vi.spyOn>[];
    beforeEach(() => {
        spies = (["error", "warn", "log", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    });
    afterEach(() => vi.restoreAllMocks());
    const logged = () => JSON.stringify(spies.flatMap((s) => s.mock.calls));

    it("🔴 保存に失敗しても、プッシュに失敗しても、ログに本文が出ない（例外のメッセージにも本文が入っていても）", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        mockPushDm.mockRejectedValue(Object.assign(new Error(SECRET), { name: "PushBoom" }));
        expect((await send(SECRET)).statusCode).toBe(200);
        const real = mockSend.getMockImplementation()!;
        mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
            if (c.constructor.name === "PutCommand") throw Object.assign(new Error(`${SECRET} ${JSON.stringify(c.input)}`), { name: "ValidationException" });
            return real(c);
        });
        const r = await send(SECRET, ME, PEER, { id: "another-id-0001" });
        expect(r.statusCode).toBe(500);
        expect(r.body).not.toContain(SECRET);
        expect(logged()).not.toContain(SECRET);
        // 失敗のログは残っている（黙って握っていない）
        expect(spies.flatMap((s) => s.mock.calls).length).toBeGreaterThan(0);
    });
});

describe("ストーリーの返信からの写し", () => {
    const STORY = { id: "story-1", story: true, userId: PEER, src: "https://cdn/s.jpg", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const reply = (body: unknown) => invoke(postStoryReply, {
        requestContext: { authorizer: { jwt: { claims: { sub: ME } } } }, pathParameters: { id: "story-1" }, body: JSON.stringify(body),
    });
    beforeEach(() => {
        rows["story-1"] = STORY;
        follows(PEER, ME);
        follows(ME, PEER);
    });

    it("🔴 文字の返信は会話の最初の1通として写す（返信の id を鍵に・via=story・プッシュなし）", async () => {
        const r = await reply({ text: "きれいですね" });
        expect(r.statusCode).toBe(200);
        const replyId = bodyOf(r).reply.id as string;
        const put = convWrites().find((c) => c.cmd === "PutCommand")!;
        expect(put.input.Item.items[0]).toMatchObject({ id: replyId, from: ME, text: "きれいですね", via: "story" });
        expect(entryWrites(PEER)).toHaveLength(1);
        expect(mockPushDm, "返信の通知が別に出るので、写しではプッシュしない").not.toHaveBeenCalled();
        expect(mockPushNotification).toHaveBeenCalledTimes(1);
    });

    it("🔴 絵文字だけのリアクションは写さない（今までどおり消える）", async () => {
        const r = await reply({ emoji: "❤️" });
        expect(r.statusCode).toBe(200);
        expect(convWrites()).toHaveLength(0);
        expect(calls.some((c) => String(c.input.Key?.id ?? "").startsWith("dm"))).toBe(false);
    });

    it("🔴 写しに失敗しても（歯止め・上限・保存の失敗）、返信は成功のまま", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const real = mockSend.getMockImplementation()!;
        mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
            if (c.constructor.name === "PutCommand" && String(c.input.Item?.id ?? "").startsWith("dm#")) throw new Error("boom");
            return real(c);
        });
        const r = await reply({ text: "きれいですね" });
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).reply.text).toBe("きれいですね");
        vi.restoreAllMocks();
    });

    it("相手が自分をフォローしていなければ、写しはリクエストになる（URL の返信は写さない・返信は成功）", async () => {
        delete rows[`follow#${ME}#${PEER}`];
        const url = await reply({ text: "見て https://example.com" });
        expect(url.statusCode).toBe(200);
        expect(convWrites()).toHaveLength(0);
        const plain = await reply({ text: "いいですね" });
        expect(plain.statusCode).toBe(200);
        expect(convWrites().find((c) => c.cmd === "PutCommand")!.input.Item.state).toBe("request");
    });
});

describe("レビュー指摘の直し（2026-11-09）", () => {
    it("🔴 リクエストの枠はふつうの会話の枠と別（50件）: 溢れたら新しいリクエストだけ断り、直行の相手は通す", async () => {
        follows(PEER, ME);
        const reqs = Object.fromEntries(Array.from({ length: DM_REQUESTS_MAX }, (_, i) => [`r${i}`, entry(THIRD, { state: "request" })]));
        const some = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`c${i}`, entry(THIRD)]));
        rows[`dminbox#${PEER}`] = boxRow(PEER, { ...reqs, ...some });
        const r = await send("こんにちは");
        expect(r.statusCode).toBe(409);
        expect(bodyOf(r).code).toBe("unavailable");
        expect(writes(), "書く前に断る").toHaveLength(0);
        expect(dayWrites()).toHaveLength(0);
        // 相手が自分をフォローしている（ふつうの会話の枠）なら、リクエストで埋まっていても通る
        follows(ME, PEER);
        expect((await send("こんにちは")).statusCode).toBe(200);
    });

    it("リクエストを受け取っているだけでは、自分の新しい会話は断られない（枠は別）・ふつうの枠が満杯なら断る", async () => {
        follows(PEER, ME);
        rows[`dminbox#${ME}`] = boxRow(ME, Object.fromEntries(Array.from({ length: DM_REQUESTS_MAX }, (_, i) => [`r${i}`, entry(THIRD, { state: "request" })])));
        expect((await send("こんにちは")).statusCode).toBe(200);
        expect(DM_INBOX_HARD_MAX).toBe(DM_CONVS_MAX + DM_REQUESTS_MAX);
    });

    it("🔴 リクエストを全部削除: 受け取ったリクエストだけ外し、断った印を残す・ふつうの会話は残す", async () => {
        const A = "44444444-4444-4444-8444-444444444444";
        rows[`dminbox#${ME}`] = boxRow(ME, {
            [`${ME}_${PEER}`]: entry(PEER, { state: "request" }),
            [`${ME}_${THIRD}`]: entry(THIRD, { state: "request" }),
            [`${ME}_${A}`]: entry(A, { state: "inbox" }),
        });
        rows[`dm#${ME}#${PEER}`] = convRow([], { state: "request", initiator: PEER, reqCount: 2 });
        rows[`dm#${ME}#${THIRD}`] = { ...convRow([], { state: "request", initiator: THIRD, reqCount: 1 }), id: `dm#${ME}#${THIRD}`, hi: THIRD };
        const r = await invoke(handler, ev("DELETE /dm/requests", ME));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ ok: true, removed: 2 });
        const removes = writes().filter((c) => c.input.Key?.id === `dminbox#${ME}`);
        expect(removes).toHaveLength(2);
        for (const c of removes) expect(c.input.UpdateExpression).toContain("SET #dec = :n");
        expect(removes.some((c) => Object.values(c.input.ExpressionAttributeNames).includes(`${ME}_${A}`))).toBe(false);
    });

    it("🔴 断った印は100人まで: 越えるときは通数の小さいものから外す", async () => {
        const declined = Object.fromEntries(Array.from({ length: DM_DECLINED_MAX }, (_, i) => [`dec_${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, i === 0 ? 1 : 3]));
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: PEER, reqCount: 1 });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "request" }) }, declined);
        await invoke(handler, ev("DELETE /dm/{id}/request", ME, { id: CONV }));
        const u = writes()[0].input;
        expect(u.UpdateExpression).toContain(", #ev0");
        expect(u.ExpressionAttributeNames["#ev0"], "通数の最も小さい（1通）印を外す").toBe("dec_00000000-0000-4000-8000-000000000000");
        expect(u.UpdateExpression).not.toContain("#ev1");
    });

    it("🔴 競合のやり直しで時刻を取り直す（古い時刻のまま書かない）", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            vi.setSystemTime(new Date("2026-11-09T02:00:00.000Z"));
            rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:00.000Z")]);
            let first = true;
            ccf = (cmd, input) => {
                if (cmd === "UpdateCommand" && (input.Key as { id: string }).id === KEY && first) {
                    first = false;
                    vi.setSystemTime(new Date("2026-11-09T02:00:05.000Z"));
                    return true;
                }
                return false;
            };
            await send("続き");
            const ups = convWrites().filter((c) => c.cmd === "UpdateCommand");
            expect(ups[0].input.ExpressionAttributeValues[":now"]).toBe("2026-11-09T02:00:00.000Z");
            expect(ups[1].input.ExpressionAttributeValues[":now"]).toBe("2026-11-09T02:00:05.000Z");
            expect((ups[1].input.ExpressionAttributeValues[":new"] as { t: string }[])[0].t).toBe("2026-11-09T02:00:05.000Z");
        } finally { vi.useRealTimers(); }
    });

    it("🔴 満杯の会話の同時送信: 条件は更新時刻つき（長さが同じでも、先に書かれたら外れる）", async () => {
        const items = Array.from({ length: DM_MESSAGES_MAX }, (_, i) => msg(PEER, `m${i}`, `2026-11-09T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`, `old-${String(i).padStart(4, "0")}`));
        rows[KEY] = convRow(items, { initiator: PEER, updatedAt: "2026-11-09T01:00:00.000Z" });
        await send("最新");
        const up = convWrites().find((c) => c.cmd === "UpdateCommand")!.input;
        expect(up.ConditionExpression).toContain("updatedAt = :prev");
        expect(up.ExpressionAttributeValues[":prev"]).toBe("2026-11-09T01:00:00.000Z");
    });

    it("🔴 URL の言い換え・短縮ドメイン・見えない文字", () => {
        for (const t of ["discord.gg/abc", "youtu.be/xyz", "lin.ee/abc", "amzn.asia/x", "bit.ly/a", "t.co/abc", "goo.gl/x",
            "example。com", "example . com", "example[.]com", "example(dot)com", "example (dot) com", "exa\u200Bmple.com", "ex\u00ADample.com", "ｅｘａｍｐｌｅ［．］ｃｏｍ"]) {
            expect(containsUrl(t), t).toBe(true);
        }
        for (const t of ["こんにちは。元気ですか", "Thanks. To be honest", "3.5mm", "写真きれいでした"]) expect(containsUrl(t), t).toBe(false);
    });

    it("見えない文字だけの本文は空として 400・文字の間の見えない文字は落とす", async () => {
        follows(PEER, ME);
        expect(cleanDmText("\u200B\u200E\u202E\u2060\uFEFF\u00AD")).toBe("");
        expect(cleanDmText("こ\u200Bん\u202Eにちは")).toBe("こんにちは");
        const r = await send("\u200B\u200B");
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).code).toBe("empty");
        expect(writes()).toHaveLength(0);
    });

    it("🔴 送り主に見える状態は、リクエストでも直行でも同じ（pending）・相手が話したら inbox", async () => {
        follows(PEER, ME);
        const req = await send("こんにちは");
        calls = []; rows = {}; follows(PEER, ME); follows(ME, PEER);
        const direct = await send("こんにちは");
        expect(bodyOf(req).state).toBe("pending");
        expect(bodyOf(direct).state).toBe("pending");
        // 相手（PEER）が話したあとの自分の送信は inbox
        calls = [];
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z"), msg(PEER, "b", "2026-11-09T00:00:02.000Z")]);
        expect(bodyOf(await send("c")).state).toBe("inbox");
    });

    it("退会の掃除は時間の予算を持つ（切れたら受信箱の行を残して打ち切る）", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        await purgeDmFor(ME, -1);
        expect(writes(), "予算が無いのに掃除している").toHaveLength(0);
        vi.restoreAllMocks();
    });

    it("退会の掃除は、フォローの掃除より後ろで呼ぶ", async () => {
        const { readFileSync } = await import("fs");
        const src = readFileSync(`${process.cwd()}/api-user/src/account.ts`, "utf8").length ? readFileSync(`${process.cwd()}/api-user/src/account.ts`, "utf8") : "";
        expect(src.indexOf("await purgeDmFor"), "purgeDmFor が見つからない").toBeGreaterThan(0);
        expect(src.indexOf("await purgeDmFor")).toBeGreaterThan(src.indexOf("keeping following#"));
    });

    it("🔴 削除の失敗: 経路（map）が無い種類だけ通し、式の誤りは隠さない", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        const boom = (message: string) => {
            const real = mockSend.getMockImplementation()!;
            mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
                if (c.constructor.name === "UpdateCommand" && c.input.Key.id === `dminbox#${ME}`) throw Object.assign(new Error(message), { name: "ValidationException" });
                return real(c);
            });
        };
        boom("The document path provided in the update expression is invalid for update");
        expect((await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }))).statusCode).toBe(200);
        boom("Invalid UpdateExpression: Syntax error");
        expect((await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }))).statusCode).toBe(500);
        vi.restoreAllMocks();
    });
});

describe("全員に同じ規則（owner 判断 2026-11-09）", () => {
    /** 同じ操作を、リクエストになる相手と直行の相手の2つの世界で流して、送り主に返る応答を並べる */
    async function both(run: () => Promise<Result>, prep: (direct: boolean) => void) {
        const out: Result[] = [];
        for (const direct of [false, true]) {
            rows = {}; calls = [];
            follows(PEER, ME);
            if (direct) follows(ME, PEER);
            prep(direct);
            out.push(await run());
        }
        return out;
    }

    it("🔴 直行の相手にも、承認前は3通まで（4通目は同じ 429・同じ文面）", async () => {
        const [req, dir] = await both(() => send("4通目"), (direct) => {
            rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: ME, reqCount: DM_REQUEST_MAX, direct });
        });
        expect(req.statusCode).toBe(429);
        expect(dir.statusCode).toBe(429);
        expect(dir.body).toBe(req.body);
        expect(bodyOf(dir).code).toBe("requestLimit");
    });

    it("🔴 直行の相手の会話でも、承認前は2通目以降も URL を断る（同じ 400・同じ文面）", async () => {
        const [req, dir] = await both(() => send("見て https://example.com"), (direct) => {
            rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: ME, reqCount: 1, direct });
        });
        expect(req.statusCode).toBe(400);
        expect(dir.body).toBe(req.body);
        expect(bodyOf(dir).code).toBe("requestUrl");
    });

    it("🔴 新しい会話の応答の形は、関係で変わらない（state・文面・ステータス）", async () => {
        const [req, dir] = await both(() => send("こんにちは"), () => undefined);
        expect(Object.keys(bodyOf(dir)).sort()).toEqual(Object.keys(bodyOf(req)).sort());
        expect(bodyOf(dir).state).toBe(bodyOf(req).state);
        expect(dir.statusCode).toBe(req.statusCode);
    });

    it("🔴 違うのは受け取る側の置き場所と通知だけ（直行: 受信箱の行・プッシュあり／それ以外: リクエストの棚・プッシュなし）", async () => {
        follows(PEER, ME);
        await send("こんにちは");
        expect(entryWrites(PEER)[0].input.ExpressionAttributeValues[":s"]).toBe("request");
        expect(mockPushDm).not.toHaveBeenCalled();
        rows = {}; calls = []; follows(PEER, ME); follows(ME, PEER);
        await send("こんにちは");
        expect(entryWrites(PEER)[0].input.ExpressionAttributeValues[":s"]).toBe("inbox");
        expect(mockPushDm).toHaveBeenCalledTimes(1);
        // 続きのメッセージでも、直行の相手の置き場所は受信箱のまま
        calls = [];
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: ME, reqCount: 1, direct: true });
        await send("2通目");
        expect(entryWrites(PEER)[0].input.ExpressionAttributeValues[":s"]).toBe("inbox");
    });

    it("🔴 会話の読みでも、始めた人には相手が話すまで残り数を見せる（直行でも同じ）・話したら外れる", async () => {
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "pending" }) });
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: ME, reqCount: 1, direct: true });
        const g = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV })));
        expect(g).toMatchObject({ requestRemaining: 2, canSend: true, state: "pending" });
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:01.000Z"), msg(PEER, "b", "2026-11-09T00:00:02.000Z")], { state: "inbox", initiator: ME, reqCount: 1, direct: true });
        const h = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV })));
        expect(h.requestRemaining).toBeUndefined();
        expect(h.canSend).toBe(true);
    });

    it("🔴 承認だけでは送り主に見える状態を変えず、上限だけが外れる／受け取った人の返信で状態が変わる", async () => {
        // 承認（accept）: 本体が inbox になるが、送り主の行は触らない
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: PEER, reqCount: DM_REQUEST_MAX, direct: true });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "inbox" }) });
        await invoke(handler, ev("POST /dm/{id}/accept", ME, { id: CONV, body: {} }));
        expect(writes().some((c) => c.input.Key?.id === `dminbox#${PEER}`)).toBe(false);
        expect(writes()[0].input.Key.id, "直行の相手（受信箱の行は inbox）でも、本体の承認は書く").toBe(KEY);
        expect(writes()[0].input.UpdateExpression).toContain("#state = :inbox");
        // 承認後は、送り主（PEER）の4通目が通る（上限が外れる）。状態は pending のまま（相手が話していない）
        calls = [];
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")], { state: "inbox", initiator: PEER, reqCount: DM_REQUEST_MAX, direct: true });
        const r = await send("4通目", PEER, ME);
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).state).toBe("pending");
        // 受け取った人（ME）の返信: 始めた人（PEER）の行が inbox になる
        calls = [];
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: PEER, reqCount: 1, direct: true });
        await send("返事");
        expect(entryWrites(PEER)[0].input.ExpressionAttributeValues[":s"]).toBe("inbox");
    });

    it("🔴 直行の相手が承認前の会話を消しても、送った通数を断った印に残す（再送で戻らない）", async () => {
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")], { state: "request", initiator: PEER, reqCount: 2, direct: true });
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER, { state: "inbox" }) });
        await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }));
        const u = writes()[0].input;
        expect(u.UpdateExpression).toContain("SET #dec = :n");
        expect(u.ExpressionAttributeValues[":n"]).toBe(2);
        // 承認後（inbox）の会話を消しても、印は付けない
        calls = [];
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")], { state: "inbox", initiator: PEER, reqCount: 2 });
        await invoke(handler, ev("DELETE /dm/{id}", ME, { id: CONV }));
        expect(writes()[0].input.UpdateExpression).toBe("REMOVE convs.#c");
    });

    it("🔴 断られた印は、直行の相手への新しい会話にも効く", async () => {
        follows(PEER, ME);
        follows(ME, PEER);
        rows[`dminbox#${PEER}`] = boxRow(PEER, {}, { [`dec_${ME}`]: DM_REQUEST_MAX });
        const r = await send("もう一度");
        expect(r.statusCode).toBe(429);
        expect(bodyOf(r).code).toBe("requestLimit");
    });
});

describe("経路の登録", () => {
    it("未知の経路は 404・本体の読めない JSON は 400（書く口）", async () => {
        expect((await invoke(handler, ev("GET /dm/{id}/nothing", ME))).statusCode).toBe(404);
        expect((await invoke(handler, { ...ev("POST /dm/{id}/report", ME, { id: CONV }), body: "{x" })).statusCode).toBe(400);
    });

    it("続きの送信（POST /dm/{id}/messages）は会話 ID から相手を決める", async () => {
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        const r = await invoke(handler, ev("POST /dm/{id}/messages", ME, { id: CONV, body: { text: "続き" } }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).conversationId).toBe(CONV);
        expect((await invoke(handler, ev("POST /dm/{id}/messages", THIRD, { id: CONV, body: { text: "x" } }))).statusCode).toBe(404);
    });

    it("sendDm を直に呼ぶ（ストーリー返信の写しの入口）と、自分宛ては 400", async () => {
        const r = await sendDm({ me: ME, to: ME, text: "x", push: false, myName: "n" });
        expect(r).toMatchObject({ ok: false, status: 400 });
    });
});

// ---------------------------------------------------------------------------
// 2026-11-10: iOS の DM 画面のために足した欄（どれも後方互換）
// ---------------------------------------------------------------------------

describe("受信箱の行: 最後の1通を送った人（lastMine）", () => {
    it("🔴 送信は両側の行に送り主（from）を書く（更新・作成のどちらでも）", async () => {
        follows(PEER, ME);
        // 行が無い（更新の条件 `attribute_exists(convs.#c)` が外れる）→ 作成の経路を通る
        ccf = (cmd, input) => cmd === "UpdateCommand" && String(input.ConditionExpression ?? "").includes("#lid");
        expect((await send("こんにちは")).statusCode).toBe(200);
        const made = calls.filter((c) => c.cmd === "UpdateCommand" && c.input.UpdateExpression === "SET convs.#c = :entry");
        expect(made.length).toBe(2);
        for (const m of made) expect(m.input.ExpressionAttributeValues[":entry"].from, "作成の行に送り主が無い").toBe(ME);
        for (const uid of [ME, PEER]) {
            const w = entryWrites(uid)[0];
            expect(w.input.UpdateExpression).toContain("convs.#c.#f = :from");
            expect(w.input.ExpressionAttributeNames["#f"]).toBe("from");
            expect(w.input.ExpressionAttributeValues[":from"], "更新の行の送り主が違う").toBe(ME);
        }
    });

    it("🔴 GET /dm の各行に lastMine（自分なら true・相手なら false・欄の無い古い行は出さない）", async () => {
        users[THIRD] = { userId: THIRD, displayName: "旅人C" };
        const OLD = "44444444-4444-4444-8444-444444444444";
        users[OLD] = { userId: OLD, displayName: "旅人Old" };
        rows[`dminbox#${ME}`] = boxRow(ME, {
            [CONV]: entry(PEER, { t: "2026-11-09T05:00:00.000Z", from: ME }),
            [`${ME}_${THIRD}`]: entry(THIRD, { t: "2026-11-09T04:00:00.000Z", from: THIRD }),
            [`${ME}_${OLD}`]: entry(OLD, { t: "2026-11-09T03:00:00.000Z" }),
        });
        const b = bodyOf(await invoke(handler, ev("GET /dm", ME)));
        const by = (id: string) => b.items.find((i: { peerId: string }) => i.peerId === id);
        expect(by(PEER).lastMine).toBe(true);
        expect(by(THIRD).lastMine).toBe(false);
        expect("lastMine" in by(OLD), "分からない行に値を作っている").toBe(false);
    });
});

describe("会話の引用札（ストーリーへの返信から写した通・story）", () => {
    const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();
    const storyRow = (o: Row = {}) => ({ id: "story-1", story: true, userId: PEER, src: "https://cdn/s.jpg", mediaType: "image", expiresAt: FUTURE(), ...o });
    const quoted = (o: Row = {}) => ({ ...msg(ME, "きれい", "2026-11-09T00:00:01.000Z", "m-story-01"), via: "story", storyId: "story-1", ...o });
    const read = async (uid = ME) => bodyOf(await invoke(handler, ev("GET /dm/{id}", uid, { id: CONV })));
    beforeEach(() => {
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME) });
        rows[KEY] = convRow([quoted(), msg(PEER, "ありがとう", "2026-11-09T00:00:02.000Z", "m-plain-01")], { updatedAt: "2026-11-09T00:00:02.000Z" });
        rows["story-1"] = storyRow();
        follows(PEER, ME);
    });

    it("🔴 見られる間は live（写真の URL・期限）。返信した人も投稿者も", async () => {
        const mine = await read(ME);
        expect(mine.items[0]).toMatchObject({ via: "story", storyId: "story-1", story: { id: "story-1", state: "live", mediaType: "image", src: "https://cdn/s.jpg" } });
        expect(mine.items[0].story.expiresAt).toBe((rows["story-1"] as Row).expiresAt);
        expect(mine.items[1].story, "ストーリーと関係ない通に札を付けている").toBeUndefined();
        expect(mine.items[1].storyId).toBeUndefined();
        const owner = await read(PEER);
        expect(owner.items[0].story).toMatchObject({ state: "live", src: "https://cdn/s.jpg" });
    });

    it("🔴 期限切れ・棚へ移った・消えたストーリーは ended（絵を返さない）", async () => {
        for (const row of [storyRow({ expiresAt: "2026-01-01T00:00:00.000Z" }), storyRow({ archivedAt: "2026-11-09T00:00:00.000Z" }), undefined]) {
            if (row) rows["story-1"] = row; else delete rows["story-1"];
            const b = await read(ME);
            expect(b.items[0].story, JSON.stringify(row)).toEqual({ id: "story-1", state: "ended" });
            expect(b.items[0].storyId).toBe("story-1");
        }
    });

    it("🔴 返信した人がもうフォローしていない・親しい友達から外れた → ended（投稿者本人は見える）", async () => {
        delete rows[`follow#${PEER}#${ME}`];
        expect((await read(ME)).items[0].story, "フォローを外した人に絵を返している").toEqual({ id: "story-1", state: "ended" });
        follows(PEER, ME);
        rows["story-1"] = storyRow({ audience: "closeFriends" });
        expect((await read(ME)).items[0].story, "親しい友達でない人に絵を返している").toEqual({ id: "story-1", state: "ended" });
        rows[`closefriends#${PEER}`] = { id: `closefriends#${PEER}`, list: [ME] };
        expect((await read(ME)).items[0].story.state).toBe("live");
        delete rows[`closefriends#${PEER}`];
        expect((await read(PEER)).items[0].story.state, "投稿者本人に見せていない").toBe("live");
    });

    it("動画は絵を返さない・会話の2人以外のストーリーは ended", async () => {
        rows["story-1"] = storyRow({ mediaType: "video", src: "https://cdn/s.mp4" });
        const v = (await read(ME)).items[0].story;
        expect(v).toMatchObject({ state: "live", mediaType: "video" });
        expect(v.src, "動画の URL をサムネイルの欄に入れている").toBeUndefined();
        rows["story-1"] = storyRow({ userId: THIRD });
        follows(THIRD, ME);
        expect((await read(ME)).items[0].story.state).toBe("ended");
    });

    it("ストーリーが読めなくても会話は返す（札は ended）・ストーリーの通が無ければ読みに行かない", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const real = mockSend.getMockImplementation()!;
        mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
            if (c.constructor.name === "GetCommand" && c.input.Key.id === "story-1") throw new Error("boom");
            return real(c);
        });
        const r = await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).items[0].story).toEqual({ id: "story-1", state: "ended" });
        mockSend.mockImplementation(real);
        vi.restoreAllMocks();

        rows[KEY] = convRow([msg(PEER, "ふつう", "2026-11-09T00:00:02.000Z", "m-plain-02")], { updatedAt: "2026-11-09T00:00:02.000Z" });
        calls = [];
        await read(ME);
        expect(calls.some((c) => String(c.input.Key?.id ?? "").startsWith("story-")), "要らない読みをしている").toBe(false);
    });

    describe("🔴 写真を紹介したストーリー（sharedPhotoId・#541）", () => {
        const photo = (o: Row = {}) => ({ id: "p-shared", src: "https://cdn/p.jpg", userId: THIRD, ...o });
        beforeEach(() => {
            rows["story-1"] = storyRow({ sharedPhotoId: "p-shared" });
            rows["p-shared"] = photo();
            mockHidden.mockResolvedValue(new Set<string>());
            mockDeleted.mockReturnValue({ deleted: new Set<string>(), unread: new Set<string>() });
        });
        afterEach(() => { mockHidden.mockReset().mockResolvedValue(new Set<string>()); });

        it("紹介した写真が見られる間は live", async () => {
            expect((await read(ME)).items[0].story.state).toBe("live");
        });

        const lost: [string, () => void][] = [
            ["持ち主が非公開にした", () => { rows["p-shared"] = photo({ published: false }); }],
            ["持ち主が範囲を絞った", () => { rows["p-shared"] = photo({ audience: "followers" }); }],
            ["持ち主が消した", () => { delete rows["p-shared"]; }],
            ["持ち主が退会した", () => { mockDeleted.mockReturnValue({ deleted: new Set([THIRD]), unread: new Set<string>() }); }],
            ["見る人と持ち主のあいだにブロック", () => { mockHidden.mockResolvedValue(new Set([THIRD])); }],
        ];
        for (const [label, arrange] of lost) {
            it(`${label}: 見る人には ended（紹介した本人には live）`, async () => {
                vi.spyOn(console, "error").mockImplementation(() => undefined);
                arrange();
                expect((await read(ME)).items[0].story, "見られない写真を DM の札に出している").toEqual({ id: "story-1", state: "ended" });
                expect((await read(PEER)).items[0].story.state, "紹介した本人に見せていない").toBe("live");
                vi.restoreAllMocks();
            });
        }

        it("見る人のブロック一覧は会話の読みで読んだものを使う（読み直さない）", async () => {
            mockHidden.mockClear();
            await read(ME);
            expect(mockHidden).toHaveBeenCalledTimes(1);
        });

        it("紹介した写真が読めなければ ended", async () => {
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            const real = mockSend.getMockImplementation()!;
            mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
                if (c.constructor.name === "GetCommand" && c.input.Key.id === "p-shared") throw new Error("boom");
                return real(c);
            });
            expect((await read(ME)).items[0].story).toEqual({ id: "story-1", state: "ended" });
            mockSend.mockImplementation(real);
            vi.restoreAllMocks();
        });
    });

    it("since の読み直しは、返す通のぶんだけ引く", async () => {
        const b = bodyOf(await invoke(handler, ev("GET /dm/{id}", ME, { id: CONV, since: "2026-11-09T00:00:01.500Z" })));
        expect(b.items.map((m: { text: string }) => m.text)).toEqual(["ありがとう"]);
        expect(calls.some((c) => String(c.input.Key?.id ?? "").startsWith("story-"))).toBe(false);
    });

    it("🔴 ストーリーでない行（ふつうの写真）は ended（絵を返さない）", async () => {
        rows["story-1"] = { id: "story-1", userId: PEER, src: "https://cdn/photo.jpg", published: true };
        expect((await read(ME)).items[0].story).toEqual({ id: "story-1", state: "ended" });
        rows["story-1"] = storyRow({ story: "true" });
        expect((await read(ME)).items[0].story.state, "story が true でない行を通している").toBe("ended");
    });

    it("🔴 親しい友達の名簿は投稿者ごとに1回だけ読む（強い読みをストーリーの数だけ投げない）", async () => {
        rows[`closefriends#${PEER}`] = { id: `closefriends#${PEER}`, list: [ME] };
        const many = Array.from({ length: 5 }, (_, i) => {
            const sid = `story-c${i}`;
            rows[sid] = storyRow({ id: sid, audience: "closeFriends" });
            return quoted({ id: `m-close-${String(i).padStart(3, "0")}`, storyId: sid, t: `2026-11-09T00:01:0${i}.000Z` });
        });
        rows[KEY] = convRow(many, { updatedAt: "2026-11-09T00:02:00.000Z" });
        calls = [];
        const b = await read(ME);
        expect(b.items.every((m: { story: { state: string } }) => m.story.state === "live")).toBe(true);
        const reads = calls.filter((c) => c.cmd === "GetCommand" && c.input.Key.id === `closefriends#${PEER}`);
        expect(reads, "名簿をストーリーの数だけ読んでいる").toHaveLength(1);
        expect(reads[0].input.ConsistentRead, "名簿は強い読みのまま").toBe(true);
        // 全員向けだけなら名簿を読まない
        rows[KEY] = convRow([quoted()], { updatedAt: "2026-11-09T00:02:00.000Z" });
        calls = [];
        await read(ME);
        expect(calls.some((c) => c.input.Key?.id === `closefriends#${PEER}`)).toBe(false);
    });

    it("🔴 上限で選ぶのは「最後に出てきた」のが新しい方（古いストーリーに最近返信があれば落とさない）", async () => {
        rows["story-old"] = storyRow({ id: "story-old" });
        const items = [quoted({ id: "m-old-first", storyId: "story-old", t: "2026-11-09T00:00:00.500Z" })];
        for (let i = 0; i < QUOTE_LOOKUP_MAX; i++) {
            const sid = `story-${String(i).padStart(2, "0")}`;
            rows[sid] = storyRow({ id: sid });
            items.push(quoted({ id: `m-story-${String(i).padStart(3, "0")}`, storyId: sid, t: `2026-11-09T00:01:${String(i).padStart(2, "0")}.000Z` }));
        }
        items.push(quoted({ id: "m-old-again", storyId: "story-old", t: "2026-11-09T00:03:00.000Z" }));
        rows[KEY] = convRow(items, { updatedAt: "2026-11-09T00:03:00.000Z" });
        const b = await read(ME);
        const at = (id: string) => b.items.find((m: { id: string }) => m.id === id);
        expect(at("m-old-again").story?.state, "最近返信のあった古いストーリーを落としている").toBe("live");
        expect(at("m-old-first").story?.state).toBe("live");
        expect(at("m-story-000").story, "最後に出てきたのが最も古いものを落とす").toBeUndefined();
        expect(at("m-story-001").story.state).toBe("live");
    });

    it("🔴 photos の表は1件ずつ GetItem で読む（BatchGetItem の権限が無い）・引くのは新しい方から上限まで", async () => {
        const many = Array.from({ length: QUOTE_LOOKUP_MAX + 3 }, (_, i) => {
            const sid = `story-${String(i).padStart(2, "0")}`;
            rows[sid] = storyRow({ id: sid });
            return quoted({ id: `m-story-${String(i).padStart(3, "0")}`, storyId: sid, t: `2026-11-09T00:01:${String(i).padStart(2, "0")}.000Z` });
        });
        rows[KEY] = convRow(many, { updatedAt: "2026-11-09T00:02:00.000Z" });
        calls = [];
        const b = await read(ME);
        expect(calls.some((c) => c.cmd === "BatchGetCommand" && c.input.RequestItems["photos-test"]), "権限の無い BatchGetItem を使っている").toBe(false);
        const looked = calls.filter((c) => c.cmd === "GetCommand" && String(c.input.Key.id).startsWith("story-"));
        expect(looked).toHaveLength(QUOTE_LOOKUP_MAX);
        expect(b.items[0].story, "上限を越えた古い通に ended を付けている（分からないのに終わったと言う）").toBeUndefined();
        expect(b.items[0].storyId).toBe("story-00");
        expect(b.items.at(-1).story.state).toBe("live");
    });
});

describe("ストーリーへの返信: 写った会話・お知らせの欄", () => {
    const STORY = { id: "story-1", story: true, userId: PEER, src: "https://cdn/s.jpg", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const reply = (body: unknown) => invoke(postStoryReply, {
        requestContext: { authorizer: { jwt: { claims: { sub: ME } } } }, pathParameters: { id: "story-1" }, body: JSON.stringify(body),
    });
    const lastNotif = () => mockPushNotification.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    beforeEach(() => {
        rows["story-1"] = STORY;
        follows(PEER, ME);
        follows(ME, PEER);
    });

    it("🔴 写った通にストーリーの id を残す", async () => {
        await reply({ text: "きれいですね" });
        const put = convWrites().find((c) => c.cmd === "PutCommand")!;
        expect(put.input.Item.items[0]).toMatchObject({ via: "story", storyId: "story-1" });
    });

    it("🔴 応答: 写ったら dm.conversationId、絵文字だけなら dm: null と reaction", async () => {
        const t = bodyOf(await reply({ text: "きれいですね" }));
        expect(t.dm).toEqual({ conversationId: CONV });
        expect(t.dmSkipped).toBeUndefined();
        const e = bodyOf(await reply({ emoji: "❤️" }));
        expect(e.dm).toBeNull();
        expect(e.dmSkipped).toBe("reaction");
    });

    it("🔴 応答: 写らなかったら dm: null と理由（URL）。相手の置き場所（リクエストか）は出さない", async () => {
        delete rows[`follow#${ME}#${PEER}`];
        const u = bodyOf(await reply({ text: "見て https://example.com" }));
        expect(u).toMatchObject({ success: true, dm: null, dmSkipped: "requestUrl" });
        const r = bodyOf(await reply({ text: "いいですね" }));
        expect(r.dm, "リクエストの棚でも会話 ID は返す").toEqual({ conversationId: CONV });
        expect(JSON.stringify(r)).not.toMatch(/request|inbox|delivered|direct/);
    });

    it("🔴 お知らせ: 文字は replyKind text・受信箱に入ったら dmConvId／絵文字は reaction・dmConvId なし", async () => {
        await reply({ text: "きれいですね" });
        expect(lastNotif()).toMatchObject({ type: "storyreply", replyKind: "text", dmConvId: CONV });
        await reply({ emoji: "😍" });
        expect(lastNotif().replyKind).toBe("reaction");
        expect(lastNotif().dmConvId).toBeUndefined();
        await reply({ text: "両方", emoji: "😍" });
        expect(lastNotif().replyKind, "文字と絵文字の両方は text").toBe("text");
    });

    it("🔴 お知らせ: リクエストの棚に入った回・写らなかった回は dmConvId を付けない（ベルの行を隠させない）", async () => {
        delete rows[`follow#${ME}#${PEER}`];
        await reply({ text: "いいですね" });
        expect(convWrites().find((c) => c.cmd === "PutCommand")!.input.Item.state).toBe("request");
        expect(lastNotif()).toMatchObject({ replyKind: "text" });
        expect(lastNotif().dmConvId, "リクエストなのに隠せる印を付けている").toBeUndefined();
        await reply({ text: "https://example.com" });
        expect(lastNotif().dmConvId).toBeUndefined();
    });

    it("🔴 写しが上限時間を過ぎたら、dmConvId を付けずに通知を積み、応答は dm: null（timeout）。裏で終わっても二重にならない", async () => {
        const saved = storyReplyTimeouts.mirrorMs;
        storyReplyTimeouts.mirrorMs = 30;
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const real = mockSend.getMockImplementation()!;
        mockSend.mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
            if (c.constructor.name === "PutCommand" && String(c.input.Item?.id ?? "").startsWith("dm#")) {
                await gate;
                rows[c.input.Item.id] = c.input.Item;   // 本体が入った
            }
            return real(c);
        });
        try {
            const r = bodyOf(await reply({ text: "きれいですね" }));
            expect(r).toMatchObject({ success: true, dm: null, dmSkipped: "timeout" });
            expect(lastNotif()).toMatchObject({ type: "storyreply", replyKind: "text" });
            expect(lastNotif().dmConvId, "写せたか分からないのに隠せる印を付けている").toBeUndefined();
            // 裏の写しを最後まで通す
            release();
            await vi.waitFor(() => expect(entryWrites(ME).length).toBeGreaterThan(0));
            expect(convWrites().filter((c) => c.cmd === "PutCommand")).toHaveLength(1);
            // 同じ返信の id でもう一度写しても、通は増えない（冪等の鍵）
            const again = await dm.mirrorStoryReplyToDm({ from: ME, to: PEER, text: "きれいですね", replyId: r.reply.id, name: "旅人A", storyId: "story-1" });
            expect(again).toMatchObject({ mirrored: true, convId: CONV });
            expect((rows[KEY] as { items: unknown[] }).items, "同じ返信が2通入った").toHaveLength(1);
            expect(convWrites().filter((c) => c.cmd === "UpdateCommand"), "本体に足し直している").toHaveLength(0);
        } finally {
            storyReplyTimeouts.mirrorMs = saved;
            mockSend.mockImplementation(real);
        }
    });

    it("🔴 写してからお知らせを積む（印を書くため）", async () => {
        let putBeforeNotif = false;
        mockPushNotification.mockImplementation(async () => {
            putBeforeNotif = convWrites().some((c) => c.cmd === "PutCommand");
        });
        await reply({ text: "きれいですね" });
        expect(putBeforeNotif, "お知らせが写しより先に積まれている").toBe(true);
    });
});

describe("🔴 同じ会話で、送った写真の札と、紹介のストーリーの引用の門が両方効く（#541 の ① と ③）", () => {
    const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();
    const read = async (uid = ME) => bodyOf(await invoke(handler, ev("GET /dm/{id}", uid, { id: CONV })));
    beforeEach(() => {
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME) });
        rows["photo-1"] = { id: "photo-1", src: "https://cdn/p.jpg", thumbSrc: "https://cdn/p_t.webp", userId: THIRD };
        rows["story-1"] = { id: "story-1", story: true, userId: PEER, src: "https://cdn/s.jpg", mediaType: "image", expiresAt: FUTURE(), sharedPhotoId: "p-shared" };
        rows["p-shared"] = { id: "p-shared", src: "https://cdn/ps.jpg", userId: THIRD };
        follows(PEER, ME);
        rows[KEY] = convRow([
            { ...msg(ME, "きれい", "2026-11-09T00:00:01.000Z", "m-story-01"), via: "story", storyId: "story-1" },
            { ...msg(PEER, "", "2026-11-09T00:00:02.000Z", "m-photo-01"), photoId: "photo-1" },
        ], { updatedAt: "2026-11-09T00:00:02.000Z" });
    });

    it("どちらも見られる間は両方 live", async () => {
        const b = await read(ME);
        expect(b.items[0].story.state).toBe("live");
        expect(b.items[1].photo.state).toBe("live");
    });

    it("紹介した写真を非公開にした → 引用だけ ended（送った写真の札は live のまま）", async () => {
        rows["p-shared"] = { ...(rows["p-shared"] as Row), published: false };
        const b = await read(ME);
        expect(b.items[0].story, "紹介の写真の門が効いていない").toEqual({ id: "story-1", state: "ended" });
        expect(b.items[1].photo.state).toBe("live");
    });

    it("送った写真を非公開にした → 写真の札だけ gone（引用は live のまま）", async () => {
        rows["photo-1"] = { ...(rows["photo-1"] as Row), published: false };
        const b = await read(ME);
        expect(b.items[0].story.state).toBe("live");
        expect(b.items[1].photo, "送った写真の門が効いていない").toEqual({ id: "photo-1", state: "gone" });
    });
});

describe("写真を送る（photoId・札 #541・2026-11-11）", () => {
    const photo = (o: Row = {}) => ({ id: "photo-1", src: "https://cdn/p.jpg", thumbSrc: "https://cdn/p_t.webp", userId: THIRD, title: { ja: "弘前城の桜", en: "Hirosaki" }, location: "青森県弘前市", ...o });
    const accepted = () => {
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z")]);
        rows[`dminbox#${ME}`] = boxRow(ME, { [CONV]: entry(PEER) });
        rows[`dminbox#${PEER}`] = boxRow(PEER, { [CONV]: entry(ME) });
    };
    const read = async (uid = ME) => bodyOf(await invoke(handler, ev("GET /dm/{id}", uid, { id: CONV })));
    beforeEach(() => { rows["photo-1"] = photo(); follows(PEER, ME); });

    it("🔴 承認後は写真だけで送れる。本体は text 空・photoId、抜粋と API の本文は「写真を送りました」・photoOnly", async () => {
        accepted();
        const r = await send("", ME, PEER, { photoId: "photo-1" });
        expect(r.statusCode).toBe(200);
        const b = bodyOf(r);
        expect(b.message).toMatchObject({ text: "写真を送りました", photoId: "photo-1", photoOnly: true });
        const stored = (convWrites().at(-1)!.input.ExpressionAttributeValues as Record<string, { photoId?: string; text: string }[]>)[":new"][0];
        expect(stored).toMatchObject({ text: "", photoId: "photo-1" });
        expect(entryWrites(PEER).at(-1)!.input.ExpressionAttributeValues[":x"]).toBe("写真を送りました");
    });

    it("写真と文字を一緒に送ると、本文はそのまま・photoOnly は付けない", async () => {
        accepted();
        const b = bodyOf(await send("この場所です", ME, PEER, { photoId: "photo-1" }));
        expect(b.message).toMatchObject({ text: "この場所です", photoId: "photo-1" });
        expect(b.message.photoOnly).toBeUndefined();
    });

    it("🔴 承認前（会話の始まり・リクエストの間）は写真を断る（何も書かない）", async () => {
        const r = await send("", ME, PEER, { photoId: "photo-1" });
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).code).toBe("requestPhoto");
        expect(writes()).toHaveLength(0);
        rows[KEY] = convRow([msg(ME, "a", "2026-11-09T00:00:00.000Z")], { state: "request", initiator: ME, reqCount: 1 });
        const again = await send("見て", ME, PEER, { photoId: "photo-1" });
        expect(bodyOf(again).code).toBe("requestPhoto");
        expect(writes()).toHaveLength(0);
    });

    it("🔴 送る人に見せられない写真は 404 photoNotFound（下書き・ストーリー・無い・持ち主にブロックされた）", async () => {
        accepted();
        for (const row of [photo({ published: false }), photo({ story: true }), undefined]) {
            if (row) rows["photo-1"] = row; else delete rows["photo-1"];
            const r = await send("", ME, PEER, { photoId: "photo-1" });
            expect(r.statusCode).toBe(404);
            expect(bodyOf(r).code).toBe("photoNotFound");
        }
        rows["photo-1"] = photo();
        rows[`block#${THIRD}#${ME}`] = { id: "b" };
        expect(bodyOf(await send("", ME, PEER, { photoId: "photo-1" })).code).toBe("photoNotFound");
        expect(convWrites()).toHaveLength(0);
    });

    it("形の違う photoId は 400（黙って文字だけにしない）・文字も写真も無ければ empty", async () => {
        accepted();
        expect(bodyOf(await send("やあ", ME, PEER, { photoId: "a#b" })).code).toBe("badRequest");
        expect(bodyOf(await send("やあ", ME, PEER, { photoId: 12 })).code).toBe("badRequest");
        expect(bodyOf(await send("", ME, PEER)).code).toBe("empty");
        expect(convWrites()).toHaveLength(0);
    });

    it("🔴 会話を読むと、読む人の目で写真の札を付ける（live: 縮小版・題・撮影地 / 見られなければ gone）", async () => {
        accepted();
        rows[KEY] = convRow([{ ...msg(ME, "", "2026-11-09T00:00:02.000Z", "m-photo-01"), photoId: "photo-1" }, msg(PEER, "a", "2026-11-09T00:00:03.000Z")]);
        const mine = await read(ME);
        expect(mine.items[0]).toMatchObject({
            text: "写真を送りました", photoOnly: true, photoId: "photo-1",
            photo: { id: "photo-1", state: "live", src: "https://cdn/p_t.webp", title: "弘前城の桜", location: "青森県弘前市", ownerId: THIRD },
        });
        expect(mine.items[1].photo, "写真の無い通に札を付けている").toBeUndefined();
        // 持ち主が受け取った人をブロックした → 受け取った人には gone（送った人には live のまま）
        rows[`block#${THIRD}#${PEER}`] = { id: "b" };
        expect((await read(PEER)).items[0].photo).toEqual({ id: "photo-1", state: "gone" });
        expect((await read(ME)).items[0].photo.state).toBe("live");
        // 非公開に戻した → 2人とも gone
        rows["photo-1"] = photo({ published: false });
        expect((await read(ME)).items[0].photo).toEqual({ id: "photo-1", state: "gone" });
    });

    it("🔴 公開範囲を絞った写真: 見せてよい人（フォロワー）にだけ live で、絵は署名つき URL。フォロワーでない受け手には gone", async () => {
        const { generateKeyPairSync } = await import("node:crypto");
        const { privateKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" },
        });
        const saved = { id: process.env.CLOUDFRONT_KEY_PAIR_ID, key: process.env.CLOUDFRONT_PRIVATE_KEY };
        process.env.CLOUDFRONT_KEY_PAIR_ID = "K1";
        process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;
        try {
            accepted();
            rows["photo-1"] = photo({ audience: "followers", src: "https://cdn/private/p.jpg", thumbSrc: "https://cdn/private/p_t.webp" });
            rows[KEY] = convRow([{ ...msg(ME, "", "2026-11-09T00:00:02.000Z", "m-photo-01"), photoId: "photo-1" }]);
            follows(THIRD, ME);   // 送った人は持ち主のフォロワー・受け取った人は違う
            const mine = await read(ME);
            expect(mine.items[0].photo.state).toBe("live");
            expect(mine.items[0].photo.src).toContain("https://cdn/private/p_t.webp?");
            expect(mine.items[0].photo.src, "絞った写真の絵に署名が無い").toContain("Signature=");
            expect((await read(PEER)).items[0].photo, "フォロワーでない受け手に絞った写真を見せている").toEqual({ id: "photo-1", state: "gone" });
            // 公開の写真には署名しない（一覧と同じ URL）
            rows["photo-1"] = photo();
            expect((await read(ME)).items[0].photo.src).toBe("https://cdn/p_t.webp");
        } finally {
            if (saved.id === undefined) delete process.env.CLOUDFRONT_KEY_PAIR_ID; else process.env.CLOUDFRONT_KEY_PAIR_ID = saved.id;
            if (saved.key === undefined) delete process.env.CLOUDFRONT_PRIVATE_KEY; else process.env.CLOUDFRONT_PRIVATE_KEY = saved.key;
        }
    });

    it("🔴 同じ id の再送は、写真がその後に非公開になっても 404 にしない（入った1通をそのまま返す）", async () => {
        accepted();
        const first = await send("", ME, PEER, { photoId: "photo-1", id: "k-photo-0001" });
        expect(first.statusCode).toBe(200);
        // 1通目が本体に入った形にする（モックは書き込みを rows に写さないので、手で入れる）
        rows[KEY] = convRow([msg(PEER, "a", "2026-11-09T00:00:01.000Z"), { ...bodyOf(first).message, text: "", mine: undefined }]);
        rows["photo-1"] = photo({ published: false });
        const again = await send("", ME, PEER, { photoId: "photo-1", id: "k-photo-0001" });
        expect(again.statusCode, "入った1通の再送を写真の判定で断っている").toBe(200);
    });

    it("古い通（photoId なし）は今までどおり（photo・photoOnly の欄を作らない）", async () => {
        accepted();
        const b = await read(ME);
        expect(Object.keys(b.items[0]).sort()).toEqual(["from", "id", "mine", "t", "text"]);
    });
});
