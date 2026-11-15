import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * コメントへの返信（`commentreply`）とメンション（`storymention`）を端末へ送る（2026-11-15 札 #618）。
 *
 * **鍵を持つと名乗ったアプリの端末（段 2・`devices.ts` の `PUSH_KEYS_LATEST`）にだけ送る。**
 * App Store の 1.0.87 は鍵 `NOTIF_COMMENT_REPLY`・`NOTIF_STORY_MENTION` を持たず、鍵の文字列を
 * そのまま通知に出すため。ここは本物の `pushNotification` を通し、APNs の設定が「ある」状態で見る。
 * 端末の模型は「段 1 の端末（古いアプリ）」と「段 2 の端末（新しいアプリ）」を1台ずつ持つ。
 */
const OLD_APP = "a".repeat(64);
const NEW_APP = "b".repeat(64);
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: async () => false,
    hiddenUserIds: async () => new Set<string>(),
}));
const mockSend = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ sent: 1, invalid: [] as string[] })));
vi.mock("../apns", () => ({ apnsConfigured: () => true, sendPush: (...a: unknown[]) => mockSend(...a) }));
const devices = vi.hoisted(() => ({ tokens: [] as string[] }));
vi.mock("../devices", () => ({
    deviceTokens: async (_uid: string, _consistent?: boolean, minPushKeys = 1) =>
        devices.tokens.filter((t) => minPushKeys < 2 || t === "b".repeat(64)),
    forgetTokens: async () => undefined,
}));
vi.stubEnv("USERS_TABLE", "users-test");

const { pushNotification } = await import("../notify");

beforeEach(() => {
    mockDdbSend.mockReset();
    mockSend.mockClear();
    devices.tokens = [OLD_APP, NEW_APP];
    mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string } }) =>
        cmd.constructor.name === "UpdateCommand" ? { Attributes: { unread: 1, items: [] } } : {});
});

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const base = { byId: "bbbbbbbb-0000-4000-8000-000000000002", byName: "だれか", photoId: "story-1", photoSrc: "", t: "2026-11-09T00:00:00Z" };
const sentTo = () => mockSend.mock.calls.map((c) => c[0] as string[]);
const payload = (i = 0) => mockSend.mock.calls[i][1] as { locKey: string; data: Record<string, string> };
const stacked = () => mockDdbSend.mock.calls.some((c) => c[0].constructor.name === "UpdateCommand");

describe("端末への送信", () => {
    it("storyreply は古いアプリにも送る（今までどおり・空振りしていないことの確認）", async () => {
        await pushNotification(ME, { ...base, type: "storyreply" });
        expect(sentTo()).toEqual([[OLD_APP, NEW_APP]]);
    });

    it("storymention は鍵を持つアプリの端末にだけ、1通送る（古いアプリには送らない）", async () => {
        await pushNotification(ME, { ...base, type: "storymention" });
        expect(stacked(), "一覧に積んでいない").toBe(true);
        expect(sentTo()).toEqual([[NEW_APP]]);
        expect(payload().locKey).toBe("NOTIF_STORY_MENTION");
        expect(payload().data).toMatchObject({ type: "storymention", photoId: "story-1" });
    });

    it("commentreply は鍵を持つアプリの端末にだけ、1通送る（押した先でそのコメントへ）", async () => {
        await pushNotification(ME, { ...base, type: "commentreply", photoId: "p1", commentId: "c-1" });
        expect(sentTo()).toEqual([[NEW_APP]]);
        expect(payload().locKey).toBe("NOTIF_COMMENT_REPLY");
        expect(payload().data).toMatchObject({ type: "commentreply", photoId: "p1", commentId: "c-1" });
    });

    it("古いアプリの端末しか無い人には送らない（一覧には積む）", async () => {
        devices.tokens = [OLD_APP];
        await pushNotification(ME, { ...base, type: "commentreply", photoId: "p1", commentId: "c-1" });
        await pushNotification(ME, { ...base, type: "storymention" });
        expect(stacked()).toBe(true);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("storyshare は送らない（作られなくなった種類・鍵の無いアプリに出さない）", async () => {
        await pushNotification(ME, { ...base, type: "storyshare", photoId: "p1" });
        expect(mockSend).not.toHaveBeenCalled();
    });
});
