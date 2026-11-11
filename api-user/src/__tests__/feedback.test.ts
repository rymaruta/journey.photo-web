import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 意見箱（`feedback.ts`・札 #546）。DynamoDB と署名は境界でモックし、
 * 「どの行をどの条件で書いたか」「どの判定で断ったか」「何を保存しないか」を見る。
 */

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test" }));

const mockLive = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
vi.mock("../liveCaller", () => ({ assertLiveCaller: () => mockLive() }));

const mockSign = vi.hoisted(() => vi.fn(async (...a: unknown[]) => { void a; return "https://s3.example/signed"; }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: (...a: unknown[]) => mockSign(...a) }));

const fb = await import("../feedback");
const { sendFeedback, sendFeedbackPublic, parseFeedback, ipBucket, feedbackDayOf, cleanToken,
    FEEDBACK_TEXT_MAX, FEEDBACK_DAILY_PER_IP, FEEDBACK_DAILY_PER_USER, FEEDBACK_DAILY_TOTAL, FEEDBACK_PHOTO_MAX_BYTES } = fb;

const ME = "11111111-1111-4111-8111-111111111111";
const DRAFT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECRET = "ひみつの意見-7c1e";

type Call = { cmd: string; input: Record<string, any> };   // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Call[];
let rows: Record<string, Record<string, unknown>>;
let ccfOn: (c: Call) => boolean;

beforeEach(() => {
    calls = [];
    rows = {};
    ccfOn = () => false;
    mockLive.mockReset().mockResolvedValue(null);
    mockSign.mockClear();
    mockSend.mockReset().mockImplementation(async (command: { constructor: { name: string }; input: Record<string, any> }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const c = { cmd: command.constructor.name, input: command.input };
        calls.push(c);
        if (ccfOn(c)) throw Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" });
        if (c.cmd === "GetCommand") return { Item: rows[c.input.Key.id] };
        if (c.cmd === "PutCommand") rows[c.input.Item.id] = c.input.Item;
        return {};
    });
});

const authed = (body: unknown, uid = ME) => ({
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: uid } } }, http: { sourceIp: "203.0.113.9" } },
}) as never;
const anon = (body: unknown, ip = "198.51.100.7") => ({ body: JSON.stringify(body), requestContext: { http: { sourceIp: ip } } }) as never;
const call = async (h: typeof sendFeedback | typeof sendFeedbackPublic, ev: never) =>
    (await (h as (e: never, c: never, cb: never) => Promise<{ statusCode: number; body: string }>)(ev, {} as never, (() => undefined) as never));
const bodyOf = (r: { body: string }) => JSON.parse(r.body) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const put = () => calls.find((c) => c.cmd === "PutCommand")!.input;
const update = () => calls.find((c) => c.cmd === "UpdateCommand")!.input;

describe("本文の整え（parseFeedback）", () => {
    it("本文が空・見えない字だけなら 400（feedback_empty）", () => {
        for (const text of ["", "   ", "​‮﻿", undefined, 3]) {
            const r = parseFeedback({ text });
            expect("statusCode" in r && r.statusCode).toBe(400);
        }
    });
    it("改行は残し、見えない字と制御文字を落とし、上限で切る（dm と同じ考え）", () => {
        const r = parseFeedback({ text: "  使い​やすい\r\n\n\n\nです\u0000 " });
        expect("text" in r && r.text).toBe("使いやすい\n\nです");
        const long = parseFeedback({ text: "あ".repeat(FEEDBACK_TEXT_MAX + 300) });
        expect("text" in long && long.text.length).toBeLessThanOrEqual(FEEDBACK_TEXT_MAX);
    });
    it("画面・版・OS は英数字と少しの記号だけを短く通す", () => {
        expect(cleanToken("story-create<script>", 40)).toBe("story-createscript");
        expect(cleanToken("iOS 18.1 (22B83)\n", 32)).toBe("iOS 18.1 (22B83)");
        expect(cleanToken({}, 32)).toBe("");
    });
    it("id は UUID だけ。無ければサーバーが作る", () => {
        expect("statusCode" in parseFeedback({ text: "a", id: "feedbackday#2026" })).toBe(true);
        const r = parseFeedback({ text: "a" });
        expect("id" in r && /^[0-9a-f-]{36}$/.test(r.id)).toBe(true);
        const up = parseFeedback({ text: "a", id: DRAFT.toUpperCase() });
        expect("id" in up && up.id).toBe(DRAFT);
    });
    it("写真は画像の種別だけ・上限まで（SVG・動画・上限超えは 400）", () => {
        for (const photo of [{ contentType: "image/svg+xml", size: 10 }, { contentType: "video/mp4", size: 10 },
            { contentType: "image/jpeg", size: FEEDBACK_PHOTO_MAX_BYTES + 1 }, { contentType: "image/jpeg", size: 1.5 }]) {
            expect("statusCode" in parseFeedback({ text: "a", photo })).toBe(true);
        }
        const ok = parseFeedback({ text: "a", photo: { contentType: "Image/JPEG; q=1", size: 1000 } });
        expect("photo" in ok && ok.photo).toEqual({ contentType: "image/jpeg", size: 1000 });
    });
});

describe("ログインした人（POST /user/feedback）", () => {
    it("意見の行と、その日の索引・歯止めを書く。写真の行と見分けのつく欄だけ", async () => {
        const r = await call(sendFeedback, authed({
            id: DRAFT, text: SECRET, screen: "settings", appVersion: "1.1.20 (3)", os: "iOS 18.1", platform: "ios", wantsReply: true,
        }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ ok: true, id: DRAFT });
        const item = put().Item;
        expect(item).toMatchObject({
            id: `feedback#${DRAFT}`, feedback: true, text: SECRET, screen: "settings", appVersion: "1.1.20 (3)",
            os: "iOS 18.1", platform: "ios", wantsReply: true, uid: ME, day: feedbackDayOf(),
        });
        expect(put().ConditionExpression).toBe("attribute_not_exists(id)");
        // 公開一覧の Scan・索引に載る欄を持たない（`src`・`userId`・`publicFeed`・`storyFeed`・`story`）
        for (const k of ["src", "userId", "publicFeed", "storyFeed", "story", "audience"]) expect(item).not.toHaveProperty(k);
        // 位置・IP は持たない
        for (const k of ["lat", "lng", "location", "ip", "sourceIp"]) expect(item).not.toHaveProperty(k);
        expect(JSON.stringify(item)).not.toContain("203.0.113.9");
        const u = update();
        expect(u.Key).toEqual({ id: `feedbackday#${feedbackDayOf()}` });
        expect(u.ExpressionAttributeNames["#w"]).toBe(`by_u_${ME}`);
        expect(u.ExpressionAttributeValues[":maxWho"]).toBe(FEEDBACK_DAILY_PER_USER);
        expect(u.ExpressionAttributeValues[":maxTotal"]).toBe(FEEDBACK_DAILY_TOTAL);
        expect(u.ExpressionAttributeValues[":idl"]).toEqual([DRAFT]);
        expect(u.ConditionExpression).toContain("total < :maxTotal");
        expect(u.ConditionExpression).toContain("#w < :maxWho");
    });

    it("退会した本人は通さない（liveCaller の 410 をそのまま返し、何も書かない）", async () => {
        mockLive.mockResolvedValueOnce({ statusCode: 410, body: "{}" });
        const r = await call(sendFeedback, authed({ text: "a" }));
        expect(r.statusCode).toBe(410);
        expect(calls).toEqual([]);
    });

    it("1日の上限に達したら 429（feedback_limit）で、意見の行は書かない", async () => {
        ccfOn = (c) => c.cmd === "UpdateCommand";
        const r = await call(sendFeedback, authed({ text: "a" }));
        expect(r.statusCode).toBe(429);
        expect(bodyOf(r).code).toBe("feedback_limit");
        expect(calls.some((c) => c.cmd === "PutCommand")).toBe(false);
    });

    it("同じ id の送り直しは1件のまま（数えない・書かない）", async () => {
        await call(sendFeedback, authed({ id: DRAFT, text: "a" }));
        calls = [];
        const r = await call(sendFeedback, authed({ id: DRAFT, text: "a" }));
        expect(r.statusCode).toBe(200);
        expect(calls.map((c) => c.cmd)).toEqual(["GetCommand"]);
    });

    it("別の人の id を当てても 409 で、写真の署名は出さない", async () => {
        rows[`feedback#${DRAFT}`] = { id: `feedback#${DRAFT}`, uid: "22222222-2222-4222-8222-222222222222", photoKey: "private/feedback/x", photoType: "image/jpeg" };
        const r = await call(sendFeedback, authed({ id: DRAFT, text: "a", photo: { contentType: "image/jpeg", size: 10 } }));
        expect(r.statusCode).toBe(409);
        expect(mockSign).not.toHaveBeenCalled();
    });

    it("写真を添えると private/feedback/<id> への署名つき PUT を返す（種別と長さを署名に入れる）", async () => {
        const r = await call(sendFeedback, authed({ id: DRAFT, text: "a", photo: { contentType: "image/jpeg", size: 2048 } }));
        expect(bodyOf(r).upload).toEqual({ url: "https://s3.example/signed", contentType: "image/jpeg" });
        expect(put().Item).toMatchObject({ photoKey: `private/feedback/${DRAFT}`, photoType: "image/jpeg" });
        const [, cmd, opts] = mockSign.mock.calls[0] as [unknown, { input: Record<string, unknown> }, { signableHeaders: Set<string> }];
        expect(cmd.input).toMatchObject({ Key: `private/feedback/${DRAFT}`, ContentType: "image/jpeg", ContentLength: 2048 });
        expect([...opts.signableHeaders].sort()).toEqual(["content-length", "content-type"]);
        // 送り直しでは署名だけを出し直す（前の署名が切れていても写真を送れる）
        calls = [];
        mockSign.mockClear();
        const again = await call(sendFeedback, authed({ id: DRAFT, text: "a", photo: { contentType: "image/jpeg", size: 2048 } }));
        expect(bodyOf(again).upload.url).toBe("https://s3.example/signed");
        expect(calls.map((c) => c.cmd)).toEqual(["GetCommand"]);
    });

    it("失敗しても本文をログに出さない", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        mockSend.mockImplementation(async () => { throw Object.assign(new Error(SECRET), { name: "ProvisionedThroughputExceededException" }); });
        const r = await call(sendFeedback, authed({ text: SECRET }));
        expect(r.statusCode).toBe(500);
        expect(JSON.stringify(err.mock.calls)).not.toContain(SECRET);
        err.mockRestore();
    });
});

describe("ログインしていない人（POST /feedback）", () => {
    it("IP ごとに数える。IP そのものは保存せず、日付つきのハッシュだけを欄名に使う", async () => {
        const r = await call(sendFeedbackPublic, anon({ text: "a", wantsReply: true, platform: "web", screen: "web-footer" }));
        expect(r.statusCode).toBe(200);
        const u = update();
        expect(u.ExpressionAttributeNames["#w"]).toBe(`by_ip_${ipBucket("198.51.100.7", feedbackDayOf())}`);
        expect(u.ExpressionAttributeValues[":maxWho"]).toBe(FEEDBACK_DAILY_PER_IP);
        const item = put().Item;
        // 宛先が無いので返事は約束しない。送った人も持たない
        expect(item.wantsReply).toBe(false);
        // （undefined の欄は DocumentClient の removeUndefinedValues で落ちる）
        expect(item.uid).toBeUndefined();
        expect(JSON.stringify([item, u])).not.toContain("198.51.100.7");
    });

    it("IP のハッシュは日が変わると別の値（日をまたいで同じ人を追えない）", () => {
        expect(ipBucket("198.51.100.7", "2026-11-11")).not.toBe(ipBucket("198.51.100.7", "2026-11-12"));
        expect(ipBucket("198.51.100.7", "2026-11-11")).toMatch(/^[0-9a-f]{16}$/);
    });

    it("ログインした人の送った id を、ログインしていない人は送り直せない", async () => {
        rows[`feedback#${DRAFT}`] = { id: `feedback#${DRAFT}`, uid: ME };
        const r = await call(sendFeedbackPublic, anon({ id: DRAFT, text: "a" }));
        expect(r.statusCode).toBe(409);
    });

    it("上限なら 429", async () => {
        ccfOn = (c) => c.cmd === "UpdateCommand";
        const r = await call(sendFeedbackPublic, anon({ text: "a" }));
        expect(r.statusCode).toBe(429);
    });
});

describe("日の区切りは JST の0時", () => {
    it("UTC 14:59 と 15:00 で日付が変わる", () => {
        expect(feedbackDayOf(Date.parse("2026-11-11T14:59:59Z"))).toBe("2026-11-11");
        expect(feedbackDayOf(Date.parse("2026-11-11T15:00:00Z"))).toBe("2026-11-12");
    });
});
