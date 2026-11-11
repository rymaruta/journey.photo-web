import { describe, it, expect, vi, beforeEach } from "vitest";

// **コメントに返信**（2026-11-11 owner 承認・journey.photo-ios#541 の ②）。
// モックの組み方は `comments.test.ts` と同じ（退会の確かめ・表示名・ブロックは境界で差し替える）
const mockReadLive = vi.hoisted(() => vi.fn());
vi.mock("../liveCaller", async (orig) => ({
    ...(await orig<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => null,
    readLiveCaller: (...a: unknown[]) => mockReadLive(...a),
}));

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
const mockDeletedIds = vi.hoisted(() => vi.fn<(ids?: unknown) => Promise<Set<string>>>(async () => new Set<string>()));
const mockUnreadIds = vi.hoisted(() => vi.fn<() => Set<string>>(() => new Set<string>()));
vi.mock("../notify", () => ({
    pushNotification: mockPush,
    displayNameOf: (r?: { displayName?: unknown }) =>
        (typeof r?.displayName === "string" && r.displayName.trim()) || undefined,
    DEFAULT_NAME: "名前未設定さん",
    deletedAmong: async (ids: unknown) => ({ deleted: await mockDeletedIds(ids), unread: mockUnreadIds() }),
    withUnreadAsDeleted: (r: { deleted: Set<string>; unread: Set<string> }) => new Set([...r.deleted, ...r.unread]),
    DELETED_USER_NAME: "退会したユーザー",
}));

const mockIsBlocked = vi.hoisted(() => vi.fn(async (_blocker: string, _blocked: string) => false));
vi.mock("../blockCheck", () => ({
    isBlocked: (a: string, b: string) => mockIsBlocked(a, b),
    blockMarkerId: (a: string, b: string) => `block#${a}#${b}`,
}));

const { getComments, postComment, resolveReplyTo } = await import("../comments");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, params: Record<string, string> | undefined, body?: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: params,
        body: body === undefined ? undefined : JSON.stringify(body),
    };
}

/** けんじ（kenji）が先に書いたコメント。みか（mika）が写真の持ち主 */
const kenjiComment = { id: "c-kenji", uid: "kenji", name: "けんじ", text: "どこから撮りましたか？", t: "2026-11-11T00:00:00Z" };
const mikaComment = { id: "c-mika", uid: "mika", name: "みか", text: "ありがとう", t: "2026-11-11T01:00:00Z" };

type Cmd = { constructor: { name: string }; input: Record<string, unknown> & { Key?: { id?: string } } };

/** 写真 p1（持ち主 mika）とコメント欄。書き込みは捕まえて返す */
function world(items: Record<string, unknown>[] = [kenjiComment, mikaComment]) {
    const writes: Cmd[] = [];
    mockDdbSend.mockImplementation((cmd: Cmd) => {
        if (cmd.constructor.name === "GetCommand") {
            const id = String(cmd.input.Key?.id ?? "");
            if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "s", thumbSrc: "t", userId: "mika", location: "金沢" } });
            if (id === "comments#p1") return Promise.resolve({ Item: { items } });
            return Promise.resolve({});
        }
        writes.push(cmd);
        return Promise.resolve({ Attributes: { items: [...items, { id: "new" }] } });
    });
    return writes;
}

/** 追記した1件（`list_append` の `:new`） */
function appended(writes: Cmd[]): Record<string, unknown> {
    const w = writes.find((x) => String(x.input.UpdateExpression ?? "").includes("list_append"));
    const vals = w?.input.ExpressionAttributeValues as { ":new": Record<string, unknown>[] } | undefined;
    return vals![":new"][0];
}

const sentTypes = () => mockPush.mock.calls.map((c) => [c[0], c[1].type]);

beforeEach(() => {
    mockUnreadIds.mockReset().mockReturnValue(new Set<string>());
    mockDdbSend.mockReset();
    mockDeletedIds.mockReset().mockResolvedValue(new Set<string>());
    mockPush.mockReset().mockResolvedValue(undefined);
    mockIsBlocked.mockReset().mockResolvedValue(false);
    mockReadLive.mockReset().mockImplementation(async (uid: string) => ({ row: { userId: uid, displayName: uid === "sora" ? "そら" : uid } }));
});

describe("postComment: 返信", () => {
    it("返信の相手を行に書き、相手に「コメントへの返信」を知らせる（持ち主には今までどおりコメントの知らせ）", async () => {
        const writes = world();
        const res = await invoke(postComment, ev("sora", { id: "p1" }, { text: "坂の上からです", replyTo: "c-kenji" }));
        expect(res.statusCode).toBe(200);
        expect(appended(writes).replyTo).toEqual({ id: "c-kenji", uid: "kenji", name: "けんじ" });
        expect(JSON.parse(res.body).comment.replyTo).toEqual({ id: "c-kenji", uid: "kenji", name: "けんじ" });
        expect(sentTypes()).toEqual([["kenji", "commentreply"], ["mika", "comment"]]);
        const reply = mockPush.mock.calls[0][1];
        expect(reply).toMatchObject({ photoId: "p1", byId: "sora", byName: "そら", photoSrc: "t" });
        expect(reply.commentId).toBe(appended(writes).id);
    });

    it("相手が写真の持ち主なら、持ち主には返信の知らせ1つだけ（2つ届けない）", async () => {
        world();
        expect((await invoke(postComment, ev("sora", { id: "p1" }, { text: "どうも", replyTo: "c-mika" }))).statusCode).toBe(200);
        expect(sentTypes()).toEqual([["mika", "commentreply"]]);
    });

    it("自分のコメントへの返信は、自分に知らせない", async () => {
        world();
        expect((await invoke(postComment, ev("kenji", { id: "p1" }, { text: "追記です", replyTo: "c-kenji" }))).statusCode).toBe(200);
        expect(sentTypes()).toEqual([["mika", "comment"]]);
    });

    it("相手が自分をブロックしていたら知らせない", async () => {
        world();
        mockIsBlocked.mockImplementation(async (blocker: string, blocked: string) => blocker === "kenji" && blocked === "sora");
        expect((await invoke(postComment, ev("sora", { id: "p1" }, { text: "x", replyTo: "c-kenji" }))).statusCode).toBe(200);
        expect(sentTypes()).toEqual([["mika", "comment"]]);
    });

    it("自分が相手をブロックしていても知らせない（`pushNotification` が見ない向き）", async () => {
        world();
        mockIsBlocked.mockImplementation(async (blocker: string, blocked: string) => blocker === "sora" && blocked === "kenji");
        expect((await invoke(postComment, ev("sora", { id: "p1" }, { text: "x", replyTo: "c-kenji" }))).statusCode).toBe(200);
        expect(sentTypes()).toEqual([["mika", "comment"]]);
    });

    it("退会した相手（読めなかった相手も）には知らせない", async () => {
        world();
        mockUnreadIds.mockReturnValue(new Set(["kenji"]));
        expect((await invoke(postComment, ev("sora", { id: "p1" }, { text: "x", replyTo: "c-kenji" }))).statusCode).toBe(200);
        expect(sentTypes()).toEqual([["mika", "comment"]]);
    });

    it("相手のコメントがもう無ければ、ふつうのコメントとして残す（書いたものを捨てない）", async () => {
        const writes = world();
        expect((await invoke(postComment, ev("sora", { id: "p1" }, { text: "x", replyTo: "c-gone" }))).statusCode).toBe(200);
        expect(appended(writes).replyTo).toBeUndefined();
        expect(sentTypes()).toEqual([["mika", "comment"]]);
    });

    it("返信先の形が違えば 400（黙ってふつうのコメントに化けさせない）", async () => {
        world();
        for (const bad of [42, { id: "c" }, "comments#p1", "a b"]) {
            expect((await invoke(postComment, ev("sora", { id: "p1" }, { text: "x", replyTo: bad }))).statusCode).toBe(400);
        }
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("返信先を送らない（古いアプリ・Web）は今までどおり", async () => {
        const writes = world();
        expect((await invoke(postComment, ev("sora", { id: "p1" }, { text: "x" }))).statusCode).toBe(200);
        expect("replyTo" in appended(writes)).toBe(false);
        expect(sentTypes()).toEqual([["mika", "comment"]]);
    });
});

describe("getComments: 返信の相手の名前", () => {
    it("退会した相手の名前は伏せる（写しの名前を出さない）", async () => {
        world([kenjiComment, { ...mikaComment, replyTo: { id: "c-kenji", uid: "kenji", name: "けんじ" } }]);
        mockDeletedIds.mockResolvedValue(new Set(["kenji"]));
        const data = JSON.parse((await invoke(getComments, ev(undefined, { id: "p1" }))).body);
        const reply = data.items.find((c: { id: string }) => c.id === "c-mika");
        expect(reply.replyTo).toEqual({ id: "c-kenji", uid: "kenji", name: "退会したユーザー", deleted: true });
        expect(reply.name).toBe("みか");
    });
});

describe("resolveReplyTo", () => {
    it("無い id・空は返信にしない", () => {
        expect(resolveReplyTo([kenjiComment], undefined)).toBeUndefined();
        expect(resolveReplyTo([kenjiComment], "c-x")).toBeUndefined();
        expect(resolveReplyTo([kenjiComment], "c-kenji")).toEqual({ id: "c-kenji", uid: "kenji", name: "けんじ" });
    });
});
