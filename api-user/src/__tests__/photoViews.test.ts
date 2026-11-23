import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 写真の閲覧数（札 journey.photo-ios#707・`photoViews.ts`）。
 *
 * 固定したいのは:
 *  1. 数えるのは公開の写真で、ストーリーでも絞った写真でもないものだけ（それ以外は何も書かずに 204）
 *  2. via は app か web だけ・機械の User-Agent は数えない・大きな本文は読む前に断る
 *  3. 書くのは `views#<写真ID>` の行だけ（写真の行は書き換えない）。ADD で足し、初めて数えた日を残す
 *  4. 数を返すのは持ち主だけ（他人・無い・ストーリーは同じ 404）。まとめて読む口も持ち主の写真だけ返す
 *  5. 権限は数の行の鍵の頭に絞り、この口だけ流量を絞る（serverless の設定）
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));

// 読み込みは beforeAll で（ファイルの頭の await は api-user の tsconfig の型検査で数えられる）
let V: typeof import("../photoViews");
beforeAll(async () => { V = await import("../photoViews"); });

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
const calls = () => mockDdbSend.mock.calls.map(([c]) => c as Cmd);
const updates = () => calls().filter((c) => c.constructor.name === "UpdateCommand");
const keyOf = (c: Cmd) => String((c.input.Key as { id?: string } | undefined)?.id ?? "");

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const APP = "JourneyPhoto/1 CFNetwork/1568.100.1 Darwin/24.0.0";

const postEv = (id: string | undefined, body: unknown, ua: string | null = SAFARI) => ({
    pathParameters: id === undefined ? {} : { id },
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: ua === null ? {} : { "user-agent": ua },
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.7" } },
}) as never;
const record = async (e: never) => (await V.recordPhotoView(e, {} as never, () => undefined)) as { statusCode: number; body: string };

const authed = (sub: string, extra: Record<string, unknown> = {}) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    ...extra,
}) as never;
const getOne = async (sub: string, id: string) =>
    (await V.getPhotoViews(authed(sub, { pathParameters: { id } }), {} as never, () => undefined)) as { statusCode: number; body: string };
const getMany = async (sub: string, ids: string) =>
    (await V.getMyPhotoViews(authed(sub, { queryStringParameters: { ids } }), {} as never, () => undefined)) as { statusCode: number; body: string };

/** 写真の行（id → 行）と views# の行で DB を作る */
function world(rows: Record<string, Record<string, unknown>>) {
    mockDdbSend.mockImplementation(async (c: Cmd) => {
        const name = c.constructor.name;
        if (name === "GetCommand") return { Item: rows[keyOf(c)] };
        if (name === "BatchGetCommand") {
            const req = (c.input.RequestItems as Record<string, { Keys: { id: string }[] }>)["photos-test"];
            return { Responses: { "photos-test": req.Keys.map((k) => rows[k.id]).filter(Boolean) } };
        }
        return {};
    });
}

const PUBLIC = { id: "p1", src: "https://cdn/p1.jpg", userId: "me" };

beforeEach(() => { mockDdbSend.mockReset(); });

describe("数える（POST /photos/{id}/view）", () => {
    it("公開の写真は views#<ID> に ADD する（写真の行は書き換えない）・初めての日を残す", async () => {
        world({ p1: PUBLIC });
        const res = await record(postEv("p1", { via: "web" }));
        expect(res.statusCode).toBe(204);
        expect(updates()).toHaveLength(1);
        const u = updates()[0];
        expect(keyOf(u)).toBe("views#p1");
        expect(u.input.UpdateExpression).toBe("ADD #via :one SET since = if_not_exists(since, :day)");
        expect(u.input.ExpressionAttributeNames).toEqual({ "#via": "web" });
        expect((u.input.ExpressionAttributeValues as Record<string, unknown>)[":one"]).toBe(1);
        expect(calls().filter((c) => keyOf(c) === "p1").every((c) => c.constructor.name === "GetCommand")).toBe(true);
    });

    it("アプリからは app に足す（アプリの User-Agent は機械に数えない）", async () => {
        world({ p1: PUBLIC });
        expect((await record(postEv("p1", { via: "app" }, APP))).statusCode).toBe(204);
        expect(updates()[0].input.ExpressionAttributeNames).toEqual({ "#via": "app" });
    });

    it.each([
        ["非公開", { ...PUBLIC, published: false }],
        ["ストーリー", { ...PUBLIC, story: true }],
        ["フォロワーのみ", { ...PUBLIC, audience: "followers" }],
        ["親しい友達", { ...PUBLIC, audience: "close" }],
        ["src の無い内部の行", { id: "p1", userId: "me" }],
    ])("%s の写真は数えない（何も書かずに 204）", async (_, row) => {
        world({ p1: row });
        expect((await record(postEv("p1", { via: "app" }, APP))).statusCode).toBe(204);
        expect(updates()).toHaveLength(0);
    });

    it("無い写真も数えない（無いかどうかを外へ見せない 204）", async () => {
        world({});
        expect((await record(postEv("nope", { via: "web" }))).statusCode).toBe(204);
        expect(updates()).toHaveLength(0);
    });

    it.each([
        "Googlebot/2.1 (+http://www.google.com/bot.html)",
        "Mozilla/5.0 (compatible; bingbot/2.0)",
        "facebookexternalhit/1.1",
        "Mozilla/5.0 HeadlessChrome/120.0",
        "curl/8.4.0",
        "python-requests/2.31",
        "",
    ])("機械の User-Agent（%j）は数えない", async (ua) => {
        world({ p1: PUBLIC });
        expect((await record(postEv("p1", { via: "web" }, ua))).statusCode).toBe(204);
        expect(updates()).toHaveLength(0);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("User-Agent が無いのも数えない", async () => {
        world({ p1: PUBLIC });
        await record(postEv("p1", { via: "web" }, null));
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it.each([
        [{ via: "ios" }], [{ via: "APP" }], [{}], ["{nope"], [""], [{ via: ["app"] }],
    ])("via が app か web でなければ 400（%j）", async (body) => {
        world({ p1: PUBLIC });
        expect((await record(postEv("p1", body))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("写真の ID の形が違えば 400（行の種類の区切り # を通さない）", async () => {
        expect((await record(postEv("comments#p1", { via: "web" }))).statusCode).toBe(400);
        expect((await record(postEv(undefined, { via: "web" }))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("大きな本文は JSON を読む前に 413", async () => {
        const res = await record(postEv("p1", JSON.stringify({ via: "web", pad: "x".repeat(V.MAX_BODY_BYTES) })));
        expect(res.statusCode).toBe(413);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("Base64 で来た本文も読む（sendBeacon の形によっては Base64 で届く）", () => {
        expect(V.parseVia(Buffer.from('{"via":"web"}').toString("base64"), true)).toBe("web");
    });
});

describe("持ち主だけに返す（GET /user/photos/{id}/views）", () => {
    it("持ち主には app・web・合計・数え始めた日を返す", async () => {
        world({ p1: PUBLIC, "views#p1": { id: "views#p1", app: 820, web: 414, since: "2026-12-01" } });
        const res = await getOne("me", "p1");
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ app: 820, web: 414, total: 1234, since: "2026-12-01" });
    });

    it("まだ数えていない写真は 0 と since: null", async () => {
        world({ p1: PUBLIC });
        expect(JSON.parse((await getOne("me", "p1")).body)).toEqual({ app: 0, web: 0, total: 0, since: null });
    });

    it("持ち主でない人・無い写真・ストーリーは同じ 404（数の行を読まない）", async () => {
        world({ p1: PUBLIC, s1: { id: "s1", src: "x", userId: "me", story: true }, "views#p1": { app: 5 } });
        for (const [sub, id] of [["other", "p1"], ["me", "nope"], ["me", "s1"]]) {
            mockDdbSend.mockClear();
            expect((await getOne(sub, id)).statusCode, `${sub} ${id}`).toBe(404);
            expect(calls().some((c) => keyOf(c).startsWith("views#")), `${sub} ${id}`).toBe(false);
        }
    });

    it("古い行（uploadedBy だけ）も持ち主として読む", async () => {
        world({ p1: { id: "p1", src: "x", uploadedBy: "me" }, "views#p1": { app: 2 } });
        expect(JSON.parse((await getOne("me", "p1")).body).total).toBe(2);
    });
});

describe("まとめて読む（GET /user/photos/views?ids=）", () => {
    it("持ち主の写真だけ返す（他人の写真・無い写真は落とす）", async () => {
        world({
            p1: PUBLIC, p2: { id: "p2", src: "x", userId: "me", published: false }, p3: { id: "p3", src: "x", userId: "other" },
            "views#p1": { id: "views#p1", app: 3, web: 4 }, "views#p2": { id: "views#p2", app: 1 }, "views#p3": { id: "views#p3", app: 99 },
        });
        const res = await getMany("me", "p1,p2,p3,nope");
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ views: { p1: { app: 3, web: 4 }, p2: { app: 1, web: 0 } } });
        // 他人の写真の数の行は読まない
        const batchKeys = calls().filter((c) => c.constructor.name === "BatchGetCommand")
            .flatMap((c) => (c.input.RequestItems as Record<string, { Keys: { id: string }[] }>)["photos-test"].Keys.map((k) => k.id));
        expect(batchKeys).not.toContain("views#p3");
    });

    it(`1回に ${101} 枚以上は 400`, async () => {
        const ids = Array.from({ length: V.MAX_IDS + 1 }, (_, i) => `p${i}`).join(",");
        expect((await getMany("me", ids)).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("空なら DB を読まずに空の答え", async () => {
        expect(JSON.parse((await getMany("me", "")).body)).toEqual({ views: {} });
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("読み残し（UnprocessedKeys）は読み直す", async () => {
        let first = true;
        mockDdbSend.mockImplementation(async (c: Cmd) => {
            const keys = (c.input.RequestItems as Record<string, { Keys: { id: string }[] }>)["photos-test"].Keys;
            if (keys[0].id === "p1") return { Responses: { "photos-test": [PUBLIC] } };
            if (first) { first = false; return { Responses: { "photos-test": [] }, UnprocessedKeys: { "photos-test": { Keys: keys } } }; }
            return { Responses: { "photos-test": [{ id: "views#p1", web: 7 }] } };
        });
        expect(JSON.parse((await getMany("me", "p1")).body)).toEqual({ views: { p1: { app: 0, web: 7 } } });
    });
});

describe("スタックの設定（serverless.photo-views.yml・serverless.yml）", () => {
    const root = join(__dirname, "..", "..");
    const yml = readFileSync(join(root, "serverless.photo-views.yml"), "utf8").replace(/^\s*#.*$/gm, "");
    const user = readFileSync(join(root, "serverless.yml"), "utf8").replace(/^\s*#.*$/gm, "");

    it("数える口は未認証・読む口は認可つき", () => {
        expect(yml).toMatch(/recordPhotoView:[\s\S]*?path: \/photos\/\{id\}\/view\n\s+method: POST\n(?!\s+authorizer)/);
        expect(yml).toMatch(/getPhotoViews:[\s\S]*?path: \/user\/photos\/\{id\}\/views\n\s+method: GET\n\s+authorizer:/);
        expect(yml).toMatch(/getMyPhotoViews:[\s\S]*?path: \/user\/photos\/views\n\s+method: GET\n\s+authorizer:/);
    });

    it("数える口の役は views# の行の UpdateItem だけ（写真の行を書けない・消せない）", () => {
        const role = yml.split("PhotoViewsRecordRole:\n").pop()!.split("PhotoViewsReadRole:")[0];
        expect(role).toMatch(/- dynamodb:UpdateItem\n[\s\S]*?dynamodb:LeadingKeys:\n\s+- views#\*/);
        expect(role).not.toMatch(/PutItem|DeleteItem|BatchWriteItem|Scan|Query/);
        const read = yml.split("PhotoViewsReadRole:\n").pop()!;
        expect(read).not.toMatch(/UpdateItem|PutItem|DeleteItem/);
    });

    it("既定の役（provider の iam）を持たない＝どの関数も自分の役を使う", () => {
        expect(yml.split("\nfunctions:\n")[0]).not.toMatch(/\n\s+iam:/);
        expect((yml.match(/\n {4}role: PhotoViews(Record|Read)Role/g) ?? []).length).toBe(3);
    });

    it("user API の段がこの口だけ流量を絞る", () => {
        expect(user).toMatch(/RouteSettings:[\s\S]*"POST \/photos\/\{id\}\/view":\n\s+ThrottlingRateLimit: \d+\n\s+ThrottlingBurstLimit: \d+/);
    });
});
