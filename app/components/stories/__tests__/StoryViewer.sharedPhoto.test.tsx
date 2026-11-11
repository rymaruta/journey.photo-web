import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

/**
 * **写真を紹介したストーリーの「写真を見る」**（2026-11-11・journey.photo-ios#541 の ①）。
 * `sharedPhotoId` を持つ行だけに出し、写真の頁へ送る。持たない行（ふつうのストーリー・
 * サーバーが写真の見られなくなった行から欄を落とした本人の行）には出さない。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(async () => ({ ok: true, json: async () => ({ followers: 0, following: 0 }) })),
    readApiError: async (_res: unknown, fallback: string) => fallback,
    sessionErrorMessage: () => null,
}));

import StoryViewer from "../StoryViewer";

const groups = (sharedPhotoId?: string): StoryGroup[] => [{
    userId: "friend",
    displayName: "友人",
    items: [{
        id: "s1", src: "https://cdn/x/card.jpg", userId: "friend",
        createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
        ...(sharedPhotoId ? { sharedPhotoId } : {}),
    }],
}];

const view = (sharedPhotoId?: string, onClose: () => void = () => { /* noop */ }) => {
    const r = render(
        <StoryViewer
            groups={groups(sharedPhotoId)}
            initialGroupIndex={0}
            locale="ja"
            isAuthenticated
            ownUserId="me"
            onSeen={() => { /* noop */ }}
            onClose={onClose}
        />,
    );
    const el = document.querySelector("img.story-media-in, video.story-media-in");
    if (el) fireEvent.load(el);
    return r;
};

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("StoryViewer: 紹介した写真", () => {
    it("写真の id を持つストーリーには「写真を見る」を出し、写真の頁へ送る", () => {
        view("photo-abc");
        const link = screen.getByRole("link", { name: /写真を見る/ });
        // 静的に建っていない写真はホームの `?photo=` に落ちる（`ROUTES.PHOTO`）
        expect(link.getAttribute("href")).toMatch(/photo(\/|=)photo-abc$/);
    });

    it("押したらストーリーを閉じる（同じ頁の `?photo=` で上に残さない）", () => {
        const onClose = vi.fn();
        view("photo-abc", onClose);
        fireEvent.click(screen.getByRole("link", { name: /写真を見る/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it("ふつうのストーリーには出さない", () => {
        view(undefined);
        expect(screen.queryByRole("link", { name: /写真を見る/ })).toBeNull();
    });
});
