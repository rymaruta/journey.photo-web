import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";

/**
 * プロフィールの保存（`PUT /user/profile`）の言葉の判定（App Store の審査 1.2・`contentFilter.ts`）。
 *
 * 縛ること:
 *  1. 名前・@ユーザー名・自己紹介・ひとこと・拠点・旅の題にひどい言葉を入れたら、**何も書かずに** 400 `content_rejected`
 *  2. **変えた項目だけを見る**——保存済みの文に当たる語があっても、同じ文のまま送る別の保存（検索に出さない等）は止めない
 *
 * プロフィールは users テーブルを素の DynamoDB クライアントで読み書きするので、`profileWebsite.test.ts` と同じ形で真似る
 */

const mockSend = vi.hoisted(() => vi.fn());
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

const { updateMyProfile } = await import("../userProfile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (body: unknown): Promise<Result> => (updateMyProfile as any)({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: JSON.stringify(body),
});
const codeOf = (r: Result) => (JSON.parse(r.body) as { code?: string }).code;
const writes = () => commands.filter((c) => c.type === "Put" || c.type === "Delete");

let stored: Record<string, unknown> | null = null;

beforeEach(() => {
    commands.length = 0;
    stored = null;
    mockSend.mockReset();
    mockSend.mockImplementation(async (cmd: { input: Record<string, unknown> }) => {
        const c = commands.find((x) => x.input === cmd.input);
        if (c?.type === "Get") return stored ? { Item: marshall(stored, { removeUndefinedValues: true }) } : {};
        return {};
    });
});

const BAD = "fucking idiot";
const BAD_JA = "ぶっ殺すぞ";

describe("ひどい言葉は書かずに 400 content_rejected", () => {
    it.each([
        ["名前", { displayName: BAD }],
        ["名前（日本語）", { displayName: BAD_JA }],
        ["@ユーザー名", { username: "kill_yourself" }],
        ["自己紹介", { bio: `旅が好きです。${BAD_JA}` }],
        ["ひとこと", { statusText: BAD }],
        ["拠点", { homeLocation: BAD_JA }],
        ["旅の題", { tripTitles: { "trip-1700000000": BAD_JA } }],
    ])("%s", async (_n, body) => {
        stored = { userId: "u1", displayName: "旅人" };
        const r = await invoke(body);
        expect(r.statusCode, r.body).toBe(400);
        expect(codeOf(r)).toBe("content_rejected");
        expect(writes()).toHaveLength(0);
    });
});

describe("変えた項目だけを見る", () => {
    it("保存済みの自己紹介のまま「検索に出さない」を保存できる", async () => {
        stored = { userId: "u1", bio: BAD_JA };
        const r = await invoke({ bio: BAD_JA, searchHidden: true });
        expect(codeOf(r)).not.toBe("content_rejected");
        expect(r.statusCode).toBe(200);
    });
    it("前からある旅の題はそのままで、新しい旅の題だけを見る", async () => {
        stored = { userId: "u1", tripTitles: { "trip-1": BAD_JA } };
        const ok = await invoke({ tripTitles: { "trip-1": BAD_JA, "trip-2": "秋の京都" } });
        expect(codeOf(ok)).not.toBe("content_rejected");
        const ng = await invoke({ tripTitles: { "trip-1": BAD_JA, "trip-2": BAD } });
        expect(codeOf(ng)).toBe("content_rejected");
    });
    it("ふつうの名前と自己紹介は保存できる", async () => {
        stored = { userId: "u1" };
        const r = await invoke({ displayName: "山田 太郎", bio: "京都と大阪の写真を撮っています", statusText: "紅葉を探し中" });
        expect(r.statusCode, r.body).toBe(200);
    });
});
