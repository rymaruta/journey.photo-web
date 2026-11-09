import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `storymention` は**一覧には積むが、端末へは送らない**（`notify.ts` の `PUSH_READY_TYPES`）。
 * 古いアプリが鍵 `NOTIF_STORY_MENTION` の文字をそのまま通知に出すため。
 *
 * ⚠️ `storyAudience.test.ts` は `pushNotification` ごとモックしているので、
 * `deliverPush` の門はそこでは通らない。**ここは本物の `pushNotification` を通し、
 * APNs の設定が「ある」状態**（`apnsConfigured` が真・端末あり）で見る。
 * 比較として `storyreply` は送られることも見て、空振り（設定が偽で何も送らない）を防ぐ。
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: async () => false,
    hiddenUserIds: async () => new Set<string>(),
}));
const mockSend = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ sent: 1, invalid: [] as string[] })));
vi.mock("../apns", () => ({ apnsConfigured: () => true, sendPush: (...a: unknown[]) => mockSend(...a) }));
vi.mock("../devices", () => ({ deviceTokens: async () => ["a".repeat(64)], forgetTokens: async () => undefined }));
vi.stubEnv("USERS_TABLE", "users-test");

const { pushNotification } = await import("../notify");

beforeEach(() => {
    mockDdbSend.mockReset();
    mockSend.mockClear();
    mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string } }) =>
        cmd.constructor.name === "UpdateCommand" ? { Attributes: { unread: 1, items: [] } } : {});
});

const base = { byId: "bbbbbbbb-0000-4000-8000-000000000002", byName: "だれか", photoId: "story-1", photoSrc: "", t: "2026-11-09T00:00:00Z" };

describe("端末への送信", () => {
    it("storyreply は送る（設定ありの世界で空振りしていないことの確認）", async () => {
        await pushNotification("aaaaaaaa-0000-4000-8000-000000000001", { ...base, type: "storyreply" });
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("storymention は一覧には積むが、端末へは送らない", async () => {
        await pushNotification("aaaaaaaa-0000-4000-8000-000000000001", { ...base, type: "storymention" });
        expect(mockDdbSend.mock.calls.some((c) => c[0].constructor.name === "UpdateCommand"), "一覧に積んでいない").toBe(true);
        expect(mockSend).not.toHaveBeenCalled();
    });
});
