import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

/**
 * ストーリーとそこから作った写真の関係（2026-11-11 判断・owner「関係を明確にして」）。
 *
 *   - 写真にしたストーリーには「写真にしました ›」の札（押すとその写真へ）
 *   - 消す確認は「写真も一緒に消す」「ストーリーだけ消す」の2つ（既定の選び方は無し）。
 *     写真のいいね・コメントがあれば数を添える
 *   - 写真にしていなければ今までどおり「削除」1つ
 */

const mockPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    authenticatedFetch: vi.fn(),
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    readApiError: async (_r: unknown, f: string) => f,
    sessionErrorMessage: () => null,
}));

import StoryViewer, { keptDeleteDescription } from "../StoryViewer";
import { storyDeletePaths, sourceStoryIdOf, isStoryShelved } from "@/lib/stories";

const own = (extra: Record<string, unknown> = {}): StoryGroup[] => [{
    userId: "me", displayName: "自分",
    items: [{ id: "s1", src: "https://cdn/x/a.jpg", userId: "me", createdAt: "2026-11-11T10:00:00Z", expiresAt: "2099-11-12T10:00:00Z", ...extra }],
}];
const view = (groups: StoryGroup[], onDelete = vi.fn().mockResolvedValue(true)) => {
    render(<StoryViewer groups={groups} initialGroupIndex={0} locale="ja" isAuthenticated ownUserId="me"
        onSeen={() => undefined} onClose={() => undefined} onDelete={onDelete} />);
    return onDelete;
};
const openDelete = async () => {
    fireEvent.click(screen.getByLabelText("ストーリーの操作"));
    fireEvent.click(await screen.findByRole("button", { name: "ストーリーを削除" }));
};

beforeEach(() => {
    mockPublicFetch.mockReset().mockResolvedValue({ ok: false, json: async () => ({}) });
});

describe("写真にしたストーリー: 関係の札", () => {
    it("「写真にしました ›」を出し、押すとその写真（編集の画面）へ", () => {
        view(own({ keptAs: "p-9" }));
        const link = screen.getByText("写真にしました").closest("a");
        expect(link?.getAttribute("href")).toBe("/user/edit?id=p-9");
    });

    it("写真にしていなければ札は出ない", () => {
        view(own());
        expect(screen.queryByText("写真にしました")).toBeNull();
    });
});

describe("写真にしたストーリー: 消す確認", () => {
    it("2つの選び方を出す（危険の色は写真も消える側）", async () => {
        view(own({ keptAs: "p-9" }));
        await openDelete();
        const both = await screen.findByRole("button", { name: "写真も一緒に消す" });
        const only = screen.getByRole("button", { name: "ストーリーだけ消す" });
        expect(both.className).toContain("danger");
        expect(only.className, "ストーリーだけ消す側を危険の色にしている").not.toContain("danger");
        expect(screen.queryByRole("button", { name: "削除" }), "1つだけの「削除」が残っている").toBeNull();
    });

    it("「写真も一緒に消す」は写真の id を渡す", async () => {
        const onDelete = view(own({ keptAs: "p-9" }));
        await openDelete();
        fireEvent.click(await screen.findByRole("button", { name: "写真も一緒に消す" }));
        await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1", "p-9"));
    });

    it("「ストーリーだけ消す」は写真の id を渡さない", async () => {
        const onDelete = view(own({ keptAs: "p-9" }));
        await openDelete();
        fireEvent.click(await screen.findByRole("button", { name: "ストーリーだけ消す" }));
        await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1"));
    });

    it("写真のいいね・コメントがあれば数を添える", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 3, commentCount: 2 }) });
        view(own({ keptAs: "p-9" }));
        await openDelete();
        expect(await screen.findByText(/いいね 3・コメント 2 も消えます/)).toBeTruthy();
    });

    it("写真にしていなければ今までどおり「削除」1つ", async () => {
        view(own());
        await openDelete();
        expect(await screen.findByRole("button", { name: "削除" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "写真も一緒に消す" })).toBeNull();
    });
});

describe("期限が切れた1本には「残す」を出さない（サーバーは期限切れを 404 で断る）", () => {
    it("棚から開いた（archivedAt）1本には出さない", () => {
        view(own({ archive: true, archivedAt: "2026-11-10T10:00:00Z", expiresAt: "2026-11-10T10:00:00Z" }));
        expect(screen.queryByLabelText("ギャラリーに残す"), "押すと必ず 404 になるボタンを出している").toBeNull();
    });

    it("期限の時刻を過ぎた1本にも出さない", () => {
        view(own({ expiresAt: "2020-01-01T00:00:00Z" }));
        expect(screen.queryByLabelText("ギャラリーに残す")).toBeNull();
    });

    it("期限が切れていても、写真にしてあれば札は出す", () => {
        view(own({ archivedAt: "2026-11-10T10:00:00Z", keptAs: "p-9" }));
        expect(screen.getByText("写真にしました")).toBeTruthy();
    });

    it("生きている1本には出す", () => {
        view(own());
        expect(screen.getByLabelText("ギャラリーに残す")).toBeTruthy();
    });

    it("判定: 棚の印・期限（同時刻は切れている）", () => {
        const now = Date.parse("2026-11-11T00:00:00Z");
        expect(isStoryShelved({ archivedAt: "x" }, now)).toBe(true);
        expect(isStoryShelved({ expiresAt: "2026-11-11T00:00:00Z" }, now)).toBe(true);
        expect(isStoryShelved({ expiresAt: "2026-11-12T00:00:00Z" }, now)).toBe(false);
        expect(isStoryShelved({}, now)).toBe(false);
    });
});

describe("消す口と関係の読み方", () => {
    // 写真がもう無い（404）と写真の口はストーリーに触らない。続けてストーリーの口も叩く（404 は消せた）
    it("一緒に消すときは写真の口（withStory=1）→ ストーリーの口、ストーリーだけはストーリーの口", () => {
        expect(storyDeletePaths("s1", "p-9")).toEqual(["/photos/p-9?withStory=1", "/stories/s1"]);
        expect(storyDeletePaths("s1")).toEqual(["/stories/s1"]);
    });

    it("写真の元のストーリーは keptFrom（共有）か fromStory（写し）", () => {
        expect(sourceStoryIdOf({ keptFrom: "s1" })).toBe("s1");
        expect(sourceStoryIdOf({ fromStory: "s2" })).toBe("s2");
        expect(sourceStoryIdOf({})).toBeNull();
    });

    it("数が無ければ数の文は付けない・「捨てる」と言わない", () => {
        expect(keptDeleteDescription("ja", null)).not.toContain("消えます");
        expect(keptDeleteDescription("ja", { likes: 1, comments: 0 })).toContain("いいね 1 も消えます");
        for (const c of [null, { likes: 2, comments: 5 }]) expect(keptDeleteDescription("ja", c)).not.toContain("捨");
    });
});
