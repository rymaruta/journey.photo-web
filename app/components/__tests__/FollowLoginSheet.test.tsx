import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// 札 journey.photo-ios#664（2026-11-20 判断）: 未ログインの人がフォローを押したら、
// 小さなトーストではなく案内の板を出す。ログインから戻ったら1回だけフォローする。
// 外から付けた URL の印だけではフォローしない。

const mockUserFetch = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", async (orig) => ({
    ...(await orig<typeof import("../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../UserAvatar", () => ({ default: () => <div data-testid="avatar" /> }));

const { FollowAction } = await import("../FollowButton");
const { resetFollowingCache } = await import("../../../lib/hooks/useFollow");
const { FOLLOW_AFTER_LOGIN_PARAM } = await import("../../../lib/utils/followAfterLogin");

const T = "22222222-2222-4222-8222-222222222222";
const KEY = "jp.followAfterLogin";

let followingIds: string[] = [];
/** 送った操作（フォロー＝POST、外す＝DELETE）。もうフォロー中の人に押し直すと外れてしまうので、両方数える */
const postCalls = () => mockUserFetch.mock.calls.filter(([, init]) => {
    const m = (init as RequestInit | undefined)?.method;
    return m === "POST" || m === "DELETE";
});

beforeEach(() => {
    followingIds = [];
    mockUserFetch.mockReset();
    mockUserFetch.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path === "/user/following") return { ok: true, json: async () => ({ userIds: followingIds }) };
        if (init?.method === "POST") return { ok: true, json: async () => ({ followers: 1 }) };
        return { ok: true, json: async () => ({}) };
    });
    showToast.mockReset();
    resetFollowingCache();
    sessionStorage.clear();
    window.history.replaceState(null, "", `/users/${T}`);
});
afterEach(() => {
    sessionStorage.clear();
});

const view = (props: Partial<React.ComponentProps<typeof FollowAction>> = {}) =>
    render(
        <FollowAction
            targetUserId={T}
            isOwner={false}
            isAuthenticated={false}
            locale="ja"
            targetName="旅人A"
            targetHandle="tabibito_a"
            {...props}
        />,
    );

describe("未ログインでフォローを押したときの案内の板", () => {
    it("トーストではなく板（dialog）を出し、誰を・何をするかを見せる", async () => {
        view();
        const btn = await screen.findByRole("button", { name: "フォローする" });
        await waitFor(() => expect(btn).not.toBeDisabled());
        expect(btn).toHaveAttribute("aria-haspopup", "dialog");
        fireEvent.click(btn);

        const dialog = await screen.findByRole("dialog", { name: "旅人Aさんをフォローするにはログイン" });
        expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(screen.getByText("@tabibito_a")).toBeInTheDocument();
        expect(screen.getByTestId("avatar")).toBeInTheDocument();
        // 小さなトーストは出さない（以前の形）
        expect(showToast).not.toHaveBeenCalled();

        const primary = screen.getByRole("link", { name: "ログインしてフォロー" });
        const signup = screen.getByRole("link", { name: "新しく登録" });
        expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
        // 戻り先に今の頁と合言葉を載せる（登録の頁もログインの頁へ同じ next を運ぶ）
        await waitFor(() => expect(primary.getAttribute("href")).toContain(encodeURIComponent(`/users/${T}?${FOLLOW_AFTER_LOGIN_PARAM}=`)));
        expect(primary.getAttribute("href")!.startsWith("/login?next=")).toBe(true);
        expect(signup.getAttribute("href")!.startsWith("/signup?next=")).toBe(true);
        // 開いたら主の操作にフォーカス
        await waitFor(() => expect(document.activeElement).toBe(primary));
    });

    it("名前が無くても板は出る（見出しは「フォローするにはログイン」）", async () => {
        view({ targetName: undefined, targetHandle: undefined });
        const btn = await screen.findByRole("button", { name: "フォローする" });
        await waitFor(() => expect(btn).not.toBeDisabled());
        fireEvent.click(btn);
        expect(await screen.findByRole("dialog", { name: "フォローするにはログイン" })).toBeInTheDocument();
    });

    it.each([
        ["閉じる", () => fireEvent.click(screen.getByRole("button", { name: "閉じる" }))],
        ["背景", () => fireEvent.click(screen.getByTestId("follow-login-backdrop"))],
        ["Esc", () => fireEvent.keyDown(document, { key: "Escape" })],
    ])("%s で閉じ、印は残さない（勝手にフォローしない）", async (_label, doClose) => {
        view();
        const btn = await screen.findByRole("button", { name: "フォローする" });
        await waitFor(() => expect(btn).not.toBeDisabled());
        fireEvent.click(btn);
        await screen.findByRole("dialog");
        doClose();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it("「ログインしてフォロー」を押した瞬間に、このタブへ印を書く", async () => {
        view();
        const btn = await screen.findByRole("button", { name: "フォローする" });
        await waitFor(() => expect(btn).not.toBeDisabled());
        fireEvent.click(btn);
        const primary = await screen.findByRole("link", { name: "ログインしてフォロー" });
        await waitFor(() => expect(primary.getAttribute("href")).toContain(FOLLOW_AFTER_LOGIN_PARAM));
        expect(sessionStorage.getItem(KEY)).toBeNull();     // 開いただけでは書かない
        fireEvent.click(primary);
        const mark = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
        expect(mark?.t).toBe(T);
        // URL に載せた合言葉と同じ
        expect(decodeURIComponent(primary.getAttribute("href")!)).toContain(`${FOLLOW_AFTER_LOGIN_PARAM}=${mark.n}`);
    });
});

describe("ログインから戻ったら1回だけフォローする", () => {
    const arrive = (nonce: string, mark?: { t: string; n: string; at?: number }) => {
        window.history.replaceState(null, "", `/users/${T}?${FOLLOW_AFTER_LOGIN_PARAM}=${nonce}`);
        if (mark) sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ...mark }));
    };

    it("印がそろっていればフォローし「フォローしました」。印と URL の合言葉は消える", async () => {
        arrive("abc123", { t: T, n: "abc123" });
        const { rerender } = view({ isAuthenticated: true });
        await waitFor(() => expect(postCalls()).toHaveLength(1));
        expect(postCalls()[0][0]).toBe(`/users/${T}/follow`);
        await waitFor(() => expect(showToast).toHaveBeenCalledWith("フォローしました", "success"));
        expect(sessionStorage.getItem(KEY)).toBeNull();
        expect(window.location.search).not.toContain(FOLLOW_AFTER_LOGIN_PARAM);
        // もう一度描いても2回目は無い
        rerender(<FollowAction targetUserId={T} isOwner={false} isAuthenticated locale="ja" />);
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(postCalls()).toHaveLength(1);
    });

    it("未ログイン → ログイン済みに変わった描画でも、フォロー中かを確かめてから送る（もうフォロー中なら送らない）", async () => {
        followingIds = [T];
        arrive("n1", { t: T, n: "n1" });
        const { rerender } = view({ isAuthenticated: false });
        await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
        rerender(<FollowAction targetUserId={T} isOwner={false} isAuthenticated locale="ja" />);
        await screen.findByRole("button", { name: "フォロー中" });
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(postCalls()).toHaveLength(0);
        expect(showToast).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it("未ログイン → ログイン済みに変わったら、まだならフォローする", async () => {
        arrive("n2", { t: T, n: "n2" });
        const { rerender } = view({ isAuthenticated: false });
        await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
        expect(postCalls()).toHaveLength(0);
        rerender(<FollowAction targetUserId={T} isOwner={false} isAuthenticated locale="ja" />);
        await waitFor(() => expect(postCalls()).toHaveLength(1));
    });

    it.each([
        ["このタブに印が無い（外から付けた URL だけ）", undefined],
        ["合言葉が違う", { t: T, n: "other" }],
        ["別の相手の印", { t: "33333333-3333-4333-8333-333333333333", n: "evil" }],
        ["古い印（30分より前）", { t: T, n: "evil", at: Date.now() - 31 * 60 * 1000 }],
    ])("%s ではフォローしない", async (_label, mark) => {
        arrive("evil", mark);
        view({ isAuthenticated: true });
        await screen.findByRole("button", { name: "フォローする" });
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(postCalls()).toHaveLength(0);
        // 外から来た合言葉は URL から外す
        expect(window.location.search).not.toContain(FOLLOW_AFTER_LOGIN_PARAM);
    });

    it("自分の頁なら何もしない（印だけ消す）", async () => {
        arrive("me", { t: T, n: "me" });
        view({ isAuthenticated: true, isOwner: true });
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(postCalls()).toHaveLength(0);
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it("途中でやめて（URL に合言葉が無いまま）戻ったら、印を消す", async () => {
        sessionStorage.setItem(KEY, JSON.stringify({ t: T, n: "x", at: Date.now() }));
        view({ isAuthenticated: false });
        await screen.findByRole("button", { name: "フォローする" });
        await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull());
    });

    it("同じ相手のボタンが2つあっても、送るのは1回", async () => {
        arrive("twin", { t: T, n: "twin" });
        render(
            <>
                <FollowAction targetUserId={T} isOwner={false} isAuthenticated locale="ja" />
                <FollowAction targetUserId={T} isOwner={false} isAuthenticated locale="ja" variant="outline" />
            </>,
        );
        await waitFor(() => expect(postCalls()).toHaveLength(1));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(postCalls()).toHaveLength(1);
    });
});

describe("ほかのフォローのボタン（写真の詳細など）も同じ板", () => {
    it.each(["outline", "list"] as const)("variant=%s", async (variant) => {
        view({ variant });
        const btn = await screen.findByRole("button", { name: variant === "outline" ? "フォロー" : "フォローする" });
        await waitFor(() => expect(btn).not.toBeDisabled());
        fireEvent.click(btn);
        expect(await screen.findByRole("dialog", { name: "旅人Aさんをフォローするにはログイン" })).toBeInTheDocument();
        expect(showToast).not.toHaveBeenCalled();
    });
});
