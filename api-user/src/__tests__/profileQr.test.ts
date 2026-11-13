import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock は import より先に効く（巻き上げ）ので、口はそのまま取り込める
import { getMyQr, rotateMyQr, resolveQr, qrKey, qrOfKey, isValidQrToken, QR_UNUSABLE_MESSAGE } from "../profileQr";

// 退会の確かめ（`liveCaller.ts`）は生きている本人として通す。墓石の 410 は下で1件だけ差し替えて見る
const liveCaller = vi.hoisted(() => ({ gone: null as null | { statusCode: number; body: string } }));
vi.mock("../liveCaller", async (orig) => ({
    ...(await orig<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => liveCaller.gone,
}));

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));


type Result = { statusCode: number; body: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
const call = (fn: unknown, event: unknown): Promise<Result> => (fn as any)(event);
const authed = (sub: string) => ({ requestContext: { authorizer: { jwt: { claims: { sub } } } } });
const pub = (token?: string) => ({ pathParameters: token === undefined ? undefined : { token } });
const inputs = () => mockSend.mock.calls.map((c) => (c[0] as { input: Record<string, any> }).input);
const bodyOf = (r: Result) => JSON.parse(r.body);
const cancelled = () => Object.assign(new Error("cancelled"), { name: "TransactionCanceledException" });

const OLD = "A".repeat(32);

beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
    liveCaller.gone = null;
});

describe("行の形", () => {
    it("合図の行・人の行の鍵", () => {
        expect(qrKey("abc")).toBe("qr#abc");
        expect(qrOfKey("u1")).toBe("qrof#u1");
    });

    it("書く行は索引の欄（userId・createdAt・storyFeed・publicFeed）を持たない", async () => {
        mockSend.mockResolvedValueOnce({});   // qrof# は無い
        await call(getMyQr, authed("u1"));
        const tx = inputs().find((i) => i.TransactItems)!;
        for (const t of tx.TransactItems) {
            const item = t.Put?.Item;
            if (!item) continue;
            for (const k of ["userId", "createdAt", "storyFeed", "publicFeed", "expiresAt"]) expect(item).not.toHaveProperty(k);
        }
    });
});

describe("GET /user/qr", () => {
    it("ログインしていなければ 401", async () => {
        const r = await call(getMyQr, { requestContext: { authorizer: { jwt: { claims: {} } } } });
        expect(r.statusCode).toBe(401);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("退会した本人は 410 で、何も書かない", async () => {
        liveCaller.gone = { statusCode: 410, body: "{}" };
        const r = await call(getMyQr, authed("u1"));
        expect(r.statusCode).toBe(410);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("今の合図があればそれを返し、書かない", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "qrof#u1", token: OLD, issuedAt: "2026-11-12T00:00:00.000Z" } });
        const r = await call(getMyQr, authed("u1"));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ token: OLD, issuedAt: "2026-11-12T00:00:00.000Z" });
        expect(inputs()).toHaveLength(1);
        expect(inputs()[0]).toMatchObject({ Key: { id: "qrof#u1" }, ConsistentRead: true });
    });

    it("無ければ作る（2行を1回のまとめ書き・どちらも無いことが条件）", async () => {
        mockSend.mockResolvedValueOnce({});
        const r = await call(getMyQr, authed("u1"));
        expect(r.statusCode).toBe(200);
        const { token } = bodyOf(r);
        expect(isValidQrToken(token)).toBe(true);
        expect(token).toHaveLength(32);
        const tx = inputs()[1];
        expect(tx.TransactItems).toHaveLength(2);
        expect(tx.TransactItems[0].Put).toMatchObject({ Item: { id: `qr#${token}`, owner: "u1" }, ConditionExpression: "attribute_not_exists(id)" });
        expect(tx.TransactItems[1].Put).toMatchObject({ Item: { id: "qrof#u1", token }, ConditionExpression: "attribute_not_exists(id)" });
    });

    it("同時に作られたら、先に作られた方を返す", async () => {
        mockSend
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(cancelled())
            .mockResolvedValueOnce({ Item: { id: "qrof#u1", token: OLD, issuedAt: "x" } });
        const r = await call(getMyQr, authed("u1"));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).token).toBe(OLD);
    });

    it("まとめ書きの失敗が条件の崩れでなければ投げる（握りつぶさない）", async () => {
        mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("boom"));
        await expect(call(getMyQr, authed("u1"))).rejects.toThrow("boom");
    });
});

describe("POST /user/qr/rotate", () => {
    it("ログインしていなければ 401", async () => {
        const r = await call(rotateMyQr, { requestContext: { authorizer: { jwt: { claims: {} } } } });
        expect(r.statusCode).toBe(401);
    });

    it("新しい合図にして、前の qr# を消し、qrof# は前の合図のままであることを条件に替える（3行・1回）", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "qrof#u1", token: OLD } });
        const r = await call(rotateMyQr, authed("u1"));
        expect(r.statusCode).toBe(200);
        const { token } = bodyOf(r);
        expect(token).not.toBe(OLD);
        const tx = inputs()[1];
        expect(tx.TransactItems).toHaveLength(3);
        expect(tx.TransactItems[0].Put.Item).toMatchObject({ id: `qr#${token}`, owner: "u1" });
        expect(tx.TransactItems[1].Put).toMatchObject({
            Item: { id: "qrof#u1", token },
            ConditionExpression: "#t = :prev",
            ExpressionAttributeValues: { ":prev": OLD },
        });
        expect(tx.TransactItems[2].Delete).toMatchObject({ Key: { id: `qr#${OLD}` } });
    });

    it("まだ合図が無い人の更新は、作るのと同じ（消す行は無い）", async () => {
        mockSend.mockResolvedValueOnce({});
        const r = await call(rotateMyQr, authed("u1"));
        expect(r.statusCode).toBe(200);
        expect(inputs()[1].TransactItems).toHaveLength(2);
    });

    it("別の画面と同時に更新して条件が崩れたら 409", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "qrof#u1", token: OLD } }).mockRejectedValueOnce(cancelled());
        const r = await call(rotateMyQr, authed("u1"));
        expect(r.statusCode).toBe(409);
    });

    it("退会した本人は 410", async () => {
        liveCaller.gone = { statusCode: 410, body: "{}" };
        expect((await call(rotateMyQr, authed("u1"))).statusCode).toBe(410);
        expect(mockSend).not.toHaveBeenCalled();
    });
});

describe("GET /qr/{token}（ログイン不要）", () => {
    it("使える合図なら人の ID を返す（qr# の GetItem 1回だけ）", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: `qr#${OLD}`, owner: "u1", issuedAt: "x" } });
        const r = await call(resolveQr, pub(OLD));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ userId: "u1" });
        expect(inputs()).toEqual([{ TableName: "photos-test", Key: { id: `qr#${OLD}` } }]);
    });

    it("行が無ければ（更新された・退会した）404 と1つの言葉", async () => {
        mockSend.mockResolvedValueOnce({});
        const r = await call(resolveQr, pub(OLD));
        expect(r.statusCode).toBe(404);
        expect(bodyOf(r).error).toBe(QR_UNUSABLE_MESSAGE);
    });

    it.each([undefined, "", "short", "a".repeat(65), `${"a".repeat(31)}=`, "../qrof#u1".padEnd(40, "a")])(
        "形の悪い合図（%s）は表を引かずに 404",
        async (t) => {
            const r = await call(resolveQr, pub(t));
            expect(r.statusCode).toBe(404);
            expect(mockSend).not.toHaveBeenCalled();
        },
    );
});

describe("返事を控えさせない（Cache-Control: no-store）", () => {
    const noStore = (r: Result & { headers?: Record<string, string> }) => r.headers?.["Cache-Control"];

    it("GET /user/qr は今の合図でも作った合図でも no-store", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "qrof#u1", token: OLD, issuedAt: "x" } });
        expect(noStore(await call(getMyQr, authed("u1")))).toBe("no-store");
        mockSend.mockReset().mockResolvedValue({});
        expect(noStore(await call(getMyQr, authed("u1")))).toBe("no-store");
    });

    it("POST /user/qr/rotate は no-store", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "qrof#u1", token: OLD } });
        expect(noStore(await call(rotateMyQr, authed("u1")))).toBe("no-store");
    });

    it("GET /qr/{token} は使える答えも使えない答え（404）も no-store", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: `qr#${OLD}`, owner: "u1" } });
        expect(noStore(await call(resolveQr, pub(OLD)))).toBe("no-store");
        mockSend.mockResolvedValueOnce({});
        const gone = await call(resolveQr, pub(OLD));
        expect(gone.statusCode).toBe(404);
        expect(noStore(gone)).toBe("no-store");
        const bad = await call(resolveQr, pub("bad"));
        expect(noStore(bad)).toBe("no-store");
        expect(JSON.parse(bad.body).error).toBe(QR_UNUSABLE_MESSAGE);
    });
});
