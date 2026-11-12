import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 送信の取り消しの直し（2026-11-12・確かめ役の指摘）。`dm.test.ts` と違い、DynamoDB の模型が**行の中身を本当に書き換える**
 * （条件式も見る）——取り消し → 削除 → 送り直し、のように何回もの口をまたいで起きる不具合を通しで縛るため。
 * 模型は確かめ役の再現（scratchpad の dm-unsend-repro.test.ts）をそのまま使い、足りない式だけ足した。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test", USER_INDEX: "userId-createdAt-index" }));
vi.mock("../liveCaller", async (orig) => ({
    ...(await orig<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => null,
    readLiveCaller: async (uid: string) => ({ row: { userId: uid, displayName: "A" } }),
}));
vi.mock("../notify", () => ({
    pushDmMessage: async () => undefined, pushNotification: async () => undefined,
    displayNameOf: () => "n", DEFAULT_NAME: "d", DELETED_USER_NAME: "x",
    deletedAmong: async () => ({ deleted: new Set(), unread: new Set() }),
    withUnreadAsDeleted: () => new Set(),
}));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    hiddenUserIds: async () => new Set<string>(),
}));
const { handler, STORY_REPLIES_KEY } = await import("../dm");
const { storyRepliesId } = await import("../storyReplies");
const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const CONV = `${ME}_${PEER}`;
const KEY = `dm#${ME}#${PEER}`;
type Row = Record<string, any>;
let rows: Record<string, Row>;
let log: string[];
let hook: ((cmd: string, input: Row) => void) | null = null;
let failOn: ((cmd: string, input: Row) => boolean) | null = null;
const CCF = () => Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" });
beforeEach(() => {
    rows = {}; log = []; hook = null; failOn = null;
    mockSend.mockReset().mockImplementation(async (c: { constructor: { name: string }; input: Row }) => {
        const cmd = c.constructor.name; const i = c.input;
        hook?.(cmd, i);
        const id = i.Key?.id ?? i.Item?.id;
        if (cmd === "GetCommand") { const r = rows[id]; return r ? { Item: JSON.parse(JSON.stringify(r)) } : {}; }
        if (cmd === "BatchGetCommand") return { Responses: {} };
        const ue = String(i.UpdateExpression ?? ""); const ce = String(i.ConditionExpression ?? "");
        const v = i.ExpressionAttributeValues ?? {};
        if (cmd === "PutCommand") {
            if (ce.includes("attribute_not_exists(id)") && rows[id]) throw CCF();
            rows[id] = i.Item; log.push(`PUT ${id} reqCount=${i.Item.reqCount}`); return {};
        }
        if (cmd === "DeleteCommand") {
            if (ce === "updatedAt = :u" && rows[id]?.updatedAt !== v[":u"]) throw CCF();
            delete rows[id]; log.push(`DELETE ${id}`); return {};
        }
        if (cmd !== "UpdateCommand") return {};
        if (id.startsWith("dmday#")) return {};
        if (failOn?.(cmd, i)) throw Object.assign(new Error("boom"), { name: "InternalServerError" });
        if (id.startsWith("storyreplies#")) {
            const r = rows[id]; const m = /^REMOVE #items\[(\d+)\]$/.exec(ue);
            if (!m || !r || r.items[Number(m[1])]?.id !== v[":rid"]) throw CCF();
            r.items.splice(Number(m[1]), 1); log.push(`STORYREPLY- ${v[":rid"]}`); return {};
        }
        if (ue === "SET replyCount = :n") { if (!rows[id] || rows[id].archivedAt) throw CCF(); rows[id].replyCount = v[":n"]; return {}; }
        if (id === KEY) {
            const r = rows[KEY];
            const m = /^REMOVE #items\[(\d+)\]/.exec(ue);
            if (m) {
                const n = Number(m[1]);
                if (!r || r.items[n]?.id !== v[":mid"] || r.updatedAt !== v[":prev"]) throw CCF();
                r.items.splice(n, 1); r.updatedAt = v[":now"]; r.unsentAt = v[":now"]; r.lastUnsent = v[":lu"]; log.push(`UNSEND items[${n}]`); return {};
            }
            if (/ClearedAt = :now/.test(ue)) { if (!r) throw CCF(); r[ue.includes("lo") ? "loClearedAt" : "hiClearedAt"] = v[":now"]; return { Attributes: r }; }
            if (ue.startsWith("SET #items = ")) {
                if (!r || r.items.length !== v[":len"] || r.updatedAt !== v[":prev"]) throw CCF();
                r.items = v[":kept"] ?? [...r.items, ...v[":new"]]; r.updatedAt = v[":now"];
                if (ue.includes("reqCount")) r.reqCount = (r.reqCount ?? 0) + 1;
                if (ue.includes("#state = :inbox")) r.state = "inbox";
                if (ue.includes("replied = :true")) r.replied = true;
                log.push(`APPEND reqCount=${r.reqCount}`); return {};
            }
            throw new Error("unhandled conv update: " + ue);
        }
        // 受信箱
        const box = rows[id]; const cn = i.ExpressionAttributeNames?.["#c"];
        const e = box?.convs?.[cn];
        if (ue.startsWith("SET convs = if_not_exists")) { rows[id] = { id, convs: {}, ...(box ?? {}) }; return {}; }
        if (ue === "SET convs.#c = :entry") { if (!box?.convs || box.convs[cn]) throw CCF(); box.convs[cn] = v[":entry"]; log.push(`ENTRY+ ${id.slice(8, 12)}`); return {}; }
        if (ue.startsWith("REMOVE convs.#c")) {
            if (ce.includes(":t0") && (!e || e.t !== v[":t0"] || e.unread !== v[":u0"])) throw CCF();
            if (!box?.convs) throw Object.assign(new Error("The document path provided in the update expression is invalid for update"), { name: "ValidationException" });
            delete box.convs[cn]; if (ue.includes("#dec")) box[i.ExpressionAttributeNames["#dec"]] = v[":n"];
            for (const [k, name] of Object.entries(i.ExpressionAttributeNames ?? {})) if (k.startsWith("#ev")) delete box[name as string];
            log.push(`ENTRY- ${id.slice(8, 12)}${ue.includes("#dec") ? " dec=" + v[":n"] : ""}`); return {};
        }
        if (ue.startsWith("SET convs.#c.")) {
            if (!e) throw CCF();
            if (ce.includes(":t0") && (e.t !== v[":t0"] || e.unread !== v[":u0"])) throw CCF();
            if (ce.includes("convs.#c.#t <= :t") && (!(e.t <= v[":t"]) || e.lastId === v[":id"])) throw CCF();
            if (v[":t"] !== undefined && ue.includes("#t = :t")) e.t = v[":t"];
            if (v[":x"] !== undefined) e.excerpt = v[":x"];
            if (v[":u"] !== undefined) e.unread = v[":u"];
            if (v[":lid"] !== undefined) e.lastId = v[":lid"];
            if (v[":id"] !== undefined && ue.includes("#lid = :id")) e.lastId = v[":id"];
            if (v[":from"] !== undefined) e.from = v[":from"];
            if (v[":s"] !== undefined) e.state = v[":s"];
            if (v[":mid"] !== undefined && ue.includes("#uid = :mid")) e.unsentId = v[":mid"];
            if (ue.includes("REMOVE convs.#c.#f")) delete e.from;
            if (ue.includes("+ :one")) e.unread = (e.unread ?? 0) + 1;
            log.push(`ENTRY~ ${id.slice(8, 12)} t=${e.t.slice(17)} x=${e.excerpt} u=${e.unread}`);
            return {};
        }
        throw new Error("unhandled inbox update: " + ue);
    });
});
const invoke = (e: unknown) => (handler as any)(e) as Promise<{ statusCode: number; body: string }>;
const ev = (route: string, sub: string, o: { id?: string; body?: unknown; since?: string } = {}) => ({
    routeKey: route, requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: o.id ? { id: o.id } : undefined, queryStringParameters: o.since ? { since: o.since } : undefined,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


const m = (from: string, text: string, s: number, id: string) => ({ id, from, text, t: `2026-11-09T00:00:0${s}.000Z` });
const entry = (peer: string, o: Row) => ({ peer, excerpt: "x", unread: 0, state: "inbox", ...o });
const unsend = (sub: string, id: string) => invoke(ev("POST /dm/{id}/messages", sub, { id: CONV, body: { unsend: id } }));

describe("送信の取り消し: 確かめ役の指摘の直し（2026-11-12）", () => {
    it("🔴 承認前の「通算3通まで」は、取り消し → 自分の側を削除 を挟んでも戻らない（相手の行を外すとき断った印を残す）", async () => {
        rows[`follow#${PEER}#${ME}`] = { id: "f" };
        const ids: string[] = [];
        for (let k = 0; k < 3; k++) {
            const r = await invoke(ev("POST /dm", ME, { body: { to: PEER, text: `r-${k}` } }));
            expect(r.statusCode, r.body).toBe(200);
            ids.push(JSON.parse(r.body).message.id);
            await sleep(2);
        }
        for (const id of ids) expect((await unsend(ME, id)).statusCode).toBe(200);
        expect(rows[`dminbox#${PEER}`].convs[CONV], "相手の行が残っている（跡が残る）").toBeUndefined();
        expect(rows[`dminbox#${PEER}`][`dec_${ME}`], "断った印が無い（通数が戻る）").toBe(3);
        expect((await invoke(ev("DELETE /dm/{id}", ME, { id: CONV }))).statusCode).toBe(200);
        expect(rows[KEY], "前提: 本体は両側から消えて物理削除").toBeUndefined();
        const again = await invoke(ev("POST /dm", ME, { body: { to: PEER, text: "もう一度" } }));
        expect(again.statusCode, "取り消しと削除で、承認前の3通を送り直せた").toBe(429);
        expect(JSON.parse(again.body).code).toBe("requestLimit");
    });

    it("断った印は、承認後の会話・自分が始めた会話の相手側では残さない", async () => {
        const B = m(ME, "まちがい", 2, "m-mine-0002");
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [B], state: "inbox", initiator: ME, reqCount: 1, replied: true, updatedAt: B.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: B.t, from: ME }) } };
        rows[`dminbox#${PEER}`] = { id: `dminbox#${PEER}`, convs: { [CONV]: entry(ME, { t: B.t, unread: 1, from: ME }) } };
        expect((await unsend(ME, B.id)).statusCode).toBe(200);
        expect(rows[`dminbox#${PEER}`].convs[CONV]).toBeUndefined();
        expect(rows[`dminbox#${PEER}`][`dec_${ME}`], "承認済みの会話で断った印を付けた").toBeUndefined();
    });

    it("🔴 受け取った人が返信を取り消しても、始めた人は送れるまま（話した印は本体に残る）", async () => {
        rows[`follow#${PEER}#${ME}`] = { id: "f" };
        for (let k = 0; k < 3; k++) { expect((await invoke(ev("POST /dm", ME, { body: { to: PEER, text: `${k}` } }))).statusCode).toBe(200); await sleep(2); }
        const reply = await invoke(ev("POST /dm/{id}/messages", PEER, { id: CONV, body: { text: "いいよ" } }));
        expect(reply.statusCode, reply.body).toBe(200);
        const before = JSON.parse((await invoke(ev("GET /dm/{id}", ME, { id: CONV }))).body);
        expect(before).toMatchObject({ canSend: true });
        expect(before.requestRemaining).toBeUndefined();
        expect((await unsend(PEER, JSON.parse(reply.body).message.id)).statusCode).toBe(200);
        const after = JSON.parse((await invoke(ev("GET /dm/{id}", ME, { id: CONV }))).body);
        expect(after.canSend, "返信を取り消したら、始めた人が送れなくなった").toBe(true);
        expect(after.requestRemaining).toBeUndefined();
        const sent = await invoke(ev("POST /dm/{id}/messages", ME, { id: CONV, body: { text: "4通目" } }));
        expect(sent.statusCode).toBe(200);
        expect(JSON.parse(sent.body).state, "送ったあとの自分の置き場所が承認待ちに戻った").toBe("inbox");
    });

    it("🔴 直しの最中に相手が返信しても、自分の行は新しい通のまま（行を読んでから本体を読む）", async () => {
        const A = m(PEER, "やあ", 1, "m-peer-0001"), B = m(ME, "まちがい", 2, "m-mine-0002");
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [A, B], state: "inbox", initiator: PEER, reqCount: 0, updatedAt: B.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: B.t, excerpt: "まちがい", lastId: B.id, from: ME }) } };
        rows[`dminbox#${PEER}`] = { id: `dminbox#${PEER}`, convs: { [CONV]: entry(ME, { t: B.t, excerpt: "まちがい", unread: 1, lastId: B.id, from: ME }) } };
        let armed = false, fired = false;
        hook = (cmd, input) => {
            if (cmd === "UpdateCommand" && String(input.UpdateExpression).startsWith("REMOVE #items[")) armed = true;
            else if (armed && !fired && cmd === "GetCommand" && input.Key.id === `dminbox#${PEER}`) {
                fired = true;
                const now = new Date(Date.now() + 5).toISOString();
                const C = { id: "m-peer-0003", from: PEER, text: "返信です", t: now };
                rows[KEY].items.push(C); rows[KEY].updatedAt = now;
                Object.assign(rows[`dminbox#${ME}`].convs[CONV], { t: now, excerpt: "返信です", unread: 1, lastId: C.id, from: PEER });
            }
        };
        expect((await unsend(ME, B.id)).statusCode).toBe(200);
        expect(fired, "前提: 直しの最中に返信が入った").toBe(true);
        expect(rows[`dminbox#${ME}`].convs[CONV], "自分の行が古い通に巻き戻った").toMatchObject({ excerpt: "返信です", lastId: "m-peer-0003" });
    });

    it("🔴 通報を押し直しても、前の写しの通は残る（相手が取り消した通も）", async () => {
        const A = m(PEER, "やあ", 1, "m-peer-0001"), B = m(ME, "ひどい言葉", 2, "m-mine-0002");
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [A, B], state: "inbox", initiator: PEER, reqCount: 0, updatedAt: B.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: B.t }) } };
        rows[`dminbox#${PEER}`] = { id: `dminbox#${PEER}`, convs: { [CONV]: entry(ME, { t: B.t, unread: 1 }) } };
        const rk = `dmreport#${CONV}#${PEER}`;
        expect((await invoke(ev("POST /dm/{id}/report", PEER, { id: CONV, body: { reason: "harassment" } }))).statusCode).toBe(200);
        expect((await unsend(ME, B.id)).statusCode).toBe(200);
        expect((await invoke(ev("POST /dm/{id}/report", PEER, { id: CONV, body: { reason: "spam", note: "続き" } }))).statusCode).toBe(200);
        expect(rows[rk].messages.map((x: Row) => x.text), "押し直しで写しから取り消された通が消えた").toEqual(["やあ", "ひどい言葉"]);
        expect(rows[rk]).toMatchObject({ reason: "spam", note: "続き" });
    });

    it("🔴 押し直し（直しの途中で落ちた）でも、相手の未読はちょうど1つだけ減る", async () => {
        const A = m(PEER, "やあ", 1, "m-peer-0001"), B = m(ME, "まちがい", 2, "m-mine-0002"), C = m(ME, "つづき", 3, "m-mine-0003");
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [A, B, C], state: "inbox", initiator: PEER, reqCount: 0, updatedAt: C.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: C.t, excerpt: "つづき", from: ME }) } };
        rows[`dminbox#${PEER}`] = { id: `dminbox#${PEER}`, convs: { [CONV]: entry(ME, { t: C.t, excerpt: "つづき", unread: 2, from: ME }) } };
        failOn = (cmd, i) => cmd === "UpdateCommand" && i.Key?.id === `dminbox#${PEER}`;
        expect((await unsend(ME, B.id)).statusCode, "前提: 本体を消したあと受信箱の直しで落ちる").toBe(500);
        expect(rows[KEY].items.map((x: Row) => x.id)).toEqual([A.id, C.id]);
        failOn = null;
        expect((await unsend(ME, B.id)).statusCode, "押し直しが通らない").toBe(200);
        expect(rows[`dminbox#${PEER}`].convs[CONV].unread, "押し直しで未読を減らしていない").toBe(1);
        expect((await unsend(ME, B.id)).statusCode).toBe(200);
        expect(rows[`dminbox#${PEER}`].convs[CONV].unread, "もう一度の押し直しで二重に減らした").toBe(1);
    });

    it("🔴 在るかどうかで答えを分けない: 他人の通・無い通・見えない通は同じ 404 messageNotFound・会話が見られないのは notFound", async () => {
        const A = m(PEER, "やあ", 1, "m-peer-0001"), B = m(ME, "まえ", 2, "m-mine-0002"), C = m(ME, "あと", 4, "m-mine-0004");
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [A, B, C], state: "inbox", initiator: PEER, reqCount: 0, loClearedAt: "2026-11-09T00:00:03.000Z", updatedAt: C.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: C.t }) } };
        rows[`dminbox#${PEER}`] = { id: `dminbox#${PEER}`, convs: { [CONV]: entry(ME, { t: C.t }) } };
        const bodies = [];
        for (const id of [A.id, "m-nothing-01", B.id]) {
            const r = await unsend(ME, id);
            bodies.push([r.statusCode, r.body]);
        }
        expect(new Set(bodies.map((b) => JSON.stringify(b))).size, `答えが分かれている: ${JSON.stringify(bodies)}`).toBe(1);
        expect(bodies[0][0]).toBe(404);
        expect(JSON.parse(bodies[0][1] as string).code).toBe("messageNotFound");
        expect(rows[KEY].items).toHaveLength(3);
        rows[`dminbox#${ME}`].convs = {};
        expect(JSON.parse((await unsend(ME, C.id)).body).code).toBe("notFound");
    });

    it("全部取り消したら、自分の行は抜粋を空にし「あなた: 」の手がかり（from）も外す", async () => {
        const B = m(ME, "まちがい", 2, "m-mine-0002");
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [B], state: "request", initiator: ME, reqCount: 1, updatedAt: B.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: B.t, excerpt: "まちがい", state: "pending", from: ME }) } };
        rows[`dminbox#${PEER}`] = { id: `dminbox#${PEER}`, convs: { [CONV]: entry(ME, { t: B.t, unread: 1, state: "request", from: ME }) } };
        expect((await unsend(ME, B.id)).statusCode).toBe(200);
        expect(rows[`dminbox#${ME}`].convs[CONV].excerpt).toBe("");
        expect(rows[`dminbox#${ME}`].convs[CONV].from, "抜粋が空なのに from が残り、一覧が「あなた: 」だけになる").toBeUndefined();
        const list = JSON.parse((await invoke(ev("GET /dm", ME))).body);
        expect(list.items[0].lastMine).toBeUndefined();
    });

    it("🔴 ストーリーへの返信から写した通は、ストーリーの返信の行からも消す（バッジの数も合わせる）", async () => {
        expect(STORY_REPLIES_KEY("s-1"), "dm.ts の写しのキーが storyReplies.ts とずれた").toBe(storyRepliesId("s-1"));
        const R = { ...m(ME, "きれい", 2, "r-0000000002"), via: "story", storyId: "s-1" };
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [R], state: "request", initiator: ME, reqCount: 1, updatedAt: R.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: R.t, state: "pending" }) } };
        rows[`dminbox#${PEER}`] = { id: `dminbox#${PEER}`, convs: { [CONV]: entry(ME, { t: R.t, state: "request" }) } };
        rows["storyreplies#s-1"] = { id: "storyreplies#s-1", items: [{ id: "r-other-001", uid: "x", text: "a" }, { id: R.id, uid: ME, text: "きれい" }] };
        rows["s-1"] = { id: "s-1", story: true, replyCount: 2 };
        expect((await unsend(ME, R.id)).statusCode).toBe(200);
        expect(rows["storyreplies#s-1"].items.map((x: Row) => x.id), "ストーリーの返信が残っている").toEqual(["r-other-001"]);
        expect(rows["s-1"].replyCount).toBe(1);
        // 他人の返信は消さない（同じ id でも本人の返信だけ）
        rows["storyreplies#s-1"].items.push({ id: "r-0000000009", uid: PEER, text: "b" });
        const S = { ...m(ME, "x", 5, "r-0000000009"), via: "story", storyId: "s-1" };
        rows[KEY].items.push(S); rows[KEY].updatedAt = S.t;
        expect((await unsend(ME, S.id)).statusCode).toBe(200);
        expect(rows["storyreplies#s-1"].items.map((x: Row) => x.id)).toContain("r-0000000009");
    });

    it("ストーリーの返信を消せなかったら、会話からも消さずに 500（押し直しでやり直せる）", async () => {
        const R = { ...m(ME, "きれい", 2, "r-0000000002"), via: "story", storyId: "s-1" };
        rows[KEY] = { id: KEY, lo: ME, hi: PEER, items: [R], state: "inbox", initiator: ME, reqCount: 1, replied: true, updatedAt: R.t };
        rows[`dminbox#${ME}`] = { id: `dminbox#${ME}`, convs: { [CONV]: entry(PEER, { t: R.t }) } };
        rows["storyreplies#s-1"] = { id: "storyreplies#s-1", items: [{ id: R.id, uid: ME, text: "きれい" }] };
        failOn = (cmd, i) => cmd === "UpdateCommand" && String(i.Key?.id).startsWith("storyreplies#");
        expect((await unsend(ME, R.id)).statusCode).toBe(500);
        expect(rows[KEY].items, "ストーリーの返信が残ったまま、会話からだけ消えた").toHaveLength(1);
    });
});
