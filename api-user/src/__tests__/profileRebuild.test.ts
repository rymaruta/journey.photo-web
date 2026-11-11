import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";

/**
 * **プロフィールの保存で、静的な頁の作り直しを頼む**（2026-11-11 journey.photo-ios#525）。
 *
 * 静的な `/users/<id>` の title・説明・`@ユーザー名`・構造化データはビルド時に
 * users テーブルから引く。それまでこの保存は再ビルドを頼んでおらず、名前を変えても
 * 誰かが次に投稿・編集するまで検索に出る頁は古い名前のままだった。
 * 頼むのは Lambda の入口（`profileUpdate.ts`）——`userProfile.ts` は他の関数からも
 * import されるので、直に `rebuild.ts` を持たない（`rebuildTokenScope.test.ts`）。
 */
const mockSend = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@aws-sdk/client-dynamodb", () => {
    const make = () => class { input: unknown; constructor(input: unknown) { this.input = input; } };
    return {
        DynamoDBClient: class { send = mockSend; },
        GetItemCommand: make(),
        PutItemCommand: make(),
        DeleteItemCommand: make(),
    };
});
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));

const { updateMyProfile } = await import("../profileUpdate");
const { publicStaticFieldsChanged, STATIC_PROFILE_FIELDS } = await import("../userProfile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (body: unknown): Promise<Result> => (updateMyProfile as any)({
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
    body: JSON.stringify(body),
});
const stored = (over: Record<string, unknown>) =>
    ({ Item: marshall({ userId: "u1", displayName: "旅人", rev: 1, ...over }, { removeUndefinedValues: true }) });

beforeEach(() => {
    mockSend.mockReset();
    mockRebuild.mockClear();
});

describe("プロフィールの保存と再ビルド", () => {
    it("表示名を変えたら、束ねる形（coalesce）で再ビルドを頼む", async () => {
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValue({});
        const res = await invoke({ displayName: "新しい名前" });
        expect(res.statusCode).toBe(200);
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        expect(mockRebuild).toHaveBeenCalledWith("profile updated: u1", { coalesce: true });
    });

    it("自己紹介を変えても頼む", async () => {
        mockSend.mockResolvedValueOnce(stored({ bio: "前" })).mockResolvedValue({});
        await invoke({ bio: "後の自己紹介" });
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });

    it("静的な頁に出ない項目（ひとこと）だけなら頼まない", async () => {
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValue({});
        const res = await invoke({ statusText: "旅の途中" });
        expect(res.statusCode).toBe(200);
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    it("同じ名前で保存し直しただけなら頼まない", async () => {
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValue({});
        await invoke({ displayName: "旅人" });
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    it("頼むのに失敗しても、保存は成功のまま返す", async () => {
        mockRebuild.mockResolvedValueOnce(false);
        mockSend.mockResolvedValueOnce(stored({})).mockResolvedValue({});
        const res = await invoke({ displayName: "新しい名前" });
        expect(res.statusCode).toBe(200);
    });
});

describe("静的な頁に焼かれる項目の判定", () => {
    it("sync が書き出す項目と同じ並び（表示名＋bio/website/instagram/username/searchHidden）", () => {
        expect([...STATIC_PROFILE_FIELDS].sort()).toEqual(["bio", "displayName", "instagram", "searchHidden", "username", "website"]);
    });
    it("前後の空白だけの違いは変更と見なさない", () => {
        expect(publicStaticFieldsChanged({ bio: "a " }, { bio: "a" })).toBe(false);
        expect(publicStaticFieldsChanged({ username: "a" }, {})).toBe(true);
    });
});
