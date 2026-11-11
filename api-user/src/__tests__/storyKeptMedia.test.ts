import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ストーリーとそこから作った写真の**消すときの約束**（2026-11-11 判断・`storyKeptMedia.ts`・`storyKeptDelete.ts`）。
 *
 * 表（DynamoDB）と置き場（S3）を**手元の Map と Set で真似て**、口（keepStory・deleteStory・
 * deleteMyPhoto・cleanupExpiredStories）を実際に通し、**終わったときに S3 に何が残っているか**で縛る:
 *
 *   1. ストーリーを消す → ストーリーの画像だけ消え、写真は残る
 *   2. 写真を消す → 写真の画像だけ消え、ストーリーは残る
 *   3. どちらを消しても、画像が S3 に置き去りにならない
 *   4. 退会で両方とも消える
 *   5. 期限で消える普通のストーリーの掃除は、写した写真の画像を消さない
 *
 * ＋ 一緒に消す（`withStory=1`）・写真だけ（`withStory=0`）・古いアプリ（指定なし）の3つ。
 */

const table = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const bucket = vi.hoisted(() => new Set<string>());
const s3Fail = vi.hoisted(() => ({ copy: false }));

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

const fakeDdb = vi.hoisted(() => async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    const id = String((input.Key as { id?: string } | undefined)?.id ?? "");
    const vals = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
    if (name === "GetCommand") {
        const row = table.get(id);
        return { Item: row ? { ...row } : undefined };
    }
    if (name === "DeleteCommand") { table.delete(id); return {}; }
    if (name === "QueryCommand") {
        // 掃除の「期限切れ」（`storyFeed` の索引）だけを真似る
        const now = String(vals[":now"] ?? "");
        const expired = String(input.KeyConditionExpression ?? "").includes("<=");
        return {
            Items: [...table.values()].filter((r) => r.story === true && "storyFeed" in r
                && (expired ? String(r.expiresAt) <= now : String(r.expiresAt) > now)).map((r) => ({ ...r })),
        };
    }
    if (name === "UpdateCommand") {
        const expr = String(input.UpdateExpression ?? "");
        const cond = String(input.ConditionExpression ?? "");
        const row = table.get(id);
        if (expr.startsWith("SET keptAs")) {
            if (!row || "keptAs" in row) throw (Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            row.keptAs = vals[":p"];
            if (expr.includes("keptCopy")) row.keptCopy = vals[":t"];
            return {};
        }
        if (expr.startsWith("REMOVE keptAs")) {
            if (!row || (cond.includes("keptAs = :p") && row.keptAs !== vals[":p"])) {
                throw (Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            delete row.keptAs;
            delete row.keptCopy;
            return {};
        }
        return {};   // ほかの更新（数・印）はここでは見ない
    }
    return {};
});

vi.mock("../dynamodb", () => ({
    ddb: { send: (c: Cmd) => fakeDdb(c) },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class {
        async send(cmd: { kind: string; input: Record<string, unknown> }) {
            if (cmd.kind === "copy") {
                if (s3Fail.copy) throw new Error("copy failed");
                const from = decodeURI(String(cmd.input.CopySource)).replace(/^bucket-test\//, "");
                if (!bucket.has(from)) throw new Error(`NoSuchKey ${from}`);
                bucket.add(String(cmd.input.Key));
                return {};
            }
            if (cmd.kind === "delete") {
                for (const o of ((cmd.input.Delete as { Objects: { Key: string }[] }).Objects)) bucket.delete(o.Key);
                return { Errors: [] };
            }
            return {};
        }
    },
    CopyObjectCommand: class { kind = "copy"; input: unknown; constructor(i: unknown) { this.input = i; } },
    DeleteObjectsCommand: class { kind = "delete"; input: unknown; constructor(i: unknown) { this.input = i; } },
    DeleteObjectCommand: class { kind = "delete1"; input: unknown; constructor(i: unknown) { this.input = i; } },
}));
vi.mock("../ddb-photos", () => ({
    putPhoto: async (p: Record<string, unknown>) => {
        if (table.has(String(p.id))) throw (Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
        table.set(String(p.id), { ...p });
    },
}));
vi.mock("../photoLimit", () => ({ photoLimitError: async () => null }));
vi.mock("../cdnInvalidate", () => ({ invalidateUploads: async () => true }));
vi.mock("../rebuild", () => ({ requestSiteRebuild: async () => true }));
vi.mock("../userProfile", () => ({ removePinnedPhoto: async () => true }));
vi.mock("../trunk", () => ({ revokeLabelQuietly: async () => undefined }));
vi.mock("../liveCaller", async (importActual) => ({
    ...(await importActual<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => null,
    readLiveCaller: async () => ({ live: true }),
}));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: async () => false,
    hiddenUserIds: async () => new Set<string>(),
}));
vi.mock("../notify", async (importActual) => ({
    ...(await importActual<typeof import("../notify")>()),
    lookupDisplayName: async () => "名前",
    lookupDisplayNameIfSet: async () => "名前",
    deletedAmong: async () => ({ deleted: new Set<string>(), unread: new Set<string>() }),
    pushNotification: async () => undefined,
}));
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");

const { keepStory } = await import("../storyKeep");
const { deleteStory, cleanupExpiredStories } = await import("../stories");
const { deleteMyPhoto } = await import("../photoUpdate");
const { mediaKeys } = await import("../mediaKeys");
const { keptCopyKey, sharesKeptMedia } = await import("../storyKeptMedia");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);
const ME = "me";
const ev = (id: string, query?: Record<string, string>) => ({
    requestContext: { authorizer: { jwt: { claims: { sub: ME } } } },
    pathParameters: { id },
    ...(query ? { queryStringParameters: query } : {}),
});
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const KEY = `uploads/${ME}/3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607.webp`;
const COPY = `uploads/${ME}/kept-3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607.webp`;

function putStory(extra: Record<string, unknown> = {}) {
    table.set("story-1", {
        id: "story-1", story: true, userId: ME, mediaType: "image",
        src: `https://cdn.test/${KEY}`, key: KEY, storyFeed: "1",
        createdAt: "2026-11-11T00:00:00.000Z", expiresAt: FUTURE, ...extra,
    });
    bucket.add(KEY);
}
/** 写真にして、その写真の id を返す */
async function keep(): Promise<string> {
    const r = await call(keepStory, ev("story-1"));
    expect(r.statusCode, r.body).toBe(200);
    return JSON.parse(r.body).photoId as string;
}

beforeEach(() => {
    table.clear();
    bucket.clear();
    s3Fail.copy = false;
});

describe("自分用に残すストーリーを写真にする（写して切り離す）", () => {
    it("画像を別の鍵に写し、写真は写しを指す。前の 409 は出ない", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        const photo = table.get(photoId)!;
        expect(bucket.has(COPY), "写していない").toBe(true);
        expect(photo.key).toBe(COPY);
        expect(String(photo.src)).toBe(`https://cdn.test/${COPY}`);
        // 関係は `fromStory`。**`keptFrom` は付けない**（付けると写真を消したときストーリーごと消える）
        expect(photo.fromStory).toBe("story-1");
        expect("keptFrom" in photo, "共有の印を付けている").toBe(false);
        const story = table.get("story-1")!;
        expect(story.keptAs).toBe(photoId);
        expect(story.keptCopy, "「共有していない」印が無い").toBe(true);
        expect(sharesKeptMedia(story)).toBe(false);
    });

    it("写せなければ何も書かない（500）", async () => {
        putStory({ archive: true });
        s3Fail.copy = true;
        const r = await call(keepStory, ev("story-1"));
        expect(r.statusCode).toBe(500);
        expect([...table.keys()]).toEqual(["story-1"]);
        expect("keptAs" in table.get("story-1")!).toBe(false);
    });

    it("二度押しても写しは1つ・写真は1枚", async () => {
        putStory({ archive: true });
        const a = await keep();
        const b = await keep();
        expect(b).toBe(a);
        expect([...bucket].sort()).toEqual([COPY, KEY].sort());
    });

    it("生きている普通のストーリーは今までどおり共有（写さない・keptFrom）", async () => {
        putStory();
        const photoId = await keep();
        expect(bucket.has(COPY), "普通のストーリーまで写している").toBe(false);
        expect(table.get(photoId)!.keptFrom).toBe("story-1");
        expect(sharesKeptMedia(table.get("story-1")!)).toBe(true);
    });

    it("写す先は本人の置き場から出ない", () => {
        expect(keptCopyKey(`uploads/${ME}/a.webp`)).toBe(`uploads/${ME}/kept-a.webp`);
        expect(keptCopyKey("uploads/a.webp")).toBe("");
        expect(keptCopyKey("profiles/me/a.webp")).toBe("");
        expect(keptCopyKey(`uploads/${ME}/../x.webp`)).toBe("");
    });
});

describe("消すときの約束（写したとき）", () => {
    it("約束1: ストーリーを消す → ストーリーの画像だけ消え、写真は残る", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        expect((await call(deleteStory, ev("story-1"))).statusCode).toBe(200);
        expect(table.has("story-1")).toBe(false);
        expect(bucket.has(KEY), "約束3: ストーリーの画像が置き去り").toBe(false);
        expect(table.has(photoId), "写真まで消えた").toBe(true);
        expect(bucket.has(COPY), "写真の画像まで消えた").toBe(true);
    });

    it("約束2: 写真を消す（古いアプリ＝指定なし）→ 写真の画像だけ消え、ストーリーは残る", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        expect((await call(deleteMyPhoto, ev(photoId))).statusCode).toBe(200);
        expect(table.has(photoId)).toBe(false);
        expect(bucket.has(COPY), "約束3: 写真の画像が置き去り").toBe(false);
        expect(table.has("story-1"), "ストーリーまで消えた").toBe(true);
        expect(bucket.has(KEY), "ストーリーの画像まで消えた").toBe(true);
        // 写真にした印は外す（札が消え、もう一度写真にできる）
        expect("keptAs" in table.get("story-1")!).toBe(false);
    });

    it("約束2: 写真だけ消す（withStory=0）も同じ", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        expect((await call(deleteMyPhoto, ev(photoId, { withStory: "0" }))).statusCode).toBe(200);
        expect([...bucket]).toEqual([KEY]);
        expect(table.has("story-1")).toBe(true);
    });

    it("一緒に消す（withStory=1）→ 両方の行と両方の画像が消える", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        expect((await call(deleteMyPhoto, ev(photoId, { withStory: "1" }))).statusCode).toBe(200);
        expect(table.has(photoId)).toBe(false);
        expect(table.has("story-1")).toBe(false);
        expect([...bucket], "約束3: 画像が置き去り").toEqual([]);
    });

    it("約束3: 写真 → ストーリーの順に別々に消しても、何も残らない", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        await call(deleteMyPhoto, ev(photoId, { withStory: "0" }));
        await call(deleteStory, ev("story-1"));
        expect([...bucket]).toEqual([]);
        expect(table.size).toBe(0);
    });

    it("約束4: 退会の列挙（行ごとの mediaKeys）が、写真の画像とストーリーの画像を両方拾う", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        // `account.ts` は本人の行を1つずつ `mediaKeys` で消す。2つの行の鍵を合わせると、置き場の全部になる
        const all = new Set([...mediaKeys(table.get(photoId)!), ...mediaKeys(table.get("story-1")!)]);
        expect([...bucket].every((k) => all.has(k)), "退会で消えない画像がある").toBe(true);
        expect(all.has(COPY) && all.has(KEY)).toBe(true);
    });

    it("約束5: 自分用に残すストーリーは期限で棚へ移る（画像も写真も消さない）", async () => {
        putStory({ archive: true });
        const photoId = await keep();
        table.get("story-1")!.expiresAt = PAST;
        await cleanupExpiredStories();
        expect(bucket.has(COPY), "写した写真の画像を掃除が消した").toBe(true);
        expect(table.has(photoId)).toBe(true);
    });

    it("約束5: 写した印のある行を掃除が消すときも、写真の画像は消さない", async () => {
        // 自分用に残す印を外した行（棚へ移さず消える側）でも、消すのはストーリーの画像だけ
        putStory({ archive: true });
        const photoId = await keep();
        const story = table.get("story-1")!;
        delete story.archive;
        story.expiresAt = PAST;
        await cleanupExpiredStories();
        expect(table.has("story-1")).toBe(false);
        expect(bucket.has(KEY), "約束3: ストーリーの画像が置き去り").toBe(false);
        expect(bucket.has(COPY), "写した写真の画像を掃除が消した").toBe(true);
        expect(table.has(photoId)).toBe(true);
    });
});

describe("消すときの約束（共有のとき・生きている普通のストーリー）", () => {
    it("約束5: 期限の掃除は、共有している写真の画像を消さない（今までどおり）", async () => {
        putStory();
        const photoId = await keep();
        table.get("story-1")!.expiresAt = PAST;
        await cleanupExpiredStories();
        expect(table.has("story-1")).toBe(false);
        expect(bucket.has(KEY), "写真の画像を掃除が消した").toBe(true);
        expect(table.has(photoId)).toBe(true);
    });

    it("古いアプリ（指定なし）で写真を消すと、今までどおりストーリーも一緒に消える", async () => {
        putStory();
        const photoId = await keep();
        expect((await call(deleteMyPhoto, ev(photoId))).statusCode).toBe(200);
        expect(table.size).toBe(0);
        expect([...bucket]).toEqual([]);
    });

    it("写真だけ消す（withStory=0）→ 共有の画像はストーリーに渡し、ストーリーは残る", async () => {
        putStory();
        const photoId = await keep();
        expect((await call(deleteMyPhoto, ev(photoId, { withStory: "0" }))).statusCode).toBe(200);
        expect(table.has(photoId)).toBe(false);
        expect(table.has("story-1")).toBe(true);
        expect(bucket.has(KEY), "ストーリーの画像まで消えた（割れる）").toBe(true);
        // 印を外したので、このあとストーリーを消すと画像も消える（置き去りにしない）
        expect("keptAs" in table.get("story-1")!).toBe(false);
        await call(deleteStory, ev("story-1"));
        expect([...bucket], "約束3: 画像が置き去り").toEqual([]);
    });

    it("写真だけ消す（withStory=0）で期限の掃除が来ても、画像は残らない", async () => {
        putStory();
        const photoId = await keep();
        await call(deleteMyPhoto, ev(photoId, { withStory: "0" }));
        table.get("story-1")!.expiresAt = PAST;
        await cleanupExpiredStories();
        expect([...bucket], "約束3: 画像が置き去り").toEqual([]);
    });

    it("ストーリーだけ消す → 写真と画像は残る（今までどおり）", async () => {
        putStory();
        const photoId = await keep();
        await call(deleteStory, ev("story-1"));
        expect(table.has(photoId)).toBe(true);
        expect(bucket.has(KEY)).toBe(true);
    });
});
