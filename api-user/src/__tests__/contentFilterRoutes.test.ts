import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 利用者が書いて他人に見える文を保存する口は、ひどい言葉を**保存せずに** 400 `content_rejected` で断る
 * （App Store の審査 1.2・`contentFilter.ts`）。
 *
 * ここで縛るのは「口に判定が付いていること」と「断ったときに何も書いていないこと」。
 * 口から判定を外すと、その口の行が落ちる。ふつうの文で `content_rejected` にならないことも同じ口で見る。
 * 中身（どの語が当たるか）は `contentFilter.test.ts`。
 */

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test", USER_INDEX: "userId-createdAt-index" }));
vi.mock("../liveCaller", async (orig) => ({
    ...(await orig<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => null,
    readLiveCaller: async () => ({ row: undefined }),
}));

const WRITE_COMMANDS = new Set([
    "PutCommand", "UpdateCommand", "DeleteCommand", "TransactWriteCommand", "BatchWriteCommand",
    "PutObjectCommand", "DeleteObjectCommand", "CopyObjectCommand",
]);
const writes = () => mockSend.mock.calls.filter(([c]) => WRITE_COMMANDS.has(c?.constructor?.name));

beforeEach(() => {
    mockSend.mockReset();
    // 読みは「何も無い」で返す（断る口は読む前に止まるはず。止まらなければ書きまで進んで落ちる）
    mockSend.mockImplementation(async () => ({}));
});

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const PEER2 = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";
const GROUP = "55555555-5555-4555-8555-555555555555";

function ev(routeKey: string, body: unknown, pathParameters: Record<string, string> = {}) {
    return {
        routeKey,
        rawPath: "/",
        pathParameters,
        body: JSON.stringify(body),
        headers: {},
        requestContext: { authorizer: { jwt: { claims: { sub: ME } } } },
    } as never;
}

type Res = { statusCode: number; body: string };
async function call(h: unknown, e: unknown): Promise<Res> {
    return (await (h as (e: unknown, c: unknown, cb: unknown) => Promise<Res>)(e, {} as never, () => undefined)) as Res;
}
const codeOf = (r: Res) => { try { return (JSON.parse(r.body) as { code?: string }).code; } catch { return undefined; } };

const BAD = "この写真を撮ったやつ死ね";
const BAD_EN = "go kill yourself";
const GOOD = "京都の紅葉がきれいでした";

type Case = { name: string; run: (text: string) => Promise<Res> };

/** 写真の編集は持ち主かを先に読む。ここでは自分の写真として返す（`stored` は保存済みの項目） */
function ownPhoto(stored: Record<string, unknown> = {}) {
    mockSend.mockImplementation(async (c: { constructor: { name: string }; input: { Key?: { id?: string } } }) =>
        c.constructor.name === "GetCommand" && c.input.Key?.id === "p1"
            ? { Item: { id: "p1", userId: ME, src: "https://x/y.jpg", published: true, ...stored } }
            : {});
}

const cases: Case[] = [
    { name: "コメント POST /photos/{id}/comments", run: async (t) => call((await import("../comments")).postComment, ev("POST /photos/{id}/comments", { text: t }, { id: "p1" })) },
    { name: "写真の保存 POST /user/photos（題）", run: async (t) => call((await import("../upload")).savePhoto, ev("POST /user/photos", { key: "uploads/x.jpg", publicUrl: "https://x/y.jpg", title: t })) },
    { name: "写真の保存（説明）", run: async (t) => call((await import("../upload")).savePhoto, ev("POST /user/photos", { key: "uploads/x.jpg", publicUrl: "https://x/y.jpg", description: t })) },
    { name: "写真の保存（タグ）", run: async (t) => call((await import("../upload")).savePhoto, ev("POST /user/photos", { key: "uploads/x.jpg", publicUrl: "https://x/y.jpg", tags: ["京都", t] })) },
    { name: "写真の編集 PUT /user/photos/{id}（説明）", run: async (t) => { ownPhoto(); return call((await import("../photoUpdate")).updatePhotoVisibility, ev("PUT /user/photos/{id}", { description: t }, { id: "p1" })); } },
    { name: "写真の編集（撮影地）", run: async (t) => { ownPhoto(); return call((await import("../photoUpdate")).updatePhotoVisibility, ev("PUT /user/photos/{id}", { location: t }, { id: "p1" })); } },
    { name: "DM POST /dm", run: async (t) => call((await import("../dm")).handler, ev("POST /dm", { to: PEER, text: t })) },
    { name: "DM POST /dm/{id}/messages", run: async (t) => call((await import("../dm")).handler, ev("POST /dm/{id}/messages", { text: t }, { id: `${ME}_${PEER}` })) },
    { name: "ストーリーの作成（写真の上の文字）", run: async (t) => call((await import("../stories")).createStory, ev("POST /user/stories", { key: "stories/x.jpg", publicUrl: "https://x/y.jpg", texts: [{ text: t, x: 0.5, y: 0.5 }] })) },
    { name: "ストーリーの作成（ひとこと）", run: async (t) => call((await import("../stories")).createStory, ev("POST /user/stories", { key: "stories/x.jpg", publicUrl: "https://x/y.jpg", caption: t })) },
    { name: "ストーリーへの返信", run: async (t) => call((await import("../storyReplies")).postStoryReply, ev("POST /stories/{id}/replies", { text: t }, { id: "s1" })) },
    { name: "ストーリーの質問への答え", run: async (t) => call((await import("../storyAnswers")).answerStory, ev("POST /stories/{id}/answers", { text: t }, { id: "s1" })) },
    { name: "旅行プランの作成（題）", run: async (t) => call((await import("../tripPlans")).createTrip, ev("POST /user/trips", { title: t, days: [] })) },
    { name: "旅行プランの直し（メモ）", run: async (t) => call((await import("../tripPlans")).updateTrip, ev("PUT /user/trips/{planId}", { days: [{ items: [{ kind: "location", slug: "kyoto", note: t }] }] }, { planId: PLAN })) },
    { name: "旅行プランの会話", run: async (t) => call((await import("../tripShare")).handler, ev("POST /trip-share/{planId}/chat", { text: t }, { planId: PLAN })) },
    { name: "グループの作成（名前）", run: async (t) => call((await import("../groups")).handler, ev("POST /groups", { memberIds: [PEER, PEER2], name: t })) },
    { name: "グループの会話", run: async (t) => call((await import("../groups")).handler, ev("POST /groups/{groupId}/messages", { text: t }, { groupId: GROUP })) },
    {
        // 名前の変更はメンバーかを先に見る（メンバーでない人には 404 でグループの有無を教えない）。ここではメンバーとして通す
        name: "グループの名前の変更",
        run: async (t) => {
            const at = new Date().toISOString();
            mockSend.mockImplementation(async (c: { constructor: { name: string }; input: { Key?: { id?: string } } }) =>
                c.constructor.name === "GetCommand" && c.input.Key?.id === `groupmembers#${GROUP}`
                    ? { Item: { id: `groupmembers#${GROUP}`, groupId: GROUP, ownerId: ME, createdAt: at, members: [{ id: ME, at, by: ME, from: 0 }, { id: PEER, at, by: ME, from: 0 }] } }
                    : {});
            return call((await import("../groups")).handler, ev("PUT /groups/{groupId}", { name: t }, { groupId: GROUP }));
        },
    },
    { name: "ハイライトの作成（名前）", run: async (t) => call((await import("../highlights")).createHighlight, ev("POST /user/highlights", { title: t, storyIds: ["s1"] })) },
    { name: "アルバムの作成（名前）", run: async (t) => call((await import("../albums")).createAlbum, ev("POST /albums", { title: t })) },
];

describe("ひどい言葉は保存せずに 400 content_rejected", () => {
    it.each(cases)("$name", async ({ run }) => {
        for (const bad of [BAD, BAD_EN]) {
            mockSend.mockClear();
            const r = await run(bad);
            expect(r.statusCode, r.body).toBe(400);
            expect(codeOf(r)).toBe("content_rejected");
            expect(writes()).toHaveLength(0);
        }
    });
});

describe("ふつうの文は content_rejected にならない", () => {
    it.each(cases)("$name", async ({ run }) => {
        const r = await run(GOOD);
        expect(codeOf(r)).not.toBe("content_rejected");
    });
});

describe("写真の編集は、変えた項目だけを見る", () => {
    it("保存済みの説明に当たる語があっても、同じ説明のまま非公開にする保存は止めない", async () => {
        ownPhoto({ description: BAD });
        const r = await call((await import("../photoUpdate")).updatePhotoVisibility,
            ev("PUT /user/photos/{id}", { published: false, description: BAD }, { id: "p1" }));
        expect(codeOf(r)).not.toBe("content_rejected");
    });
    it("説明を当たる語に書き換えたら断る", async () => {
        ownPhoto({ description: GOOD });
        const r = await call((await import("../photoUpdate")).updatePhotoVisibility,
            ev("PUT /user/photos/{id}", { published: false, description: BAD }, { id: "p1" }));
        expect(codeOf(r)).toBe("content_rejected");
        expect(writes()).toHaveLength(0);
    });
});

describe("Apple・Google のログインで来た名前", () => {
    it("ひどい言葉の名前は持たない（ログインは止めない）", async () => {
        const { cleanDisplayName } = await import("../federatedAccount");
        expect(cleanDisplayName("fucking idiot")).toBeUndefined();
        expect(cleanDisplayName("山田 太郎")).toBe("山田 太郎");
    });
});
