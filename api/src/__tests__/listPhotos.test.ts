import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend } }));
vi.stubEnv("PHOTOS_TABLE", "photos-test");
const { listPhotos, listPhotosByUser } = await import("../ddb-photos");

// **中括弧で囲う。** 式のままだと**モック自身を返す**——vitest は
// フックの戻り値が関数だと後片付けとして扱うので、各テストのあとに
// そのモックが**引数なしで呼ばれる**。実装が `mockResolvedValue` の
// うちは無害だが、引数を見るモックに変えた瞬間に落ちる。
beforeEach(() => { mockDdbSend.mockReset().mockResolvedValue({ Items: [] }); });

const inputOf = (i = 0) => (mockDdbSend.mock.calls[i][0] as { input: Record<string, string> }).input;

// このテーブルには写真だけでなく、いいね/フォローのマーカー、コメント文書、
// 通知文書、ストーリー、そして再ビルドの排他ロックまで同居している。
// 公開一覧に出てよいのは「公開されている写真」だけ。
describe("公開一覧の絞り込み", () => {
    it("写真以外・非公開・ストーリーを除く", async () => {
        await listPhotos();
        const f = inputOf().FilterExpression;
        expect(f).toContain("attribute_exists(src)");        // 写真であること
        expect(f).toContain("published = :pub");             // 公開されていること
        expect(f).toContain("attribute_not_exists(story)");  // ストーリーでないこと
    });

    it("特定の人の一覧も同じ条件で絞る", async () => {
        // ここが緩いと、プロフィールにだけストーリーが混ざる
        await listPhotosByUser("u1");
        const f = inputOf().FilterExpression;
        expect(f).toContain("attribute_exists(src)");
        expect(f).toContain("published = :pub");
        expect(f).toContain("attribute_not_exists(story)");
    });
});

// 🔴 絞り込みは **DynamoDB 側にも**入れる。ハンドラだけに置くと、
// 別の入口が `listPhotos()` を直に呼んだ日に素通りする
// （ストーリーで同じことが起きたので、あちらは両方に入れてある）
describe("公開範囲を絞った写真を、読み取りの段で外す", () => {
    it("一覧（公開一覧の索引の Query）が audience を持つ行を除く", async () => {
        await listPhotos();
        expect(inputOf().FilterExpression).toContain("attribute_not_exists(audience)");
    });

    it("その人の一覧（GSI の Query）も同じ", async () => {
        await listPhotosByUser("u1");
        expect(inputOf().FilterExpression).toContain("attribute_not_exists(audience)");
    });
});


// 🔴 **ログインなしで呼べる `GET /photos` は、表の全部を Scan しない**（2026-11-25・AWS の見直し 2）。
// 表にはいいね・フォローの印、コメント、通知まで同居しているので、Scan だと1回の読む量が表の行の数で増え、
// だれでも何度でも呼べた。公開一覧の索引（`publicFeed-createdAt-index` の仕切り "1"）を新しい順に読む
describe("公開一覧は索引を Query で読む（表の全部を読まない）", () => {
    const callOf = (i = 0) => mockDdbSend.mock.calls[i][0] as { constructor: { name: string }; input: Record<string, unknown> };

    it("ScanCommand を使わず、公開一覧の索引を Query する", async () => {
        await listPhotos();
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
        expect(callOf().constructor.name).toBe("QueryCommand");
        const input = callOf().input;
        expect(input.TableName).toBe("photos-test");
        expect(input.IndexName).toBe("publicFeed-createdAt-index");
        expect(input.KeyConditionExpression).toBe("publicFeed = :k");
        expect((input.ExpressionAttributeValues as Record<string, unknown>)[":k"]).toBe("1");
        expect(input.ScanIndexForward).toBe(false);
    });

    it("続きがある間は読み続け、全部を新しい順で返す（Scan のときと同じ中身と並び）", async () => {
        const a = { id: "a", src: "s", createdAt: "2026-11-01T00:00:00Z" };
        const b = { id: "b", src: "s", createdAt: "2026-11-03T00:00:00Z" };
        const c = { id: "c", src: "s", createdAt: "2026-11-02T00:00:00Z" };
        mockDdbSend
            .mockResolvedValueOnce({ Items: [b, c], LastEvaluatedKey: { id: "c", publicFeed: "1", createdAt: c.createdAt } })
            .mockResolvedValueOnce({ Items: [a] });
        const out = await listPhotos();
        expect(out.map((p) => p.id)).toEqual(["b", "c", "a"]);
        expect(mockDdbSend).toHaveBeenCalledTimes(2);
        expect(callOf(1).input.ExclusiveStartKey).toEqual({ id: "c", publicFeed: "1", createdAt: c.createdAt });
        // 2回目も同じ索引・同じ絞り込み
        expect(callOf(1).constructor.name).toBe("QueryCommand");
        expect(callOf(1).input.IndexName).toBe("publicFeed-createdAt-index");
    });

    it("索引から来た行の順が崩れていても、createdAt の新しい順に並べ直す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [
            { id: "old", src: "s", createdAt: "2026-01-01T00:00:00Z" },
            { id: "new", src: "s", createdAt: "2026-12-01T00:00:00Z" },
        ] });
        expect((await listPhotos()).map((p) => p.id)).toEqual(["new", "old"]);
    });
});
