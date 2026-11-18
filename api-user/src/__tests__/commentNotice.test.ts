import { describe, it, expect, vi, beforeEach } from "vitest";

// **写真の持ち主へのコメントの知らせに、どのコメントか（`commentId`）と本文の抜粋（`text`）**
// （2026-11-18・案 B4、owner 採用）。抜粋の切り方と、コメントを消したときに抜粋を消す処理

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: async () => false,
    hiddenUserIds: async () => new Set<string>(),
}));
vi.stubEnv("USERS_TABLE", "users-test");

const { commentExcerpt, COMMENT_EXCERPT_MAX } = await import("../commentExcerpt");
const { scrubCommentNotifText, notifsId } = await import("../notify");

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

beforeEach(() => {
    mockDdbSend.mockReset().mockResolvedValue({});
});

describe("commentExcerpt", () => {
    it("短い本文はそのまま", () => {
        expect(commentExcerpt("稜線の色がきれいですね")).toBe("稜線の色がきれいですね");
    });

    it("改行と続く空白は1つの空白に寄せる（1行に出す）", () => {
        expect(commentExcerpt("  すてき\n\n どこですか？\t ")).toBe("すてき どこですか？");
    });

    it(`${COMMENT_EXCERPT_MAX} 字を超えたら切って「…」を付ける`, () => {
        const long = "あ".repeat(500);
        const out = commentExcerpt(long);
        expect(out).toBe(`${"あ".repeat(COMMENT_EXCERPT_MAX)}…`);
    });

    it("ちょうど上限なら「…」を付けない", () => {
        const exact = "い".repeat(COMMENT_EXCERPT_MAX);
        expect(commentExcerpt(exact)).toBe(exact);
    });

    it("絵文字を途中で割らない", () => {
        const s = `${"あ".repeat(COMMENT_EXCERPT_MAX - 1)}👍🏽👍🏽`;
        const out = commentExcerpt(s);
        expect(out.endsWith("…")).toBe(true);
        expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });
});

describe("scrubCommentNotifText（消したコメントの抜粋をベルの行から消す）", () => {
    const rows = [
        { type: "like", photoId: "p1", photoSrc: "s", byName: "A", t: "3" },
        { type: "comment", photoId: "p1", photoSrc: "s", byName: "B", commentId: "c9", text: "ほかのコメント", t: "2" },
        { type: "comment", photoId: "p1", photoSrc: "s", byName: "C", commentId: "c1", text: "消すコメント", t: "1" },
    ];

    it("その行の `text` だけを、添字と commentId の条件付きで消す（行は残す）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { items: rows } }).mockResolvedValueOnce({});
        await scrubCommentNotifText("owner", "c1");
        const update = mockDdbSend.mock.calls.map((c) => c[0] as Cmd).find((c) => c.constructor.name === "UpdateCommand");
        expect(update?.input.Key).toEqual({ id: notifsId("owner") });
        expect(update?.input.UpdateExpression).toBe("REMOVE #items[2].#text");
        expect(update?.input.ConditionExpression).toBe("#items[2].commentId = :cid");
        expect(update?.input.ExpressionAttributeValues).toEqual({ ":cid": "c1" });
    });

    it("添字がずれていたら（新しい知らせが積まれた）読み直してやり直す", async () => {
        const shifted = [{ type: "like", photoId: "p2", photoSrc: "s", byName: "D", t: "4" }, ...rows];
        mockDdbSend
            .mockResolvedValueOnce({ Item: { items: rows } })
            .mockRejectedValueOnce(Object.assign(new Error("x"), { name: "ConditionalCheckFailedException" }))
            .mockResolvedValueOnce({ Item: { items: shifted } })
            .mockResolvedValueOnce({});
        await scrubCommentNotifText("owner", "c1");
        const exprs = mockDdbSend.mock.calls.map((c) => c[0] as Cmd)
            .filter((c) => c.constructor.name === "UpdateCommand").map((c) => c.input.UpdateExpression);
        expect(exprs).toEqual(["REMOVE #items[2].#text", "REMOVE #items[3].#text"]);
    });

    it("抜粋を持つ行が無ければ書かない（古い行・もう消した）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { items: [rows[0]] } });
        await scrubCommentNotifText("owner", "c1");
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("落ちても投げない（コメントの削除は成功のまま）", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(scrubCommentNotifText("owner", "c1")).resolves.toBeUndefined();
        spy.mockRestore();
    });
});
