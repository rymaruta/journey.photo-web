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

describe("createStory: 写真を紹介する", () => {
    it("人の公開写真を紹介できる。行に写真の id を書き、持ち主に知らせる", async () => {
        const res = await share("sora");
        expect(res.statusCode).toBe(201);
        expect(storyPut()?.sharedPhotoId).toBe("p1");
        expect(mockPush).toHaveBeenCalledTimes(1);
        const [to, notif] = mockPush.mock.calls[0] as unknown as [string, Record<string, unknown>];
        expect(to).toBe("mika");
        expect(notif).toMatchObject({ type: "storyshare", photoId: "p1", byId: "sora", byName: "そら", photoSrc: "https://cdn.test/t/p1.webp", atLocation: "金沢" });
    });

    it("自分の写真の紹介は、自分に知らせない", async () => {
        expect((await share("mika")).statusCode).toBe(201);
        expect(storyPut()?.sharedPhotoId).toBe("p1");
        expect(mockPush.mock.calls.filter((c) => (c as unknown as [string, { type: string }])[1].type === "storyshare")).toEqual([]);
    });

    const refused: [string, () => void][] = [
        ["下書き（非公開）", () => { photos.p1.published = false; }],
        ["フォロワー限定（公開範囲を絞った）", () => { photos.p1.audience = "followers"; }],
        ["ストーリーの行", () => { photos.p1.story = true; }],
        ["無い写真", () => { delete photos.p1; }],
        ["持ち主が退会した", () => { mockDeleted.mockResolvedValue(new Set(["mika"])); }],
        ["持ち主を読めなかった（退会の側に倒す）", () => { mockUnread.mockReturnValue(new Set(["mika"])); }],
        ["持ち主にブロックされている", () => { mockIsBlocked.mockImplementation(async (a, b) => a === "mika" && b === "sora"); }],
        ["自分が持ち主をブロックしている", () => { mockIsBlocked.mockImplementation(async (a, b) => a === "sora" && b === "mika"); }],
    ];
    for (const [label, arrange] of refused) {
        it(`${label}の写真は 404 で、行も知らせも作らない`, async () => {
            arrange();
            const res = await share("sora");
            expect(res.statusCode).toBe(404);
            expect(storyPut()).toBeUndefined();
            expect(mockPush).not.toHaveBeenCalled();
        });
    }

    it("自分の写真でも、公開範囲を絞った写真は紹介できない（ストーリーの見る人と写真の見る人は別）", async () => {
        photos.p1.audience = "closeFriends";
        expect((await share("mika")).statusCode).toBe(404);
        expect(storyPut()).toBeUndefined();
    });

    it("「検索に出さない」人の写真は紹介できる（あの設定は検索エンジンの頁だけ）", async () => {
        photos.p1.searchHidden = true;
        expect((await share("sora")).statusCode).toBe(201);
        expect(storyPut()?.sharedPhotoId).toBe("p1");
    });

    it("形の違う id は 400（黙って紹介なしにしない）", async () => {
        for (const bad of [12, "comments#p1", "story-abc", { id: "p1" }]) {
            expect((await share("sora", { sharedPhotoId: bad })).statusCode).toBe(400);
        }
        expect(storyPut()).toBeUndefined();
    });

    it("紹介のストーリーは棚に残さない（`archive` を書かない）", async () => {
        expect((await share("sora", { archive: true })).statusCode).toBe(201);
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
        id: "story-1", story: true, userId: "sora", storyFeed: "1", sharedPhotoId: "p1",
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
        ["見る人と持ち主のあいだにブロックができた", () => { mockHidden.mockResolvedValue(new Set(["mika"])); }],
    ];
    for (const [label, arrange] of lost) {
        it(`${label}: 本人以外には出さず、本人には写真の id を落として残す`, async () => {
            storyRows = [row()];
            arrange();
            expect((await list("kenji")).map((i) => i.id)).toEqual([]);
            storyRows = [row()];
            const mine = await list("sora");
            expect(mine.map((i) => i.id)).toEqual(["story-1"]);
            expect(mine[0].sharedPhotoId).toBeUndefined();
        });
    }

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
        storyRows = [{ id: "story-1", story: true, userId: "sora", sharedPhotoId: "p1", src: "https://cdn.test/uploads/sora/card.jpg", key: "uploads/sora/card.jpg" }];
        const res = await invoke(keepStory, authed("sora", { pathParameters: { id: "story-1" } }));
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
