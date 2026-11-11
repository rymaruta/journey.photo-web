import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * 「検索エンジンにプロフィールを表示しない」（`searchHidden`・2026-11-11 owner 承認・journey.photo-ios#526）。
 * 既定は表示する。行には true のときだけ置く。真偽以外は 400。本人の応答には常に真偽で載せ、
 * 公開プロフィールには出さない。変えたら静的な頁を作り直す（noindex・sitemap に効く）。
 */
const mockSend = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn(async () => true));
const commands = vi.hoisted(() => [] as { type: string; input: Record<string, unknown> }[]);

vi.mock("@aws-sdk/client-dynamodb", () => {
    const make = (type: string) => class {
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) { this.input = input; commands.push({ type, input }); }
    };
    return {
        DynamoDBClient: class { send = mockSend; },
        GetItemCommand: make("Get"),
        PutItemCommand: make("Put"),
        DeleteItemCommand: make("Delete"),
    };
});
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));

const { updateMyProfile } = await import("../profileUpdate");
const { toPublicProfile } = await import("../userProfile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (body: unknown): Promise<Result> => (updateMyProfile as any)({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: JSON.stringify(body),
});
const stored = (over: Record<string, unknown>) =>
    ({ Item: marshall({ userId: "u1", displayName: "旅人", rev: 1, ...over }, { removeUndefinedValues: true }) });
const putItem = () => {
    const put = commands.find((c) => c.type === "Put");
    return put ? unmarshall(put.input.Item as Parameters<typeof unmarshall>[0]) : undefined;
};

beforeEach(() => {
    commands.length = 0;
    mockSend.mockReset();
    mockRebuild.mockClear();
});

describe("検索エンジンにプロフィールを表示しない", () => {
    it("true を保存し、本人の応答に真偽で返し、再ビルドを**束ねずに**頼む", async () => {
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValue({});
        const res = await invoke({ searchHidden: true });
        expect(res.statusCode).toBe(200);
        expect(putItem()?.searchHidden).toBe(true);
        expect(JSON.parse(res.body).searchHidden).toBe(true);
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        // 束ねて見送られると後から実行されず、隠したつもりの頁が索引に残る（確かめ役 2026-11-11）
        expect(mockRebuild).toHaveBeenCalledWith("profile hidden from search: u1", { urgentKey: "hidden#u1" });
    });

    it("オンのまま名前を変えた回は、今までどおり束ねる", async () => {
        mockSend.mockResolvedValueOnce(stored({ searchHidden: true })).mockResolvedValue({});
        await invoke({ displayName: "新しい名前" });
        expect(mockRebuild).toHaveBeenCalledWith("profile updated: u1", { coalesce: true });
    });

    it("false は行から消す（既定の「表示する」に戻す）", async () => {
        mockSend.mockResolvedValueOnce(stored({ searchHidden: true })).mockResolvedValue({});
        const res = await invoke({ searchHidden: false });
        expect(res.statusCode).toBe(200);
        expect(putItem()).not.toHaveProperty("searchHidden");
        expect(JSON.parse(res.body).searchHidden).toBe(false);
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        // 戻す（表示する）側は急がない＝束ねる
        expect(mockRebuild).toHaveBeenCalledWith("profile updated: u1", { coalesce: true });
    });

    it("真偽以外は 400（文字の \"true\" を読み替えない）", async () => {
        const res = await invoke({ searchHidden: "true" });
        expect(res.statusCode).toBe(400);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("触らない保存では消さない", async () => {
        mockSend.mockResolvedValueOnce(stored({ searchHidden: true })).mockResolvedValue({});
        await invoke({ statusText: "旅の途中" });
        expect(putItem()?.searchHidden).toBe(true);
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    it("同じ値で保存し直しても再ビルドは頼まない", async () => {
        mockSend.mockResolvedValueOnce(stored({ searchHidden: true })).mockResolvedValue({});
        await invoke({ searchHidden: true });
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    it("公開プロフィールには出さない", () => {
        const pub = toPublicProfile({ userId: "u1", displayName: "旅人", searchHidden: true });
        expect(pub).not.toHaveProperty("searchHidden");
    });
});
