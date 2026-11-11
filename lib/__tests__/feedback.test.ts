import { describe, it, expect, vi } from "vitest";
import { feedbackBody, screenFrom, sendFeedback } from "../feedback";

/** 意見箱の Web の送り手（札 #546）。口の選び方・返事の約束・写真の PUT・圏外の扱いを見る */

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("feedbackBody", () => {
    it("ログインしていない人は返事を約束しない", () => {
        expect(feedbackBody({ id: ID, text: " a ", screen: "web-footer", wantsReply: true, signedIn: false }).wantsReply).toBe(false);
        expect(feedbackBody({ id: ID, text: "a", screen: "web", wantsReply: true, signedIn: true }).wantsReply).toBe(true);
    });
    it("本文は前後の空白を落とし、写真は種別と大きさだけを送る", () => {
        const b = feedbackBody({ id: ID, text: "  いいね \n", screen: "web", wantsReply: false, signedIn: true, photo: { type: "image/jpeg", size: 12 } });
        expect(b).toEqual({ id: ID, text: "いいね", screen: "web", platform: "web", wantsReply: false, photo: { contentType: "image/jpeg", size: 12 } });
        expect(feedbackBody({ id: ID, text: "a", screen: "web", wantsReply: false, signedIn: false })).not.toHaveProperty("photo");
    });
    it("?from= は知っている値だけ", () => {
        expect(screenFrom("footer")).toBe("web-footer");
        expect(screenFrom("settings")).toBe("web-settings");
        expect(screenFrom("<x>")).toBe("web");
        expect(screenFrom(null)).toBe("web");
    });
});

describe("sendFeedback", () => {
    const body = feedbackBody({ id: ID, text: "a", screen: "web", wantsReply: false, signedIn: false });

    it("ログインの有無で口を分ける", async () => {
        const post = vi.fn(async () => json(200, { ok: true, id: ID }));
        await sendFeedback(body, null, { post, signedIn: false });
        await sendFeedback(body, null, { post, signedIn: true });
        expect(post.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(["/feedback", "/user/feedback"]);
    });

    it("届かなければ offline（書いたものを残す側）", async () => {
        const r = await sendFeedback(body, null, { post: async () => { throw new TypeError("Failed to fetch"); }, signedIn: false });
        expect(r).toEqual({ ok: false, offline: true });
    });

    it("断られたらサーバーの文を出す（上限など）", async () => {
        const r = await sendFeedback(body, null, { post: async () => json(429, { error: "今日はこれ以上送れません。明日また送ってください", code: "feedback_limit" }), signedIn: false });
        expect(r).toEqual({ ok: false, offline: false, message: "今日はこれ以上送れません。明日また送ってください" });
    });

    it("写真は応答の署名つき URL へ、署名した種別で PUT する", async () => {
        const put = vi.fn(async () => new Response(null, { status: 200 }));
        const photo = new Blob(["x"], { type: "image/jpeg" });
        const r = await sendFeedback(body, photo, {
            post: async () => json(200, { ok: true, id: ID, upload: { url: "https://s3.example/put", contentType: "image/jpeg" } }),
            put, signedIn: false,
        });
        expect(r).toEqual({ ok: true });
        const [url, init] = put.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://s3.example/put");
        expect(init.method).toBe("PUT");
        expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
        expect(init.body).toBe(photo);
    });

    it("写真だけ送れなかったら、ひとことは届いたと言う", async () => {
        const r = await sendFeedback(body, new Blob(["x"]), {
            post: async () => json(200, { ok: true, id: ID, upload: { url: "https://s3.example/put", contentType: "image/jpeg" } }),
            put: async () => new Response(null, { status: 403 }), signedIn: false,
        });
        expect(r).toEqual({ ok: false, offline: false, message: "ひとことは届きました。写真は送れませんでした", textDelivered: true });
    });
});
