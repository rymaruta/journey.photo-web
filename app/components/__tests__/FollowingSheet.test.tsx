import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
// **フォロワー側は出せない**——いまのデータは `following#<uid>` と
// 数（`followstats#`）だけで、「誰にフォローされているか」を引ける行が無い。
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

// 行ごとの札は `FollowAction`（人のページ・お知らせと同じ部品）。ここでは渡した値だけ見る
const mockAuth = vi.hoisted(() => ({ userId: "me-1" as string | null, isAuthenticated: true }));
vi.mock("../../auth/context", () => ({ useAuth: () => mockAuth }));
vi.mock("../FollowButton", () => ({
    default: () => null,
    FollowAction: (p: { targetUserId: string; isOwner: boolean; variant?: string }) =>
        p.isOwner ? null : <button type="button" data-testid={`follow-${p.targetUserId}`} data-variant={p.variant}>フォロー札</button>,
}));

import FollowingSheet from "../FollowingSheet";

const UID = "11111111-1111-4111-8111-111111111111";
const onClose = vi.fn();
const view = (kind: "following" | "followers" = "following") =>
    render(<FollowingSheet userId={UID} kind={kind} locale="ja" onClose={onClose} />);

const listOk = (users: unknown, total?: number) => mockUserFetch.mockResolvedValue({
    ok: true, json: async () => ({ users, total: total ?? (Array.isArray(users) ? users.length : 0) }),
});

beforeEach(() => { mockUserFetch.mockReset(); onClose.mockReset(); });

describe("フォロー中の一覧", () => {
    it("その人の一覧を引いて、名前とプロフィールへのリンクを出す", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        expect(await screen.findByText("旅人B")).toBeInTheDocument();
        expect(mockUserFetch.mock.calls[0][0]).toBe(`/users/${UID}/following`);
        expect(screen.getByRole("link", { name: /旅人B/ })).toHaveAttribute("href", expect.stringContaining("u2"));
    });

    // **「まだ来ていない」を「0人」と言わない**（台帳 0d）
    it("読み込み中は「まだ誰もフォローしていません」と言わない", async () => {
        mockUserFetch.mockImplementation(() => new Promise(() => { /* 返らない */ }));
        view();
        // 灰の骨格（読み上げは「読み込み中」1つ）
        expect(await screen.findByRole("status")).toHaveTextContent("読み込み中");
        expect(screen.queryByText("まだいません")).toBeNull();
    });

    it("取得に失敗したら、そう言う（0人と混ぜない）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        view();
        expect(await screen.findByText("一覧を読み込めませんでした")).toBeInTheDocument();
        expect(screen.queryByText("まだいません")).toBeNull();
    });

    it("本当に0人なら、そう出す", async () => {
        listOk([]);
        view();
        expect(await screen.findByText("まだいません")).toBeInTheDocument();
    });

    // サーバーは50人までしか返さない（1回で2000回の GetItem は撃てない）。
    // **足りないことを黙らない**
    it("全部出せていないときは、その旨を出す", async () => {
        listOk([{ id: "u2", name: "旅人B" }], 60);
        view();
        expect(await screen.findByText("全 60 人のうち 1 人を表示しています")).toBeInTheDocument();
    });

    // **2つを同時に出さない。** 一覧が空のときは「一覧はまだ用意
    // できていません」だけ——「5人のうち、はじめの0人」を並べると、
    // 同じことを2通りに言うことになる
    it("一覧が空のときは、件数の一文を重ねて出さない", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [], total: 5 }) });
        view();
        await screen.findByText(/一覧はまだ用意できていません/);
        expect(screen.queryByText(/人を表示しています/), "同じことを2通りに言っている").toBeNull();
    });

    it("全部出せているときは、その一文を出さない", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        await screen.findByText("旅人B");
        expect(screen.queryByText(/人を表示しています/)).toBeNull();
    });

    // 1件壊れていても画面ごと落とさない
    it("形の壊れた行が混ざっても、残りは出す", async () => {
        listOk([null, { name: "IDが無い" }, { id: "u3" }, "文字列"], 4);
        view();
        expect(await screen.findByText("旅人")).toBeInTheDocument();
        expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    it("Escape と閉じるボタンで閉じる", async () => {
        listOk([]);
        view();
        await userEvent.click(await screen.findByLabelText("閉じる"));
        expect(onClose).toHaveBeenCalled();
        onClose.mockReset();
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    // **`document` で聞かないと、パネルの文字をタップした時点で効かなくなる。**
    // React の合成イベントはフォーカスがパネルの中にあるときしか届かない
    it("フォーカスが外れていても Escape で閉じる", async () => {
        listOk([]);
        view();
        await screen.findByText("まだいません");
        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    // 退会した人は開いても空のページ。退会が消すのは本人の `following#`
    // だけなので、他人の一覧には残り続ける
    it("退会した人はリンクにしない", async () => {
        listOk([{ id: "gone", deleted: true }, { id: "u2", name: "旅人B" }]);
        view();
        expect(await screen.findByText("退会したユーザー")).toBeInTheDocument();
        expect(screen.getAllByRole("link"), "空のページへ飛ばしている").toHaveLength(1);
        expect(screen.queryByText("旅人"), "「旅人」という普通の行として出している").toBeNull();
    });

    // **配列でなければ「取れなかった」**。`[]` に潰すと「0人」と混ざる
    it("users が配列でなければ、0人ではなく失敗として出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ users: { broken: true }, total: 5 }) });
        view();
        expect(await screen.findByText("一覧を読み込めませんでした")).toBeInTheDocument();
        expect(screen.queryByText("まだいません")).toBeNull();
        expect(screen.queryByText(/人を表示しています/), "0人と件数を同時に出している").toBeNull();
    });
});

// **モーダルとしての作法**。他のモーダルには専用のテストがあるのに
// （`GalleryModalFocus` / `StoryFocus` / `StoriesBar.focus`）、ここだけ
// 無かった——`useFocusTrap` も `lockBodyScroll` も背景クリックも、
// 消して全件緑になる状態だった（変異で実測）
describe("フォロー中の一覧: モーダルとしての作法", () => {
    it("開いたら中にフォーカスを移す（外へ漏らさない）", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        const panel = await screen.findByRole("dialog");
        await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    });

    it("開いている間は背景をスクロールさせない", async () => {
        listOk([]);
        const { unmount } = view();
        await screen.findByRole("dialog");
        expect(document.body.style.position, "背景が一緒に動く").toBe("fixed");
        unmount();
        expect(document.body.style.position, "閉じても固まったまま").toBe("");
    });

    it("背景を押したら閉じる", async () => {
        listOk([]);
        view();
        await screen.findByRole("dialog");
        await userEvent.click(document.querySelector(".fixed.inset-0") as HTMLElement);
        expect(onClose).toHaveBeenCalled();
    });

    it("中を押しても閉じない", async () => {
        listOk([]);
        view();
        await userEvent.click(await screen.findByRole("dialog"));
        expect(onClose, "中を触っただけで閉じる").not.toHaveBeenCalled();
    });

    it("名前を押したら閉じる（開いたまま裏で遷移させない）", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view();
        await userEvent.click(await screen.findByText("旅人B"));
        expect(onClose).toHaveBeenCalled();
    });
});

// **1つの部品で両方出す。** 違うのは口と見出しだけで、倒し方は同じ。
// 分けて書くと静かにずれる
describe("フォロワーの一覧（同じ部品）", () => {
    it("フォロワー側の口を叩き、見出しも変える", async () => {
        listOk([{ id: "u2", name: "旅人B" }]);
        view("followers");
        await screen.findByText("旅人B");
        expect(mockUserFetch.mock.calls[0][0]).toBe(`/users/${UID}/followers`);
        expect(screen.getByRole("dialog", { name: "フォロワー" })).toBeInTheDocument();
    });

    it("0人のときの文言もフォロワー向けにする", async () => {
        listOk([]);
        view("followers");
        expect(await screen.findByText("まだいません")).toBeInTheDocument();
    });

    // **「0人」と「まだ揃っていない」を分ける。** 埋め戻しを流すまで
    // （あるいは1件だけ書けなかったとき）、数は正しいのに一覧は空。
    // 分けないと「5 フォロワー」と言いながら開くと
    // 「まだフォロワーはいません」になる
    it("数はあるのに一覧が空なら、0人と言わない", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [], total: 5 }) });
        view("followers");
        expect(await screen.findByText(/一覧はまだ用意できていません/)).toBeInTheDocument();
        expect(screen.queryByText("まだいません"), "数と食い違うことを言っている").toBeNull();
    });
});


// 2026-11-04（札 #478・iOS `FollowListView`）: 切り替える札と、行ごとのフォローの札
describe("フォロワー／フォロー中の札と、行ごとの札", () => {
    /** 口ごとに別の答えを返す */
    const byKind = (followers: unknown[], following: unknown[], totals: { followers?: number; following?: number } = {}) =>
        mockUserFetch.mockImplementation(async (path: string) => {
            const isFollowers = String(path).endsWith("/followers");
            const users = isFollowers ? followers : following;
            return { ok: true, json: async () => ({ users, total: (isFollowers ? totals.followers : totals.following) ?? users.length }) };
        });

    it("札は「フォロワー → フォロー中」の順で、数が付く。開いた側が選ばれている", async () => {
        byKind([{ id: "a", name: "A" }, { id: "b", name: "B" }], [{ id: "c", name: "C" }]);
        view("following");
        const tabs = await screen.findAllByRole("tab");
        await waitFor(() => expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["フォロワー2", "フォロー中1"]));
        expect(tabs[1]).toHaveAttribute("aria-selected", "true");
        expect(await screen.findByText("C")).toBeInTheDocument();
    });

    it("両方を一度に読む（開いた側が先）", async () => {
        byKind([], []);
        view("followers");
        await screen.findAllByRole("tab");
        expect(mockUserFetch.mock.calls.map((c) => c[0])).toEqual([`/users/${UID}/followers`, `/users/${UID}/following`]);
    });

    it("札を押すと、もう一方の一覧に切り替わる（読み直さない）", async () => {
        byKind([{ id: "a", name: "A" }], [{ id: "c", name: "C" }]);
        view("following");
        await screen.findByText("C");
        const calls = mockUserFetch.mock.calls.length;
        await userEvent.click(screen.getByRole("tab", { name: /フォロワー/ }));
        expect(await screen.findByText("A")).toBeInTheDocument();
        expect(screen.queryByText("C")).toBeNull();
        expect(screen.getByRole("dialog", { name: "フォロワー" })).toBeInTheDocument();
        expect(mockUserFetch.mock.calls.length).toBe(calls);
    });

    it("矢印キーで札を移れる", async () => {
        byKind([{ id: "a", name: "A" }], [{ id: "c", name: "C" }]);
        view("following");
        await screen.findByText("C");
        screen.getByRole("tab", { name: /フォロー中/ }).focus();
        await userEvent.keyboard("{ArrowLeft}");
        expect(await screen.findByText("A")).toBeInTheDocument();
    });

    it("行ごとにフォローの札を出す（variant=list）。自分の行と退会した人には出さない", async () => {
        byKind([], [{ id: "me-1", name: "わたし" }, { id: "u2", name: "旅人B" }, { id: "gone", deleted: true }]);
        view("following");
        await screen.findByText("旅人B");
        expect(screen.getByTestId("follow-u2")).toHaveAttribute("data-variant", "list");
        expect(screen.queryByTestId("follow-me-1")).toBeNull();
        expect(screen.queryByTestId("follow-gone")).toBeNull();
    });

    it("@ユーザー名があれば名前の下に出す", async () => {
        byKind([], [{ id: "u2", name: "旅人B", username: "tabibito_b" }]);
        view("following");
        expect(await screen.findByText("@tabibito_b")).toBeInTheDocument();
    });

    it("片方だけ失敗しても、もう一方は出る。失敗した側には「もう一度」を置く", async () => {
        mockUserFetch.mockImplementation(async (path: string) =>
            String(path).endsWith("/followers")
                ? { ok: false, status: 500, json: async () => ({}) }
                : { ok: true, json: async () => ({ users: [{ id: "c", name: "C" }], total: 1 }) });
        view("following");
        expect(await screen.findByText("C")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("tab", { name: /フォロワー/ }));
        expect(await screen.findByText("一覧を読み込めませんでした")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "もう一度試す" })).toBeInTheDocument();
    });
});
