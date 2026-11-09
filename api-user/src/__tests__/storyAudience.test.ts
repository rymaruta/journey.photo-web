import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 「親しい友達だけ」（`audience: "closeFriends"`）の**門が全部閉まっていること**
 * （札 #505・2026-11-09）。
 *
 * 見せるかどうかを決める所は6つ（`getStories` / `viewStory` / `postStoryReply` /
 * `voteStory` / ハイライトの2つ）＋新しい `answerStory`。**1つでも抜けると、
 * 親しい友達だけのつもりの投稿が名簿の外に出る**ので、1つずつ「名簿に居ない
 * フォロワー」で叩き、**書き込みが1回も走らないこと**まで見る。
 *
 * **データベースは Map の世界で本物の規則を通す**（フォロー・ブロック・名簿は
 * モックせず、マーカーの行で用意する）。見たいのは「どの行を読んで決めているか」。
 */

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = vi.fn(); },
    DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
    DeleteObjectsCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const deletedIds = vi.hoisted(() => new Set<string>());
const mockPush = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => undefined));
vi.mock("../notify", async (importActual) => ({
    ...(await importActual<typeof import("../notify")>()),
    lookupDisplayName: async (id: string) => `名前-${id.slice(0, 4)}`,
    deletedAmong: async (ids: Iterable<string>) => ({ deleted: new Set([...ids].filter((i) => deletedIds.has(i))), unread: new Set<string>() }),
    pushNotification: (...a: unknown[]) => mockPush(...a),
}));

const { getStories, createStory, viewStory } = await import("../stories");
const { postStoryReply } = await import("../storyReplies");
const { voteStory } = await import("../storyVotes");
const { answerStory, getStoryAnswers, reportStoryAnswer } = await import("../storyAnswers");
const { getHighlight, getUserHighlights } = await import("../highlights");
const { setCloseFriend } = await import("../closeFriends");
const { keepStory } = await import("../storyKeep");
const { getStoryArchive } = await import("../storyArchive");
const { parseStoryAudience, storyAudienceOf } = await import("../storyAudience");

type Result = { statusCode: number; headers?: Record<string, string>; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);
type Cmd = { constructor: { name: string }; input: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const CF = "bbbbbbbb-0000-4000-8000-000000000002";       // 親しい友達（フォロワー）
const FOLLOWER = "cccccccc-0000-4000-8000-000000000003"; // フォロワーだが名簿に居ない
const CF_NOT_FOLLOWING = "dddddddd-0000-4000-8000-000000000004"; // 名簿に居るがフォローしていない
const STRANGER = "eeeeeeee-0000-4000-8000-000000000005";
const SID = "story-11111111-1111-4111-8111-111111111111";
const SID_ALL = "story-22222222-2222-4222-8222-222222222222";
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();

const db = new Map<string, Record<string, unknown>>();
let feed: Record<string, unknown>[] = [];
let sent: Cmd[] = [];
let closeListFails = false;

const ev = (sub: string | undefined, extra: Record<string, unknown> = {}) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    ...extra,
});
const withId = (sub: string | undefined, id: string, body?: unknown) =>
    ev(sub, { pathParameters: { id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const bodyOf = (r: Result) => JSON.parse(r.body);
const wrote = () => sent.some((c) => !["GetCommand", "QueryCommand"].includes(c.constructor.name));

const follow = (target: string, follower: string) => db.set(`follow#${target}#${follower}`, { id: `follow#${target}#${follower}` });
const block = (blocker: string, blocked: string) => db.set(`block#${blocker}#${blocked}`, { id: `block#${blocker}#${blocked}` });

function addStory(id: string, over: Record<string, unknown> = {}) {
    const row = {
        id, story: true, storyFeed: "1", userId: OWNER, src: `https://cdn.test/uploads/${OWNER}/a.webp`,
        mediaType: "image", createdAt: new Date().toISOString(), expiresAt: FUTURE, ...over,
    };
    db.set(id, row);
    if (typeof over.expiresAt !== "string" || over.expiresAt > new Date().toISOString()) feed.push(row);
    return row;
}

beforeEach(() => {
    db.clear(); feed = []; sent = []; closeListFails = false; deletedIds.clear();
    mockPush.mockReset();
    mockDdbSend.mockReset();
    mockDdbSend.mockImplementation(async (cmd: Cmd) => {
        sent.push(cmd);
        const n = cmd.constructor.name, i = cmd.input;
        if (n === "GetCommand") {
            if (i.Key.userId !== undefined) return { Item: { userId: i.Key.userId, displayName: "名前" } };
            if (closeListFails && String(i.Key.id).startsWith("closefriends#")) throw new Error("boom");
            const it = db.get(i.Key.id);
            return { Item: it ? structuredClone(it) : undefined };
        }
        if (n === "QueryCommand") {
            if (i.IndexName === "storyFeed-expiresAt-index") return { Items: structuredClone(feed) };
            if (i.Select === "COUNT") return { Count: 0 };
            if (i.IndexName === "userId-createdAt-index") {
                return { Items: [...db.values()].filter((r) => r.story === true && r.archive === true && r.userId === i.ExpressionAttributeValues[":u"]) };
            }
            return { Items: [] };
        }
        if (n === "PutCommand") { db.set(i.Item.id, i.Item); return {}; }
        if (n === "TransactWriteCommand") {
            for (const t of i.TransactItems as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
                if (t.ConditionCheck && !db.has(t.ConditionCheck.Key.id)) throw Object.assign(new Error("x"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] });
            }
            for (const t of i.TransactItems as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
                if (t.Update && t.Update.UpdateExpression.includes("list_append")) {
                    const cur = db.get(t.Update.Key.id) ?? { id: t.Update.Key.id };
                    db.set(t.Update.Key.id, { ...cur, answers: [...((cur.answers as unknown[]) ?? []), ...t.Update.ExpressionAttributeValues[":new"]] });
                }
            }
            return {};
        }
        return {};
    });
    // 名簿（オーナーの親しい友達）。フォローは既定で CF・FOLLOWER が OWNER を追っている
    db.set(`closefriends#${OWNER}`, { id: `closefriends#${OWNER}`, list: [CF, CF_NOT_FOLLOWING] });
    follow(OWNER, CF); follow(OWNER, FOLLOWER);
});

// ────────────────────────────────
// 値の解釈
// ────────────────────────────────
describe("audience の値", () => {
    it("無い・everyone は全員向け、closeFriends だけが狭い。知らない値は断る", () => {
        expect(parseStoryAudience(undefined)).toEqual({ ok: true, audience: "everyone" });
        expect(parseStoryAudience("everyone")).toEqual({ ok: true, audience: "everyone" });
        expect(parseStoryAudience("closeFriends")).toEqual({ ok: true, audience: "closeFriends" });
        for (const bad of ["close_friends", "public", "", 1, true, {}]) {
            expect(parseStoryAudience(bad).ok, `${String(bad)} を通している`).toBe(false);
        }
    });

    it("行の読み方: 無い・everyone だけ全員向け。知らない値は狭い側（漏らさない向き）", () => {
        expect(storyAudienceOf({})).toBe("everyone");
        expect(storyAudienceOf({ audience: "everyone" })).toBe("everyone");
        expect(storyAudienceOf({ audience: "closeFriends" })).toBe("closeFriends");
        expect(storyAudienceOf({ audience: "future-value" })).toBe("closeFriends");
    });
});

// ────────────────────────────────
// 保存
// ────────────────────────────────
describe("createStory: audience", () => {
    const post = (body: Record<string, unknown>) => invoke(createStory, ev(OWNER, {
        body: JSON.stringify({ publicUrl: `https://cdn.test/uploads/${OWNER}/a.webp`, ...body }),
    }));
    const saved = () => sent.map((c) => c).find((c) => c.constructor.name === "PutCommand")?.input.Item as Record<string, unknown> | undefined;

    it("既定は列を持たない（これまでの行と1バイトも変わらない）", async () => {
        expect((await post({})).statusCode).toBe(201);
        expect(saved()).not.toHaveProperty("audience");
        sent = [];
        expect((await post({ audience: "everyone" })).statusCode).toBe(201);
        expect(saved()).not.toHaveProperty("audience");
    });

    it("closeFriends を保存する", async () => {
        expect((await post({ audience: "closeFriends" })).statusCode).toBe(201);
        expect(saved()?.audience).toBe("closeFriends");
    });

    it("知らない値は 400（全員向けに化けない）で、何も書かない", async () => {
        const r = await post({ audience: "close_friends" });
        expect(r.statusCode).toBe(400);
        expect(wrote()).toBe(false);
    });
});

// ────────────────────────────────
// 門 1: 一覧
// ────────────────────────────────
describe("getStories: 親しい友達だけ", () => {
    const idsFor = async (sub: string) => bodyOf(await invoke(getStories, ev(sub))).map((s: { id: string }) => s.id);

    beforeEach(() => {
        addStory(SID, { audience: "closeFriends" });
        addStory(SID_ALL);
        follow(OWNER, CF_NOT_FOLLOWING);
    });

    it("名簿に居るフォロワーには出る", async () => {
        expect(await idsFor(CF)).toEqual(expect.arrayContaining([SID, SID_ALL]));
    });

    it("本人には出る", async () => {
        expect(await idsFor(OWNER)).toEqual(expect.arrayContaining([SID, SID_ALL]));
    });

    it("名簿に居ないフォロワーには出ない（全員向けは出る）", async () => {
        const ids = await idsFor(FOLLOWER);
        expect(ids).not.toContain(SID);
        expect(ids).toContain(SID_ALL);
    });

    it("名簿に居てもフォローしていなければ出ない（フォローの門は消えていない）", async () => {
        db.delete(`follow#${OWNER}#${CF_NOT_FOLLOWING}`);
        expect(await idsFor(CF_NOT_FOLLOWING)).toEqual([]);
    });

    it("名簿を読めなければ出さない", async () => {
        closeListFails = true;
        const ids = await idsFor(CF);
        expect(ids).not.toContain(SID);
        expect(ids).toContain(SID_ALL);
    });

    it("未ログインは 401 で何も返さない", async () => {
        const r = await invoke(getStories, ev(undefined));
        expect(r.statusCode).toBe(401);
        expect(r.body).not.toContain(SID);
    });

    it("ブロックしている名簿の人には、名簿に居ても出ない（ブロックの門も残っている）", async () => {
        // 一覧の門は `blockedby#<自分>` の一覧（`hiddenUserIds`）で見る
        db.set(`blockedby#${CF}`, { id: `blockedby#${CF}`, blockerIds: [OWNER] });
        expect(await idsFor(CF)).toEqual([]);
    });

    it("全員向けしか無い投稿者の名簿は読みに行かない（往復が増えない）", async () => {
        feed = feed.filter((r) => r.id === SID_ALL);
        sent = [];
        await idsFor(FOLLOWER);
        expect(sent.some((c) => String(c.input.Key?.id ?? "").startsWith("closefriends#"))).toBe(false);
    });
});

// ────────────────────────────────
// 門 2〜4 と答え: 書き込みの口
// ────────────────────────────────
describe("書き込みの口は名簿の外を 404 で断り、1回も書かない", () => {
    beforeEach(() => {
        addStory(SID, {
            audience: "closeFriends",
            texts: [
                { kind: "vote", question: "好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.5, size: 0.05 },
                { kind: "question", prompt: "おすすめは？", x: 0.5, y: 0.7, size: 0.05 },
            ],
        });
    });

    const gates: [string, (sub: string) => Promise<Result>][] = [
        ["viewStory（足あと）", (sub) => invoke(viewStory, withId(sub, SID))],
        ["postStoryReply（返信）", (sub) => invoke(postStoryReply, withId(sub, SID, { text: "こんにちは" }))],
        ["voteStory（投票）", (sub) => invoke(voteStory, withId(sub, SID, { choice: "a" }))],
        ["answerStory（質問の答え）", (sub) => invoke(answerStory, withId(sub, SID, { text: "ここ" }))],
    ];

    for (const [name, call] of gates) {
        it(`${name}: 名簿に居ないフォロワーは 404・書き込み0・通知0`, async () => {
            const r = await call(FOLLOWER);
            expect(r.statusCode).toBe(404);
            expect(wrote(), "書き込みが走った").toBe(false);
            expect(mockPush).not.toHaveBeenCalled();
        });

        it(`${name}: 名簿に居てもフォローしていなければ 404`, async () => {
            const r = await call(CF_NOT_FOLLOWING);
            expect(r.statusCode).toBe(404);
            expect(wrote()).toBe(false);
        });

        it(`${name}: 無関係の人は 404`, async () => {
            expect((await call(STRANGER)).statusCode).toBe(404);
            expect(wrote()).toBe(false);
        });

        it(`${name}: 名簿を読めなければ 404（見せない側）`, async () => {
            closeListFails = true;
            expect((await call(CF)).statusCode).toBe(404);
            expect(wrote()).toBe(false);
        });

        it(`${name}: 名簿に居るフォロワーは通る`, async () => {
            follow(OWNER, CF_NOT_FOLLOWING);
            const r = await call(CF);
            expect(r.statusCode, r.body).toBe(200);
        });
    }

    it("全員向けのストーリーは、名簿に居ないフォロワーも今までどおり返信できる", async () => {
        addStory(SID_ALL);
        expect((await invoke(postStoryReply, withId(FOLLOWER, SID_ALL, { text: "やあ" }))).statusCode).toBe(200);
    });
});

// ────────────────────────────────
// 門 5・6: ハイライト（アーカイブした親しい友達向け）
// ────────────────────────────────
describe("ハイライト", () => {
    const HID = "99999999-9999-4999-8999-999999999999";
    const CLOSE = "story-33333333-3333-4333-8333-333333333333";
    const OPEN = "story-44444444-4444-4444-8444-444444444444";
    const archived = (id: string, over: Record<string, unknown> = {}) =>
        db.set(id, { id, story: true, userId: OWNER, src: `https://cdn.test/${id}.webp`, archive: true, expiresAt: PAST, createdAt: PAST, ...over });

    beforeEach(() => {
        archived(CLOSE, { audience: "closeFriends" });
        archived(OPEN);
        db.set(`highlights#${OWNER}`, { id: `highlights#${OWNER}`, list: [HID] });
        db.set(`highlight#${HID}`, {
            id: `highlight#${HID}`, ownerId: OWNER, title: "旅", storyIds: [CLOSE, OPEN], closeIds: [CLOSE], coverStoryId: CLOSE,
        });
    });

    const detail = (sub: string) => invoke(getHighlight, ev(sub, { pathParameters: { userId: OWNER, id: HID } }));
    const ring = (sub: string) => invoke(getUserHighlights, ev(sub, { pathParameters: { userId: OWNER } }));

    it("名簿に居ないフォロワー: 中身は全員向けの1枚だけ・親しい友達の行は出ない", async () => {
        const b = bodyOf(await detail(FOLLOWER));
        expect(b.items.map((i: { id: string }) => i.id)).toEqual([OPEN]);
    });

    it("名簿に居ないフォロワー: 輪の件数にも表紙にも出ない（表紙は親しい友達の1枚から代わる）", async () => {
        const b = bodyOf(await ring(FOLLOWER));
        expect(b.highlights).toHaveLength(1);
        expect(b.highlights[0].count).toBe(1);
        expect(b.highlights[0].cover.src).toBe(`https://cdn.test/${OPEN}.webp`);
    });

    it("親しい友達だけの行しか無い輪は、名簿の外には輪ごと出ない・中身は 404", async () => {
        db.set(`highlight#${HID}`, { id: `highlight#${HID}`, ownerId: OWNER, title: "旅", storyIds: [CLOSE], closeIds: [CLOSE], coverStoryId: CLOSE });
        expect(bodyOf(await ring(FOLLOWER)).highlights).toEqual([]);
        expect((await detail(FOLLOWER)).statusCode).toBe(404);
    });

    it("名簿に居るフォロワーと本人は全部見える", async () => {
        for (const who of [CF, OWNER]) {
            const d = bodyOf(await detail(who));
            expect(d.items.map((i: { id: string }) => i.id).sort()).toEqual([CLOSE, OPEN].sort());
            expect(d.items.find((i: { id: string }) => i.id === CLOSE).audience).toBe("closeFriends");
            const r = bodyOf(await ring(who));
            expect(r.highlights[0].count).toBe(2);
        }
    });

    it("フォローしていない人は、名簿に居ても今までどおり 0件・404", async () => {
        expect(bodyOf(await ring(CF_NOT_FOLLOWING)).highlights).toEqual([]);
        expect((await detail(CF_NOT_FOLLOWING)).statusCode).toBe(404);
    });

    it("名簿を読めなければ、親しい友達の行は出さない", async () => {
        closeListFails = true;
        expect(bodyOf(await detail(CF)).items.map((i: { id: string }) => i.id)).toEqual([OPEN]);
        expect(bodyOf(await ring(CF)).highlights[0].count).toBe(1);
    });
});

// ────────────────────────────────
// アーカイブ・ギャラリーに残す・公開の口・通知
// ────────────────────────────────
describe("アーカイブ・残す・公開の閲覧", () => {
    it("アーカイブは呼んだ本人の行しか引かない（他人のアーカイブは読めない）", async () => {
        db.set("story-aaaa", { id: "story-aaaa", story: true, userId: OWNER, archive: true, expiresAt: PAST, audience: "closeFriends" });
        const r = await invoke(getStoryArchive, ev(CF));
        expect(bodyOf(r)).toEqual([]);
        const q = sent.find((c) => c.constructor.name === "QueryCommand");
        expect(q?.input.ExpressionAttributeValues[":u"]).toBe(CF);
        // 本人には自分のものが返る
        expect(bodyOf(await invoke(getStoryArchive, ev(OWNER))).map((s: { id: string }) => s.id)).toEqual(["story-aaaa"]);
    });

    it("親しい友達だけのストーリーはギャラリーに残せない（普通の写真になって公開に出るのを防ぐ）", async () => {
        addStory(SID, { audience: "closeFriends" });
        const r = await invoke(keepStory, withId(OWNER, SID));
        expect(r.statusCode).toBe(400);
        expect(wrote()).toBe(false);
    });

    it("Web の公開の口（api/）は、ストーリーの行を返さない（`story` を除く条件が残っている）", () => {
        const root = join(__dirname, "..", "..", "..");
        const photos = readFileSync(join(root, "api/src/photos.ts"), "utf8");
        const ddbPhotos = readFileSync(join(root, "api/src/ddb-photos.ts"), "utf8");
        expect(photos).toMatch(/photo\.story === true/);
        expect(ddbPhotos.match(/attribute_not_exists\(story\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
        // 親しい友達向けの行は `story` を持つので、この条件だけで公開の口から外れる
        expect(readFileSync(join(root, "api-user/src/feed.ts"), "utf8")).toMatch(/item\.story === true\) return false/);
    });

    it("通知: 返信が門で断られた回は、投稿者に通知を積まない", async () => {
        addStory(SID, { audience: "closeFriends" });
        await invoke(postStoryReply, withId(FOLLOWER, SID, { text: "やあ" }));
        expect(mockPush).not.toHaveBeenCalled();
        await invoke(postStoryReply, withId(CF, SID, { text: "やあ" }));
        expect(mockPush).toHaveBeenCalledTimes(1);
    });
});

// ────────────────────────────────
// 「見た」印（端末をまたぐ）
// ────────────────────────────────
describe("getStories: seen（見た印）", () => {
    it("自分の足あとがあれば true。他人の足あと・本人の行には付けない。viewers は返さない", async () => {
        addStory(SID_ALL, { viewers: { [CF]: { displayName: "x", at: PAST }, [STRANGER]: { displayName: "ワイ", at: PAST } } });
        const mine = bodyOf(await invoke(getStories, ev(CF)))[0];
        expect(mine.seen).toBe(true);
        expect(mine).not.toHaveProperty("viewers");
        const other = bodyOf(await invoke(getStories, ev(FOLLOWER)))[0];
        expect(other).not.toHaveProperty("seen");
        expect(JSON.stringify(other)).not.toContain("ワイ");
        const own = bodyOf(await invoke(getStories, ev(OWNER)))[0];
        expect(own).not.toHaveProperty("seen");
    });
});

// ────────────────────────────────
// メンション（投稿のときにサーバーが解く）
// ────────────────────────────────
describe("createStory: メンション", () => {
    const mention = (userId: string) => ({ kind: "mention", userId, x: 0.5, y: 0.5, size: 0.05 });
    const post = (body: Record<string, unknown>) => invoke(createStory, ev(OWNER, {
        body: JSON.stringify({ publicUrl: `https://cdn.test/uploads/${OWNER}/a.webp`, ...body }),
    }));
    const storedTexts = () => (sent.find((c) => c.constructor.name === "PutCommand")?.input.Item as { texts?: { userId?: string; name?: string }[] }).texts;

    it("見られる人（フォロワー）は残り、名前はサーバーが引いたもの。通知は storymention", async () => {
        const r = await post({ texts: [{ ...mention(CF), name: "なりすまし" }] });
        expect(r.statusCode).toBe(201);
        expect(storedTexts()).toEqual([expect.objectContaining({ kind: "mention", userId: CF, name: `名前-${CF.slice(0, 4)}` })]);
        expect(mockPush).toHaveBeenCalledTimes(1);
        const [to, notif] = mockPush.mock.calls[0] as [string, Record<string, unknown>];
        expect(to).toBe(CF);
        expect(notif).toMatchObject({ type: "storymention", byId: OWNER, photoId: expect.stringMatching(/^story-/) });
    });

    it("フォロワーでない人・自分自身は落ちる（通知0）", async () => {
        await post({ texts: [mention(STRANGER), mention(OWNER)] });
        expect(storedTexts()).toBeUndefined();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("ブロックの関係がある人は、どちら向きでも落ちる（通知0）", async () => {
        block(OWNER, CF);        // 投稿者が相手をブロック
        block(FOLLOWER, OWNER);  // 相手が投稿者をブロック
        await post({ texts: [mention(CF), mention(FOLLOWER)] });
        expect(storedTexts()).toBeUndefined();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("親しい友達だけの投稿では、名簿に居ないフォロワーはメンションできない（投稿の存在も漏らさない）", async () => {
        await post({ audience: "closeFriends", texts: [mention(FOLLOWER), mention(CF)] });
        expect(storedTexts()!.map((t) => t.userId)).toEqual([CF]);
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush.mock.calls[0][0]).toBe(CF);
    });

    it("通知は保存に成功したあと。保存に失敗したら送らない", async () => {
        const impl = mockDdbSend.getMockImplementation()!;
        mockDdbSend.mockImplementation(async (cmd: Cmd) => {
            if (cmd.constructor.name === "PutCommand") throw new Error("boom");
            return impl(cmd);
        });
        expect((await post({ texts: [mention(CF)] })).statusCode).toBe(500);
        expect(mockPush).not.toHaveBeenCalled();
    });
});

// ────────────────────────────────
// 質問の答え（投稿者だけが読める・通報）
// ────────────────────────────────
describe("質問スタンプの答え", () => {
    const QUESTION = { kind: "question", prompt: "おすすめは？", x: 0.5, y: 0.5, size: 0.05 };
    const answers = (sub: string, id = SID) => invoke(getStoryAnswers, withId(sub, id));
    const answer = (sub: string, text: unknown, id = SID) => invoke(answerStory, withId(sub, id, { text }));

    beforeEach(() => { addStory(SID, { texts: [QUESTION] }); });

    it("答えは保存され、読めるのは投稿者だけ（他人は 403）", async () => {
        const r = await answer(CF, "朝の海");
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).not.toHaveProperty("text");  // 答えた本人にも中身は返さない
        const mine = bodyOf(await answers(OWNER));
        expect(mine.count).toBe(1);
        expect(mine.items[0]).toMatchObject({ uid: CF, text: "朝の海" });
        for (const who of [CF, FOLLOWER, STRANGER]) expect((await answers(who)).statusCode, who).toBe(403);
    });

    it("一覧（getStories）には答えの中身も他人の答えも出ない。投稿者の行にだけ件数が付く", async () => {
        await answer(CF, "秘密の答え");
        for (const who of [CF, FOLLOWER]) {
            const res = await invoke(getStories, ev(who));
            expect(res.body).not.toContain("秘密の答え");
            expect(bodyOf(res)[0]).not.toHaveProperty("answerCount");
        }
        const own = await invoke(getStories, ev(OWNER));
        expect(own.body).not.toContain("秘密の答え");
        expect(bodyOf(own)[0].answerCount).toBe(1);
    });

    it("質問の無い投稿・自分の質問・空の答え・型違いは断る", async () => {
        addStory(SID_ALL);
        expect((await answer(CF, "x", SID_ALL)).statusCode).toBe(400);
        expect((await answer(OWNER, "x")).statusCode).toBe(400);
        expect((await answer(CF, "   ")).statusCode).toBe(400);
        expect((await answer(CF, { a: 1 })).statusCode).toBe(400);
        expect((await invoke(answerStory, withId(undefined, SID, { text: "x" }))).statusCode).toBe(400);
    });

    it("ブロックされている人・期限切れは 404", async () => {
        block(OWNER, CF);
        expect((await answer(CF, "x")).statusCode).toBe(404);
        db.set(SID, { ...db.get(SID)!, expiresAt: PAST });
        expect((await answer(FOLLOWER, "x")).statusCode).toBe(404);
    });

    it("1人の上限（3件）で 429。長い答えは 200字で切る", async () => {
        for (let i = 0; i < 3; i++) expect((await answer(CF, `答え${i}`)).statusCode).toBe(200);
        expect((await answer(CF, "4つ目")).statusCode).toBe(429);
        const r = await answer(FOLLOWER, "あ".repeat(500));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(await answers(OWNER)).items[0].text).toHaveLength(200);
    });

    it("通知は投稿者に既存の storyreply で1通（古いアプリが読める種類）", async () => {
        await answer(CF, "x");
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush.mock.calls[0][0]).toBe(OWNER);
        expect(mockPush.mock.calls[0][1]).toMatchObject({ type: "storyreply", byId: CF, photoId: SID });
    });

    it("ブロックした相手の答えは投稿者にも出ない（両向き）", async () => {
        await answer(CF, "ブロック前の答え");
        db.set(`blocks#${OWNER}`, { id: `blocks#${OWNER}`, blockedIds: [CF] });
        expect(bodyOf(await answers(OWNER)).items).toEqual([]);
    });

    describe("通報（答え1件ごと・投稿者だけ）", () => {
        const report = (sub: string, answerId: string, body: unknown = { reason: "harassment", note: "ひどい" }) =>
            invoke(reportStoryAnswer, ev(sub, { pathParameters: { id: SID, answerId }, body: JSON.stringify(body) }));
        let aid = "";
        beforeEach(async () => {
            await answer(CF, "いやな答え");
            aid = bodyOf(await answers(OWNER)).items[0].id;
        });

        it("投稿者は通報できる。**答えの全文と答えた人の uid を行に写す**（消えたあとも読める）", async () => {
            const r = await report(OWNER, aid);
            expect(r.statusCode).toBe(200);
            const row = [...db.values()].find((x) => String(x.id).startsWith("report#"))!;
            expect(row).toMatchObject({
                photoId: SID, answerId: aid, reporterId: OWNER, ownerId: CF, reason: "harassment", note: "ひどい",
                story: true, storyAnswer: true, answerText: "いやな答え", question: "おすすめは？",
            });
        });

        it("押し直しても1件のまま", async () => {
            await report(OWNER, aid);
            await report(OWNER, aid, { reason: "spam" });
            expect([...db.keys()].filter((k) => k.startsWith("report#"))).toHaveLength(1);
        });

        it("投稿者以外は 404（答えの実在を探らせない）・書き込み0", async () => {
            sent = [];
            for (const who of [CF, FOLLOWER, STRANGER]) expect((await report(who, aid)).statusCode, who).toBe(404);
            expect(wrote()).toBe(false);
        });

        it("理由が一覧に無い・無い答え ID は断る", async () => {
            expect((await report(OWNER, aid, { reason: "なんでも" })).statusCode).toBe(400);
            expect((await report(OWNER, "nope")).statusCode).toBe(404);
        });
    });
});

// ────────────────────────────────
// 消す経路: 答えは票の文書の列に置くので、票の文書を消す全経路で一緒に消える
// ────────────────────────────────
describe("答えを消す経路が取りこぼされない", () => {
    it("答えは `storyvotes#<id>` の `answers` 列に在る（別の文書を作らない）", async () => {
        addStory(SID, { texts: [{ kind: "question", prompt: "q", x: 0.5, y: 0.5, size: 0.05 }] });
        await invoke(answerStory, withId(CF, SID, { text: "x" }));
        expect([...db.keys()].filter((k) => k.includes(SID))).toEqual([SID, `storyvotes#${SID}`]);
        expect(db.get(`storyvotes#${SID}`)!.answers).toHaveLength(1);
    });

    it("票の文書を消している全ての削除経路のソースが、まだ票の文書を消している", () => {
        const root = join(__dirname, "..");
        for (const f of ["stories.ts", "account.ts", "photoUpdate.ts"]) {
            expect(readFileSync(join(root, f), "utf8"), `${f} が票の文書を消さなくなった（答えが残る）`).toMatch(/storyvotes#|storyVotesId|sweepStoryVotes/);
        }
    });
});

// ────────────────────────────────
// レビュー対応（札 #505）
// ────────────────────────────────
describe("退会した人のメンションの名前は読むとき伏せる", () => {
    const MENTION = { kind: "mention", userId: CF, name: "田中", x: 0.5, y: 0.5, size: 0.05 };
    const nameIn = (res: Result) => bodyOf(res)[0].texts[0].name;

    it("getStories: 生きていれば名前、退会していれば「退会したユーザー」（札は残る）", async () => {
        addStory(SID_ALL, { texts: [MENTION] });
        expect(nameIn(await invoke(getStories, ev(FOLLOWER)))).toBe("田中");
        deletedIds.add(CF);
        const res = await invoke(getStories, ev(FOLLOWER));
        expect(nameIn(res)).toBe("退会したユーザー");
        expect(bodyOf(res)[0].texts[0].userId).toBe(CF);
    });

    it("ハイライト（getHighlight）も同じ", async () => {
        const HID = "99999999-9999-4999-8999-999999999999";
        const OPEN = "story-44444444-4444-4444-8444-444444444444";
        db.set(OPEN, { id: OPEN, story: true, userId: OWNER, src: "https://cdn.test/o.webp", archive: true, expiresAt: PAST, createdAt: PAST, texts: [MENTION] });
        db.set(`highlight#${HID}`, { id: `highlight#${HID}`, ownerId: OWNER, title: "旅", storyIds: [OPEN], coverStoryId: OPEN });
        const get = () => invoke(getHighlight, ev(FOLLOWER, { pathParameters: { userId: OWNER, id: HID } }));
        expect(bodyOf(await get()).items[0].texts[0].name).toBe("田中");
        deletedIds.add(CF);
        expect(bodyOf(await get()).items[0].texts[0].name).toBe("退会したユーザー");
    });
});

describe("親しい友達の名簿は上限なら追加を断る", () => {
    const put = (sub: string, target: string, method = "PUT") =>
        invoke(setCloseFriend, { requestContext: { authorizer: { jwt: { claims: { sub } } }, http: { method } }, pathParameters: { id: target } });
    const full = () => Array.from({ length: 200 }, (_, i) => `f${String(i).padStart(8, "0")}`);

    it("200人のとき追加は 400（code: close_friends_limit）で、何も書かず、誰も外れない", async () => {
        db.set(`closefriends#${OWNER}`, { id: `closefriends#${OWNER}`, list: full() });
        sent = [];
        const r = await put(OWNER, STRANGER);
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).code).toBe("close_friends_limit");
        expect(wrote()).toBe(false);
        expect((db.get(`closefriends#${OWNER}`)!.list as string[])).toHaveLength(200);
    });

    it("200人でも、外す・すでに居る人の追加は通る。199人なら追加できる", async () => {
        const list = full();
        db.set(`closefriends#${OWNER}`, { id: `closefriends#${OWNER}`, list });
        expect((await put(OWNER, list[5])).statusCode).toBe(200);        // 既に居る＝変わらない
        expect((await put(OWNER, list[5], "DELETE")).statusCode).toBe(200);
        expect((await put(OWNER, STRANGER)).statusCode).toBe(200);
        expect((db.get(`closefriends#${OWNER}`)!.list as string[])[0]).toBe(STRANGER);
        expect((db.get(`closefriends#${OWNER}`)!.list as string[])).toHaveLength(200);
    });
});

describe("名簿の読み: 親しい友達向けの門だけ強整合", () => {
    const closeReads = () => sent.filter((c) => c.constructor.name === "GetCommand" && String(c.input.Key?.id ?? "").startsWith("closefriends#"));

    it("親しい友達向けの行の門（一覧・閲覧・返信）は ConsistentRead: true", async () => {
        addStory(SID, { audience: "closeFriends" });
        await invoke(getStories, ev(CF));
        await invoke(viewStory, withId(CF, SID));
        await invoke(postStoryReply, withId(CF, SID, { text: "a" }));
        expect(closeReads().length).toBeGreaterThanOrEqual(3);
        for (const c of closeReads()) expect(c.input.ConsistentRead, "結果整合で読んでいる").toBe(true);
    });

    it("全員向けの門では名簿を読まない（読み取りが増えない）", async () => {
        addStory(SID_ALL);
        await invoke(getStories, ev(FOLLOWER));
        await invoke(viewStory, withId(FOLLOWER, SID_ALL));
        await invoke(postStoryReply, withId(FOLLOWER, SID_ALL, { text: "a" }));
        expect(closeReads()).toHaveLength(0);
    });
});

describe("ハイライトの coverStoryId は見せない行なら返さない", () => {
    it("名簿の外には undefined、名簿の中と本人には返す", async () => {
        const HID = "99999999-9999-4999-8999-999999999999";
        const CLOSE = "story-33333333-3333-4333-8333-333333333333";
        const OPEN = "story-44444444-4444-4444-8444-444444444444";
        for (const [id, extra] of [[CLOSE, { audience: "closeFriends" }], [OPEN, {}]] as const) {
            db.set(id, { id, story: true, userId: OWNER, src: `https://cdn.test/${id}.webp`, archive: true, expiresAt: PAST, createdAt: PAST, ...extra });
        }
        db.set(`highlight#${HID}`, { id: `highlight#${HID}`, ownerId: OWNER, title: "旅", storyIds: [CLOSE, OPEN], closeIds: [CLOSE], coverStoryId: CLOSE });
        const get = (sub: string) => invoke(getHighlight, ev(sub, { pathParameters: { userId: OWNER, id: HID } }));
        expect(bodyOf(await get(FOLLOWER)).coverStoryId).toBeUndefined();
        expect(bodyOf(await get(CF)).coverStoryId).toBe(CLOSE);
        expect(bodyOf(await get(OWNER)).coverStoryId).toBe(CLOSE);
    });
});
