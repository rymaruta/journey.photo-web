import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { threadComments } from "../../../lib/utils/commentThreads";

// **コメントに返信**（2026-11-11・journey.photo-ios#541 の ②）。
// 「返信」→「〇〇さんに返信中」→ 送ると `replyTo` を付けて送り、返信は相手の下に1段下げて並ぶ

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockList = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/utils/api")>("../../../lib/utils/api");
    return {
        userFetch: (...a: unknown[]) => String(a[0]).startsWith("/user/comments/") ? mockList(...a) : mockUserFetch(...a),
        userPublicFetch: mockList,
        publicFetch: vi.fn(),
        authenticatedFetch: vi.fn(),
        readApiError: actual.readApiError,
        isGoneResponse: actual.isGoneResponse,
        isMissingRouteResponse: actual.isMissingRouteResponse,
        AUTH_REQUIRED_MESSAGE: actual.AUTH_REQUIRED_MESSAGE,
        NETWORK_UNREACHABLE_MESSAGE: actual.NETWORK_UNREACHABLE_MESSAGE,
    };
});
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../UserAvatar", () => ({ default: () => <div /> }));

import CommentSection from "../CommentSection";

const kenji = { id: "c1", uid: "kenji", name: "けんじ", text: "どこから撮りましたか？", t: "2026-11-11T00:00:00Z" };
const other = { id: "c2", uid: "sora", name: "そら", text: "きれい", t: "2026-11-11T02:00:00Z" };
const reply = { id: "c3", uid: "mika", name: "みか", text: "坂の上からです", t: "2026-11-11T03:00:00Z", replyTo: { id: "c1", uid: "kenji", name: "けんじ" } };

beforeEach(() => {
    mockUserFetch.mockReset();
    // 一覧は新しい順で届く
    mockList.mockReset().mockResolvedValue({ ok: true, json: async () => ({ items: [reply, other, kenji], count: 3 }) });
});

const shown = () => screen.getAllByRole("listitem").map((li) => [li.textContent?.includes("どこから") ? "c1" : li.textContent?.includes("坂の上") ? "c3" : "c2", li.getAttribute("data-reply") === "true"]);

describe("CommentSection: 返信", () => {
    it("返信は相手のコメントのすぐ下に1段下げて並び、相手の名前を出す", async () => {
        render(<CommentSection photoId="p1" locale="ja" />);
        await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
        expect(shown()).toEqual([["c2", false], ["c1", false], ["c3", true]]);
        expect(screen.getByRole("link", { name: "@けんじ" })).toBeTruthy();
    });

    it("「返信」→「〇〇さんに返信中」→ 送ると返信先を付けて送り、返信中を外す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ comment: { ...reply, id: "c9", uid: "me", name: "わたし" } }) });
        render(<CommentSection photoId="p1" locale="ja" />);
        await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
        fireEvent.click(screen.getByRole("button", { name: "けんじさんに返信" }));
        expect(screen.getByTestId("comment-replying").textContent).toContain("けんじさんに返信中");
        fireEvent.change(screen.getByPlaceholderText("コメントを追加…"), { target: { value: "坂の上からです" } });
        fireEvent.click(screen.getByRole("button", { name: "送信" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        const [path, init] = mockUserFetch.mock.calls[0] as [string, { body: string }];
        expect(path).toBe("/photos/p1/comments");
        expect(JSON.parse(init.body)).toEqual({ text: "坂の上からです", replyTo: "c1" });
        await waitFor(() => expect(screen.queryByTestId("comment-replying")).toBeNull());
    });

    it("× で返信をやめると、ふつうのコメントとして送る", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ comment: { ...other, id: "c9" } }) });
        render(<CommentSection photoId="p1" locale="ja" />);
        await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
        fireEvent.click(screen.getByRole("button", { name: "けんじさんに返信" }));
        fireEvent.click(screen.getByRole("button", { name: "返信をやめる" }));
        expect(screen.queryByTestId("comment-replying")).toBeNull();
        fireEvent.change(screen.getByPlaceholderText("コメントを追加…"), { target: { value: "すてき" } });
        fireEvent.click(screen.getByRole("button", { name: "送信" }));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(JSON.parse((mockUserFetch.mock.calls[0][1] as { body: string }).body)).toEqual({ text: "すてき" });
    });

    it("退会した相手の名前はリンクにしない", async () => {
        mockList.mockResolvedValue({ ok: true, json: async () => ({ items: [{ ...reply, replyTo: { id: "c1", uid: "kenji", name: "退会したユーザー", deleted: true } }], count: 1 }) });
        render(<CommentSection photoId="p1" locale="ja" />);
        await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
        expect(screen.queryByRole("link", { name: "@退会したユーザー" })).toBeNull();
        expect(screen.getByText("@退会したユーザー")).toBeTruthy();
    });
});

describe("threadComments", () => {
    const c = (id: string, replyTo?: string) => ({ id, ...(replyTo ? { replyTo: { id: replyTo } } : {}) });
    it("返信への返信も同じ親の下に古い順で並べる（段は1つ）", () => {
        // 新しい順: r2（r1 への返信）, b, r1（a への返信）, a
        const out = threadComments([c("r2", "r1"), c("b"), c("r1", "a"), c("a")]);
        expect(out.map((x) => [x.comment.id, x.isReply])).toEqual([["b", false], ["a", false], ["r1", true], ["r2", true]]);
    });
    it("相手が一覧に無い返信は、その場に下げずに残す", () => {
        expect(threadComments([c("r", "gone"), c("a")]).map((x) => [x.comment.id, x.isReply])).toEqual([["r", false], ["a", false]]);
    });
    it("輪になった返信でも止まる", () => {
        expect(threadComments([c("x", "y"), c("y", "x")])).toHaveLength(2);
    });
});

describe("CommentSection: 返信の知らせから来たら、そのコメントの位置へ（#comment-<id>）", () => {
    it("読み終えたらそのコメントへ送り、少しのあいだ印を付ける", async () => {
        const spy = vi.fn();
        const orig = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element, ...a: unknown[]) { spy(this.id, ...a); } as typeof orig;
        window.location.hash = "#comment-c3";
        try {
            render(<CommentSection photoId="p1" locale="ja" />);
            await waitFor(() => expect(spy).toHaveBeenCalled());
            expect(spy.mock.calls[0][0]).toBe("comment-c3");
            expect(document.getElementById("comment-c3")?.getAttribute("data-jumped")).toBe("true");
            expect(document.getElementById("comment-c1")?.getAttribute("data-jumped")).toBeNull();
        } finally {
            Element.prototype.scrollIntoView = orig;
            window.location.hash = "";
        }
    });

    it("もう無いコメントなら動かさない・印の無い URL では動かさない", async () => {
        const spy = vi.fn();
        const orig = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element) { spy(this.id); } as typeof orig;
        try {
            window.location.hash = "#comment-gone";
            const { unmount } = render(<CommentSection photoId="p1" locale="ja" />);
            await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
            unmount();
            window.location.hash = "";
            render(<CommentSection photoId="p1" locale="ja" />);
            await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
            expect(spy).not.toHaveBeenCalled();
        } finally {
            Element.prototype.scrollIntoView = orig;
            window.location.hash = "";
        }
    });
});
