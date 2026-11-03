import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const auth = vi.hoisted(() => ({ value: { isAuthenticated: true, userId: "me" as string | null } }));
const fetchStories = vi.hoisted(() => vi.fn());
vi.mock("../../../auth/context", () => ({ useAuth: () => auth.value }));
vi.mock("../../../../lib/utils/api", () => ({ userFetch: (...args: unknown[]) => fetchStories(...args) }));
vi.mock("../../UserAvatar", () => ({ default: ({ userId }: { userId: string }) => <span>{userId}</span> }));
vi.mock("../StoryViewer", () => ({ default: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>close viewer</button> }));

import StoryAuthorAvatar from "../StoryAuthorAvatar";

const story = {
    id: "s1", src: "https://example.com/photo.jpg", userId: "author",
    displayName: "旅人", createdAt: "2098-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
};

beforeEach(() => {
    auth.value = { isAuthenticated: true, userId: "me" };
    fetchStories.mockReset();
    fetchStories.mockResolvedValue({ ok: true, json: async () => [story] });
    localStorage.clear();
});

describe("iOS StoryAvatar parity: photo author", () => {
    it("ストーリーがある作者の顔からビューアを開き、閉じられる", async () => {
        render(<StoryAuthorAvatar userId="author" name="旅人" locale="ja" />);
        await waitFor(() => expect(screen.getByTestId("photo-author-story-ring")).toBeInTheDocument());
        expect(fetchStories).toHaveBeenCalledWith("/stories");
        fireEvent.click(screen.getByTestId("photo-author-story-ring"));
        expect(await screen.findByText("close viewer")).toBeInTheDocument();
        fireEvent.click(screen.getByText("close viewer"));
        expect(screen.queryByText("close viewer")).not.toBeInTheDocument();
    });

    it("ストーリーがない人はプロフィールリンクのまま", async () => {
        fetchStories.mockResolvedValue({ ok: true, json: async () => [] });
        render(<StoryAuthorAvatar userId="author" name="旅人" locale="ja" />);
        await waitFor(() => expect(fetchStories).toHaveBeenCalled());
        expect(screen.queryByTestId("photo-author-story-ring")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "旅人 のプロフィール" })).toBeInTheDocument();
    });

    it("撮影者を切り替えた直後に以前の撮影者のリングを表示しない", async () => {
        const { rerender } = render(<StoryAuthorAvatar userId="author" name="旅人" locale="ja" />);
        await waitFor(() => expect(screen.getByTestId("photo-author-story-ring")).toBeInTheDocument());
        let resolveOther: ((response: { ok: boolean; json: () => Promise<unknown[]> }) => void) | undefined;
        fetchStories.mockImplementationOnce(() => new Promise(resolve => { resolveOther = resolve; }));
        rerender(<StoryAuthorAvatar userId="another" name="別の旅人" locale="ja" />);
        expect(screen.queryByTestId("photo-author-story-ring")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "別の旅人 のプロフィール" })).toBeInTheDocument();
        resolveOther?.({ ok: true, json: async () => [] });
    });

    it("未ログイン時はストーリーを取得せずプロフィールへ誘導", () => {
        auth.value = { isAuthenticated: false, userId: null };
        render(<StoryAuthorAvatar userId="author" name="旅人" locale="ja" />);
        expect(fetchStories).not.toHaveBeenCalled();
        expect(screen.getByRole("link", { name: "旅人 のプロフィール" })).toBeInTheDocument();
    });
});
