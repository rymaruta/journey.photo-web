import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * みんなの「行きたい」を数える（2026-11-11・撮影スポットを払うの②・`spotWants.ts`）。
 *
 * 固定したいのは:
 *  1. 台帳にある撮影スポットの鍵だけ受ける・1回に10件まで・端末の ID の形
 *  2. 同じ端末・同じ撮影スポットは月1回（重なりは数えない）
 *  3. 1端末1日50件・同じ回線1日300件（上限に達したら残りは数えない）
 *  4. IP は保存しない（行の鍵は塩と混ぜたハッシュ・生の IP はどこにも書かない）
 *  5. 10未満は配らない・急に増えたものは上位から外す・古い行だけ消す
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
const mockS3Send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    PutObjectCommand: class { constructor(public input: unknown) {} },
}));

const W = await import("../spotWants");
const SLUG = W.allSlugs()[0];
const SLUG2 = W.allSlugs()[1];
const DEVICE = "dev_abcdefghijklmnop";

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
const calls = () => mockDdbSend.mock.calls.map(([c]) => c as Cmd);
const ev = (body: unknown, ip = "203.0.113.7") => ({
    body: typeof body === "string" ? body : JSON.stringify(body),
    requestContext: { http: { method: "POST", sourceIp: ip } },
}) as never;
const run = async (e: never) => (await W.recordSpotWants(e, {} as never, () => undefined)) as { statusCode: number; body: string };
const condFail = () => Object.assign(new Error("x"), { name: "ConditionalCheckFailedException" });

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset();
});

/** ddb の振る舞い: 塩は在る・上限と重なりは `fail` に入れた鍵の頭で断る */
function ddbWith(fail: (id: string) => boolean = () => false) {
    mockDdbSend.mockImplementation(async (c: Cmd) => {
        const id = (c.input.Key as { id?: string } | undefined)?.id ?? "";
        if (c.constructor.name === "GetCommand") return { Item: id.startsWith("wantsalt#") ? { id, salt: "s" } : undefined };
        if (c.constructor.name === "UpdateCommand" && fail(id)) throw condFail();
        return {};
    });
}

describe("受ける鍵", () => {
    it("台帳にある鍵だけ・重なりを落とす・10件まで・SPOT- 付きでも受ける", () => {
        const p = W.parseWants(JSON.stringify({ device: DEVICE, slugs: [`SPOT-${SLUG}`, SLUG, "no-such-spot-xyz", 3, ...W.allSlugs().slice(1, 20)] }));
        expect(p?.slugs[0]).toBe(SLUG);
        expect(p?.slugs).not.toContain("no-such-spot-xyz");
        expect(p?.slugs.length).toBeLessThanOrEqual(W.MAX_PER_REQUEST);
        expect(new Set(p?.slugs).size).toBe(p?.slugs.length);
    });

    it("端末の ID の形が違う・壊れた本文は 400", async () => {
        expect(W.parseWants(JSON.stringify({ device: "short", slugs: [SLUG] }))).toBeNull();
        expect(W.parseWants(JSON.stringify({ device: "a b c d e f g h i j k l m n", slugs: [SLUG] }))).toBeNull();
        expect((await run(ev("{nope"))).statusCode).toBe(400);
    });
});

describe("数える", () => {
    it("端末の日の上限 → 回線の日の上限 → 月1回 → 数を進める", async () => {
        ddbWith();
        const res = await run(ev({ device: DEVICE, slugs: [SLUG] }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ counted: 1 });
        const ups = calls().filter((c) => c.constructor.name === "UpdateCommand").map((c) => (c.input.Key as { id: string }).id);
        const { month, day } = W.jstParts(new Date());
        expect(ups[0]).toBe(`wantday#${day}#${DEVICE}`);
        expect(ups[1]).toMatch(new RegExp(`^wantip#${day}#`));
        expect(ups[2]).toBe(`wantby#${month}#${DEVICE}`);
        expect(ups[3]).toBe(`spotwant#${month}#${SLUG}`);
    });

    it("同じ端末・同じ撮影スポットはその月1回（数を進めない）", async () => {
        ddbWith((id) => id.startsWith("wantby#"));
        const res = await run(ev({ device: DEVICE, slugs: [SLUG, SLUG2] }));
        expect(JSON.parse(res.body)).toEqual({ counted: 0 });
        expect(calls().some((c) => String((c.input.Key as { id?: string })?.id).startsWith("spotwant#"))).toBe(false);
    });

    it("端末の日の上限に達したら残りは数えない", async () => {
        ddbWith((id) => id.startsWith("wantday#"));
        expect(JSON.parse((await run(ev({ device: DEVICE, slugs: [SLUG, SLUG2] }))).body)).toEqual({ counted: 0 });
        const cond = calls().find((c) => c.constructor.name === "UpdateCommand")!.input;
        expect(cond.ConditionExpression).toContain("n < :max");
        expect((cond.ExpressionAttributeValues as Record<string, number>)[":max"]).toBe(W.DEVICE_DAILY_MAX);
    });

    it("回線の日の上限に達したら数えない（上限は300）", async () => {
        ddbWith((id) => id.startsWith("wantip#"));
        expect(JSON.parse((await run(ev({ device: DEVICE, slugs: [SLUG] }))).body)).toEqual({ counted: 0 });
        const ipCall = calls().find((c) => String((c.input.Key as { id?: string })?.id).startsWith("wantip#"))!;
        expect((ipCall.input.ExpressionAttributeValues as Record<string, number>)[":max"]).toBe(W.IP_DAILY_MAX);
    });

    it("生の IP はどこにも書かない（塩と混ぜたハッシュだけ）", async () => {
        ddbWith();
        await run(ev({ device: DEVICE, slugs: [SLUG] }, "198.51.100.23"));
        expect(JSON.stringify(mockDdbSend.mock.calls)).not.toContain("198.51.100.23");
        expect(W.hashIp("198.51.100.23", "a")).not.toBe(W.hashIp("198.51.100.23", "b"));
    });

    it("書き込みに失敗したら 500（数えたふりをしない）", async () => {
        mockDdbSend.mockRejectedValue(new Error("boom"));
        expect((await run(ev({ device: DEVICE, slugs: [SLUG] }))).statusCode).toBe(500);
    });
});

describe("毎日の集計", () => {
    it("10未満は載せない・印の付いたものは外す・同じ数は同じ順位", () => {
        const f = W.rankWants(new Map([["a", 30], ["b", 12], ["c", 12], ["d", 9], ["e", 100]]), new Set(["e"]), "2026-11", new Date(0));
        expect(f.spots.map(({ slug, n, rank }) => ({ slug, n, rank }))).toEqual([{ slug: "a", n: 30, rank: 1 }, { slug: "b", n: 12, rank: 2 }, { slug: "c", n: 12, rank: 2 }]);
    });

    it("急に増えた: 1日に30以上・しかも倍を超えた", () => {
        expect(W.isSpike(0, 30)).toBe(true);
        expect(W.isSpike(0, 29)).toBe(false);
        expect(W.isSpike(100, 140)).toBe(false);
        expect(W.isSpike(40, 90)).toBe(true);
    });

    it("消すのは前の月より古い重なり止めと、前日より古い日の行・塩だけ", () => {
        const month = "2026-11", day = "2026-11-11";
        expect(W.isExpiredRow("wantby#2026-09#d", month, day)).toBe(true);
        expect(W.isExpiredRow("wantby#2026-10#d", month, day)).toBe(false);
        expect(W.isExpiredRow("wantday#2026-11-09#d", month, day)).toBe(true);
        expect(W.isExpiredRow("wantday#2026-11-10#d", month, day)).toBe(false);
        expect(W.isExpiredRow("wantsalt#2026-11-09", month, day)).toBe(true);
        expect(W.isExpiredRow("spotwant#2025-01#a", month, day), "数の行は消さない").toBe(false);
        expect(W.isExpiredRow("spots#user", month, day)).toBe(false);
        // 年をまたぐ
        expect(W.isExpiredRow("wantby#2025-12#d", "2026-01", "2026-01-01")).toBe(false);
        expect(W.isExpiredRow("wantby#2025-11#d", "2026-01", "2026-01-01")).toBe(true);
    });

    it("数を読み、印を残し、Web の置き場の1ファイルに書き、古い行を消す", async () => {
        process.env.SITE_BUCKET = "site-test";
        const { month } = W.jstParts(new Date());
        mockDdbSend.mockImplementation(async (c: Cmd) => {
            const n = c.constructor.name;
            if (n === "BatchGetCommand") {
                const keys = (c.input.RequestItems as Record<string, { Keys: { id: string }[] }>)["photos-test"].Keys;
                return { Responses: { "photos-test": keys.filter((k) => k.id === `spotwant#${month}#${SLUG}` || k.id === `spotwant#${month}#${SLUG2}`)
                    .map((k) => ({ id: k.id, n: k.id.endsWith(SLUG) ? 20 : 40 })) } };
            }
            if (n === "GetCommand") return { Item: { counts: { [SLUG]: 19, [SLUG2]: 0 }, flagged: [] } };
            if (n === "ScanCommand") return { Items: [{ id: "wantby#2000-01#x" }, { id: `wantby#${month}#y` }] };
            return {};
        });
        await W.aggregateSpotWants({} as never, {} as never, () => undefined);
        const put = mockS3Send.mock.calls[0][0].input as { Bucket: string; Key: string; Body: string };
        expect(put.Bucket).toBe("site-test");
        expect(put.Key).toBe("app/data/spot-wants.json");
        const file = JSON.parse(put.Body);
        // SLUG2 は 0 → 40 で急に増えた＝外す
        expect(file.spots.map(({ slug, n, rank }: { slug: string; n: number; rank: number }) => ({ slug, n, rank }))).toEqual([{ slug: SLUG, n: 20, rank: 1 }]);
        expect(file.spots[0].name, "名前も配る（頁が索引を読まずに出せる）").toBeTruthy();
        const snap = calls().find((c) => c.constructor.name === "PutCommand")!.input.Item as { flagged: string[] };
        expect(snap.flagged).toEqual([SLUG2]);
        const deleted = calls().filter((c) => c.constructor.name === "DeleteCommand").map((c) => (c.input.Key as { id: string }).id);
        expect(deleted).toEqual(["wantby#2000-01#x"]);
    });
});
