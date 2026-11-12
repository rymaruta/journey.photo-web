import { describe, it, expect, vi, beforeEach } from "vitest";

// **写真をストーリーで紹介する**（2026-11-11 owner 承認・journey.photo-ios#541 の ①）。
// `stories.ts` の `createStory`（紹介してよいか・持ち主への知らせ・棚に残さない）と
// `getStories`（あとで見られなくなった写真の紹介を、本人以外に出さない）・`storyKeep.ts` を見る。
// DynamoDB は命令の形（表・鍵）で答える——呼ぶ順の添字に頼らない（`stories.test.ts` の `storyPuts` の注記）
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");

const mockIsBlocked = vi.hoisted(() => vi.fn(async (_a: string, _b: string) => false));
const mockHidden = vi.hoisted(() => vi.fn(async (_uid: string) => new Set<string>()));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: (a: string, b: string) => mockIsBlocked(a, b),
    blockMarkerId: (a: string, b: string) => `block#${a}#${b}`,
    hiddenUserIds: (uid: string) => mockHidden(uid),
}));
const mockDeleted = vi.hoisted(() => vi.fn<(ids?: unknown) => Promise<Set<string>>>(async () => new Set<string>()));
const mockUnread = vi.hoisted(() => vi.fn<() => Set<string>>(() => new Set<string>()));
const mockPush = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../notify", async (importActual) => ({
    ...(await importActual<typeof import("../notify")>()),
    deletedAmong: async (ids: unknown) => ({ deleted: await mockDeleted(ids), unread: mockUnread() }),
    pushNotification: (...a: unknown[]) => (mockPush as (...x: unknown[]) => Promise<undefined>)(...a),
}));

const { getStories, createStory } = await import("../stories");
const { keepStory } = await import("../storyKeep");
const { parseSharedPhotoId, isShareablePhotoRow } = await import("../storyPhotoShare");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);
const authed = (sub: string, extra: Record<string, unknown> = {}) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } }, ...extra,
});

type Cmd = { constructor: { name: string }; input: Record<string, unknown> & { Key?: { id?: string; userId?: string }; TableName?: string } };

/** 写真の行（id → 行）。`mika` の公開写真 p1 が基本 */
let photos: Record<string, Record<string, unknown>> = {};
/** 一覧の Query が返すストーリーの行 */
let storyRows: Record<string, unknown>[] = [];
/** 書いた行（Put の Item） */
let puts: Record<string, unknown>[] = [];

beforeEach(() => {
    photos = { p1: { id: "p1", src: "https://cdn.test/uploads/mika/p1.jpg", thumbSrc: "https://cdn.test/t/p1.webp", userId: "mika", location: "金沢" } };
    storyRows = [];
    puts = [];
    mockIsBlocked.mockReset().mockResolvedValue(false);
    mockHidden.mockReset().mockResolvedValue(new Set<string>());
    mockDeleted.mockReset().mockResolvedValue(new Set<string>());
    mockUnread.mockReset().mockReturnValue(new Set<string>());
    mockPush.mockReset().mockResolvedValue(undefined);
    mockDdbSend.mockReset().mockImplementation(async (cmd: Cmd) => {
        const name = cmd.constructor.name;
        if (name === "QueryCommand") return { Count: 0, Items: storyRows };
        if (name === "GetCommand") {
            if (cmd.input.TableName === process.env.USERS_TABLE) {
                const uid = String(cmd.input.Key?.userId ?? "");
                return { Item: { userId: uid, displayName: uid === "sora" ? "そら" : uid } };
            }
            const id = String(cmd.input.Key?.id ?? "");
            if (id.startsWith("follow#")) return { Item: { id } };   // 誰でもフォローしている世界
            const row = photos[id] ?? storyRows.find((r) => r.id === id);
            return row ? { Item: row } : {};
        }
        if (name === "PutCommand") puts.push(cmd.input.Item as Record<string, unknown>);
        return {};
    });
});

const share = (sub: string, extra: Record<string, unknown> = {}) => invoke(createStory, authed(sub, {
    body: JSON.stringify({ publicUrl: `https://cdn.test/uploads/${sub}/card.jpg`, sharedPhotoId: "p1", ...extra }),
}));
const storyPut = () => puts.find((p) => p.story === true);

describe("createStory: 写真を紹介する（自分の写真だけ・2026-11-12 owner）", () => {
    it("自分の公開写真を紹介できる。行に写真の id を書き、自分には知らせない", async () => {
        const res = await share("mika");
        expect(res.statusCode).toBe(201);
        expect(storyPut()?.sharedPhotoId).toBe("p1");
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("🔴 人の公開写真は 403「この写真はストーリーで紹介できません」。行も知らせも作らない", async () => {
        const res = await share("sora");
        expect(res.statusCode, "人の写真を自分のストーリーに載せ直せてしまう").toBe(403);
        expect(JSON.parse(res.body).error).toBe("この写真はストーリーで紹介できません");
        expect(storyPut()).toBeUndefined();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("🔴 人の写真は、ブロック・退会・「検索に出さない」に関係なく 403（持ち主の関係を読みに行かない）", async () => {
        photos.p1.searchHidden = true;
        expect((await share("sora")).statusCode).toBe(403);
        expect(mockIsBlocked).not.toHaveBeenCalled();
        expect(mockDeleted).not.toHaveBeenCalled();
        expect(storyPut()).toBeUndefined();
    });

    it("人の下書き・範囲を絞った写真は 404（403 で有無を教えない）", async () => {
        photos.p1.published = false;
        expect((await share("sora")).statusCode).toBe(404);
        photos.p1.published = undefined;
        photos.p1.audience = "followers";
        expect((await share("sora")).statusCode).toBe(404);
        expect(storyPut()).toBeUndefined();
    });

    const refused: [string, () => void][] = [
        ["下書き（非公開）", () => { photos.p1.published = false; }],
        ["フォロワー限定（公開範囲を絞った）", () => { photos.p1.audience = "followers"; }],
        ["親しい友達だけ", () => { photos.p1.audience = "closeFriends"; }],
        ["ストーリーの行", () => { photos.p1.story = true; }],
        ["無い写真", () => { delete photos.p1; }],
    ];
    for (const [label, arrange] of refused) {
        it(`自分の${label}の写真は 404 で、行も知らせも作らない`, async () => {
            arrange();
            const res = await share("mika");
            expect(res.statusCode).toBe(404);
            expect(storyPut()).toBeUndefined();
            expect(mockPush).not.toHaveBeenCalled();
        });
    }

    it("形の違う id は 400（黙って紹介なしにしない）", async () => {
        for (const bad of [12, "comments#p1", "story-abc", { id: "p1" }]) {
            expect((await share("sora", { sharedPhotoId: bad })).statusCode).toBe(400);
        }
        expect(storyPut()).toBeUndefined();
    });

    it("紹介のストーリーは棚に残さない（`archive` を書かない）", async () => {
        expect((await share("mika", { archive: true })).statusCode).toBe(201);
        expect(storyPut()?.archive).toBeUndefined();
    });

    it("紹介でないストーリー（古いアプリ）は今までどおり。写真を読まず、知らせもしない", async () => {
        const res = await invoke(createStory, authed("sora", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/sora/a.jpg", archive: true }),
        }));
        expect(res.statusCode).toBe(201);
        expect("sharedPhotoId" in (storyPut() ?? {})).toBe(false);
        expect(storyPut()?.archive).toBe(true);
        expect(mockPush).not.toHaveBeenCalled();
    });
});

describe("getStories: 紹介した写真が見られなくなったら", () => {
    const now = Date.now();
    const row = (extra: Record<string, unknown> = {}) => ({
        id: "story-1", story: true, userId: "mika", storyFeed: "1", sharedPhotoId: "p1",
        createdAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), ...extra,
    });
    const list = async (viewer: string) => JSON.parse((await invoke(getStories, authed(viewer))).body) as Record<string, unknown>[];

    it("見られるうちは、見る人に写真の id を返す", async () => {
        storyRows = [row()];
        const items = await list("kenji");
        expect(items.map((i) => [i.id, i.sharedPhotoId])).toEqual([["story-1", "p1"]]);
    });

    const lost: [string, () => void][] = [
        ["持ち主が非公開にした", () => { photos.p1.published = false; }],
        ["持ち主が公開範囲を絞った", () => { photos.p1.audience = "followers"; }],
        ["持ち主が消した", () => { delete photos.p1; }],
        ["持ち主が退会した", () => { mockDeleted.mockResolvedValue(new Set(["mika"])); }],
            ];
    for (const [label, arrange] of lost) {
        it(`${label}: 本人以外には出さず、本人には写真の id を落として残す`, async () => {
            storyRows = [row()];
            arrange();
            expect((await list("kenji")).map((i) => i.id)).toEqual([]);
            storyRows = [row()];
            const mine = await list("mika");
            expect(mine.map((i) => i.id)).toEqual(["story-1"]);
            expect(mine[0].sharedPhotoId).toBeUndefined();
        });
    }

    it("🔴 紹介した写真が読めなかった（例外）: 本人以外には出さない", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const real = mockDdbSend.getMockImplementation()!;
        mockDdbSend.mockImplementation(async (cmd: Cmd) => {
            if (cmd.constructor.name === "GetCommand" && String(cmd.input.Key?.id ?? "") === "p1") throw new Error("boom");
            return real(cmd);
        });
        storyRows = [row()];
        expect((await list("kenji")).map((i) => i.id), "読めなかった写真を「見られる」側に倒している").toEqual([]);
        storyRows = [row()];
        const mine = await list("mika");
        expect(mine.map((i) => i.id)).toEqual(["story-1"]);
        expect(mine[0].sharedPhotoId).toBeUndefined();
        vi.restoreAllMocks();
    });

    it("🔴 見る人のブロック一覧が読めなかった: 紹介の行だけ本人以外に出さない（ふつうの行・本人の行は出す）", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        mockHidden.mockRejectedValue(new Error("boom"));
        storyRows = [row(), row({ id: "story-2", sharedPhotoId: undefined })];
        expect((await list("kenji")).map((i) => i.id), "ブロックを確かめずに紹介の行を出している").toEqual(["story-2"]);
        storyRows = [row()];
        const mine = await list("mika");
        expect(mine.map((i) => [i.id, i.sharedPhotoId]), "本人の写真の id まで落としている").toEqual([["story-1", "p1"]]);
        vi.restoreAllMocks();
    });

    it("見る人と持ち主のあいだにブロックができた: 見る人には出さない", async () => {
        storyRows = [row()];
        mockHidden.mockResolvedValue(new Set(["mika"]));
        // 見る人がブロックしている人のストーリーそのものが一覧から落ちる（紹介の門より手前）
        expect((await list("kenji")).map((i) => i.id)).toEqual([]);
    });

    it("🔴 持ち主でない人が紹介した行（2026-11-12 より前に作られた）は、本人以外に出さず、本人には写真の id を落として残す", async () => {
        storyRows = [row({ userId: "sora" })];
        expect((await list("kenji")).map((i) => i.id), "人の写真の紹介が見る人に配られ続ける").toEqual([]);
        expect((await list("mika")).map((i) => i.id), "写真の持ち主にも、人が載せ直した行は出さない").toEqual([]);
        storyRows = [row({ userId: "sora" })];
        const mine = await list("sora");
        expect(mine.map((i) => i.id)).toEqual(["story-1"]);
        expect(mine[0].sharedPhotoId).toBeUndefined();
    });

    it("同じ写真を持ち主と人の両方が紹介していても、持ち主の行は出す（行ごとに決める）", async () => {
        storyRows = [row(), row({ id: "story-2", userId: "sora" })];
        expect((await list("kenji")).map((i) => i.id)).toEqual(["story-1"]);
    });

    it("紹介の行が無い一覧は、写真を1枚も読まない", async () => {
        storyRows = [row({ sharedPhotoId: undefined })];
        await list("kenji");
        const photoReads = mockDdbSend.mock.calls.map(([c]) => c as Cmd)
            .filter((c) => c.constructor.name === "GetCommand" && String(c.input.Key?.id ?? "") === "p1");
        expect(photoReads).toEqual([]);
    });
});

describe("keepStory: 紹介のストーリーはギャラリーに残せない", () => {
    it("409 で断る（人の写真の写しを作らない）", async () => {
        storyRows = [{ id: "story-1", story: true, userId: "mika", sharedPhotoId: "p1", src: "https://cdn.test/uploads/mika/card.jpg", key: "uploads/mika/card.jpg" }];
        const res = await invoke(keepStory, authed("mika", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(409);
        expect(puts).toEqual([]);
    });
});

describe("parseSharedPhotoId / isShareablePhotoRow", () => {
    it("無い・null・空は「紹介ではない」", () => {
        expect(parseSharedPhotoId(undefined)).toEqual({ ok: true });
        expect(parseSharedPhotoId(null)).toEqual({ ok: true });
        expect(parseSharedPhotoId("")).toEqual({ ok: true });
        expect(parseSharedPhotoId("abc-123")).toEqual({ ok: true, photoId: "abc-123" });
    });
    it("全体に公開した生きた写真だけ", () => {
        expect(isShareablePhotoRow({ src: "s", userId: "u" })).toBe(true);
        expect(isShareablePhotoRow({ src: "s", uploadedBy: "u" })).toBe(true);
        expect(isShareablePhotoRow({ src: "s" })).toBe(false);
        expect(isShareablePhotoRow({ src: "s", userId: "u", audience: "followers" })).toBe(false);
    });
});
