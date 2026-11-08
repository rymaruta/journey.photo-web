import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 手荷物タグの選び（`PUT /user/trunk/settings { tagPicks }`・2026-11-08 owner 承認・札 #501）。
 * 保存は `trunk#` の行の `tagPicks` だけ（新しい GSI・テーブルなし）。読み出しではがした・同じ地名の枠を「おまかせ」に直す。
 *
 * DynamoDB は `trunkPublic.test.ts` と同じ「中身を持つ作り物」。
 */
type Item = Record<string, unknown>;
const store = vi.hoisted(() => new Map<string, Item>());
const keyOf = (table: string, key: Record<string, unknown>) => `${table}|${String(key.id ?? key.userId)}`;
const fakeSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: fakeSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
const mockListMyPhotos = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({ listMyPhotos: mockListMyPhotos }));
vi.stubEnv("USERS_TABLE", "users-test");

function condHolds(k: string, input: { ConditionExpression?: string; ExpressionAttributeValues?: Item }): boolean {
    const cur = store.get(k);
    const want = input.ExpressionAttributeValues?.[":rev"];
    const cond = input.ConditionExpression ?? "";
    if (!cond) return true;
    return cond.includes("attribute_not_exists(rev)")
        ? !cur || cur.rev === undefined || cur.rev === want
        : cur?.rev === want;
}

async function send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item };
    if (cmd.constructor.name === "GetCommand") {
        const v = store.get(keyOf(input.TableName, input.Key!));
        return { Item: v ? structuredClone(v) : undefined };
    }
    if (cmd.constructor.name === "TransactWriteCommand") {
        const items = (cmd.input as { TransactItems: { Put?: typeof input; ConditionCheck?: typeof input }[] }).TransactItems;
        const keyed = items.map((t) => {
            const op = (t.Put ?? t.ConditionCheck)! as typeof input & { ConditionExpression?: string; ExpressionAttributeValues?: Item };
            return { op, put: !!t.Put, k: keyOf(op.TableName, (t.Put ? op.Item : op.Key)!) };
        });
        if (keyed.some(({ k, op }) => !condHolds(k, op))) {
            throw Object.assign(new Error("tx"), { name: "TransactionCanceledException" });
        }
        for (const { k, op, put } of keyed) if (put) store.set(k, structuredClone(op.Item!));
        return {};
    }
    throw new Error(`想定外の命令 ${cmd.constructor.name}`);
}

const T = await import("../trunk");
const { handler, trunkId, parseTrunk } = T;

// 人の id は Cognito の sub の形（`isUserId`）
const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";


function setProfile(uid: string, p: Item) { store.set(`users-test|${uid}`, { userId: uid, ...p }); }
function setTrunk(uid: string, t: Item) { store.set(`photos-test|${trunkId(uid)}`, { id: trunkId(uid), uid, rev: 1, ...t }); }
const trunkRow = (uid: string) => store.get(`photos-test|${trunkId(uid)}`) as Item | undefined;

type Res = { statusCode: number; body: string };
async function call(routeKey: string, opts: { uid?: string; id?: string; body?: unknown; sub?: string } = {}) {
    const ev = {
        routeKey,
        pathParameters: opts.uid || opts.id ? { uid: opts.uid, id: opts.id } : undefined,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        requestContext: { authorizer: { jwt: { claims: { sub: opts.sub ?? OWNER } } }, http: { method: routeKey.split(" ")[0] } },
    };
    const res = (await (handler as unknown as (e: unknown) => Promise<Res>)(ev));
    return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown>, raw: res.body };
}

const stuckLabel = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    i: id, k: "p", n: name, c: "日本", d: 42, a: 1_790_000_000, o: 1, ...over,
});

/** 新しい順: kyoto → hokkaido → naha（同じ地名の別ラベル kyoto2 と、地名のない blank も） */
function seed(extra: Item = {}) {
    setProfile(OWNER, { displayName: "丸田" });
    setTrunk(OWNER, {
        pocket: [],
        stuck: [
            stuckLabel("kyoto", "京都"), stuckLabel("hokkaido", "北海道"), stuckLabel("naha", "那覇"),
            stuckLabel("kyoto2", "京都"), stuckLabel("blank", ""),
        ],
        posts: 80,
        ...extra,
    });
}
const put = (tagPicks: unknown) => call("PUT /user/trunk/settings", { body: { tagPicks } });
const mine = () => call("GET /user/trunk");

beforeEach(() => {
    store.clear();
    fakeSend.mockReset().mockImplementation(send);
    mockListMyPhotos.mockReset().mockResolvedValue([]);
});

describe("手荷物タグの選びを置く（PUT /user/trunk/settings { tagPicks }）", () => {
    it("枠ごとにラベルの id を置ける。保存は trunk# の行の tagPicks だけで、応答にも出る", async () => {
        seed();
        const r = await put(["hokkaido", "", "naha"]);
        expect(r.status).toBe(200);
        expect(r.json.tagPicks).toEqual(["hokkaido", "", "naha"]);
        expect(trunkRow(OWNER)?.tagPicks).toEqual(["hokkaido", "", "naha"]);
        // 新しい行・台帳は作らない（trunk# の1行だけ）
        expect([...store.keys()].filter((k) => k.includes("trunk")).sort()).toEqual([`photos-test|${trunkId(OWNER)}`]);
        expect((await mine()).json.tagPicks).toEqual(["hokkaido", "", "naha"]);
    });

    it("\"_\" はその枠にタグを吊るさない。末尾のおまかせは持たない。[] で全部おまかせに戻り、項目ごと消える", async () => {
        seed();
        expect((await put(["_", "naha", ""])).json.tagPicks).toEqual(["_", "naha"]);
        expect(trunkRow(OWNER)?.tagPicks).toEqual(["_", "naha"]);
        expect((await put([])).json.tagPicks).toEqual([]);
        expect(trunkRow(OWNER)).not.toHaveProperty("tagPicks");
    });

    it("形の誤りは 400（配列でない・4枠以上・文字でない・id の形でない・同じ id の重複）", async () => {
        seed();
        for (const bad of ["naha", null, 1, ["a", "b", "c", "d"], [1], [null], ["a b"], ["naha", "naha"], ["../x"]]) {
            const r = await put(bad);
            expect([bad, r.status, r.json.code]).toEqual([bad, 400, "badRequest"]);
        }
        expect(trunkRow(OWNER)).not.toHaveProperty("tagPicks");
    });

    it("貼っていないラベル（手持ち・無い id）は 409 tagPickNotStuck", async () => {
        seed({ pocket: [stuckLabel("inpocket", "大阪")] });
        for (const id of ["inpocket", "nothing"]) {
            const r = await put([id]);
            expect([r.status, r.json.code]).toEqual([409, "tagPickNotStuck"]);
        }
    });

    it("地名のないラベルは 409 tagPickNoPlace、同じ地名を2枠に置くのは 409 tagPickDuplicate", async () => {
        seed();
        const a = await put(["blank"]);
        expect([a.status, a.json.code]).toEqual([409, "tagPickNoPlace"]);
        const b = await put(["kyoto", "kyoto2"]);
        expect([b.status, b.json.code]).toEqual([409, "tagPickDuplicate"]);
        expect(trunkRow(OWNER)).not.toHaveProperty("tagPicks");
    });

    it("同じ選びをもう一度送っても書かない（rev が進まない）。欄の無い設定は選びを変えない（旧アプリ）", async () => {
        seed();
        await put(["naha"]);
        const rev = trunkRow(OWNER)?.rev;
        await put(["naha"]);
        expect(trunkRow(OWNER)?.rev).toBe(rev);
        const old = await call("PUT /user/trunk/settings", { body: { receiveLabels: false } });
        expect(old.status).toBe(200);
        expect(trunkRow(OWNER)?.tagPicks).toEqual(["naha"]);
        expect(old.json.tagPicks).toEqual(["naha"]);
    });
});

describe("読み出し（GET /user/trunk）", () => {
    it("tagPicks の欄が無い今までの行は []（全部おまかせ）", async () => {
        seed();
        expect((await mine()).json.tagPicks).toEqual([]);
    });

    it("はがした・取り消されて無くなったラベルの枠は、読むときにおまかせに戻す（保存は書き換えない）", async () => {
        seed({ tagPicks: ["naha", "hokkaido", "_"] });
        const row = trunkRow(OWNER)!;
        setTrunk(OWNER, { ...row, stuck: (row.stuck as Item[]).filter((l) => l.i !== "hokkaido") });
        expect((await mine()).json.tagPicks).toEqual(["naha", "", "_"]);
        expect(trunkRow(OWNER)?.tagPicks).toEqual(["naha", "hokkaido", "_"]);
    });

    it("同じ地名が前の枠で使われていれば後ろの枠はおまかせに戻す（読み出しだけ）", async () => {
        seed({ tagPicks: ["kyoto", "kyoto2"] });
        expect((await mine()).json.tagPicks).toEqual(["kyoto"]);
    });

    it("保存の形が壊れていても落ちない（形の違う要素は捨てる・4枠目以降は読まない）", async () => {
        seed({ tagPicks: ["naha", 5, "bad id", "kyoto", "hokkaido"] });
        expect((await mine()).json.tagPicks).toEqual(["naha"]);
        expect(parseTrunk(trunkRow(OWNER)).tagPicks).toEqual(["naha"]);
    });
});

describe("はがしたとき（POST /user/trunk/labels/{id}/unstick）", () => {
    it("タグに載せていたラベルをはがすと、その枠はおまかせに戻り、貼り直しても勝手に戻らない", async () => {
        seed({ tagPicks: ["naha", "hokkaido"] });
        const r = await call("POST /user/trunk/labels/{id}/unstick", { id: "naha", body: {} });
        expect(r.status).toBe(200);
        expect(r.json.tagPicks).toEqual(["", "hokkaido"]);
        expect(trunkRow(OWNER)?.tagPicks).toEqual(["", "hokkaido"]);
        const stick = await call("POST /user/trunk/labels/{id}/stick", { id: "naha", body: {} });
        expect(stick.status).toBe(200);
        expect(stick.json.tagPicks).toEqual(["", "hokkaido"]);
    });

    it("最後の選びをはがすと項目ごと消える。選んでいないラベルをはがしても選びは変わらない", async () => {
        seed({ tagPicks: ["naha"] });
        await call("POST /user/trunk/labels/{id}/unstick", { id: "kyoto", body: {} });
        expect(trunkRow(OWNER)?.tagPicks).toEqual(["naha"]);
        await call("POST /user/trunk/labels/{id}/unstick", { id: "naha", body: {} });
        expect(trunkRow(OWNER)).not.toHaveProperty("tagPicks");
    });
});

describe("人のトランク（GET /users/{uid}/trunk）の tagPicks", () => {
    const their = () => call("GET /users/{uid}/trunk", { uid: OWNER, sub: VIEWER });

    it("返答の中の番号（s＋貼った古い順）で指す。写真の id は出さない", async () => {
        seed({ tagPicks: ["naha", "_", "kyoto"] });
        const r = await their();
        expect(r.status).toBe(200);
        // stuck は新しい順 kyoto, hokkaido, naha, kyoto2, blank → 古い順の番号は blank=0, kyoto2=1, naha=2, hokkaido=3, kyoto=4
        expect(r.json.tagPicks).toEqual(["s2", "_", "s4"]);
        const ids = (r.json.stuck as { id: string }[]).map((l) => l.id);
        expect(ids).toEqual(["s4", "s3", "s2", "s1", "s0"]);
        expect(r.raw).not.toContain("naha");
    });

    it("地名を見せてよいと確かめていないラベルを選んでいた枠は、おまかせ（選びから伏せたラベルが分からない）", async () => {
        seed({ tagPicks: ["naha", "hokkaido"] });
        const row = trunkRow(OWNER)!;
        setTrunk(OWNER, {
            ...row,
            stuck: (row.stuck as Item[]).map((l) => (l.i === "naha" ? { ...l, o: undefined } : l)),
        });
        expect((await their()).json.tagPicks).toEqual(["", "s3"]);
    });

    it("選びが無い人は []（旧アプリは欄を読まないので従来どおり）", async () => {
        seed();
        expect((await their()).json.tagPicks).toEqual([]);
    });
});

describe("行の大きさ", () => {
    it("3枠ぶん（長い id）を足しても、いちばん大きい行は予算の内（約 200B）", () => {
        const id = (c: string) => c.repeat(64);
        const real = (n: string) => ({
            i: id(n), k: "p", n: "高屋神社・天空の鳥居", l: "Takaya Shrine", c: "日本", d: 2_147_000_000, a: 1_790_000_000,
            s: 2, t: 1, f: 1, g: "g:000000000000", o: 1, p: [999, 999, -300],
        });
        const letters = "abcdefghijklmnopqrstuvwxyz";
        const stuck = Array.from({ length: 1200 }, (_, i) => real(`${letters[i % 26]}${letters[Math.floor(i / 26) % 26]}`.slice(0, 1)));
        const base = parseTrunk({ stuck });
        const withPicks = parseTrunk({ stuck, tagPicks: [id("a"), id("b"), id("c")] });
        expect(withPicks.tagPicks).toHaveLength(3);
        const z = T.rowSizes(withPicks).main - T.rowSizes(base).main;
        expect(z).toBeGreaterThan(0);
        expect(z).toBeLessThan(260);
        expect(T.rowSizes(withPicks).main).toBeLessThan(T.TRUNK_BUDGET_BYTES);
    });
});
