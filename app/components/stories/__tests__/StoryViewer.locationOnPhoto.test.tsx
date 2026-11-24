import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StoryGroup } from "@/lib/stories";

// 撮影地の札を写真に焼き込んだ1本（アプリの場所ツール）は、固定の撮影地の札を出さない
// ——写真の上の札と2度出る。`songOnPhoto` と同じ形。印の無い1本は今までどおり出す

vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    publicFetch: vi.fn(),
    userPublicFetch: vi.fn(),
}));

import StoryViewer from "../StoryViewer";

beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true, writable: true, value: () => Promise.resolve(),
    });
});

const groups = (extra: Record<string, unknown>) => ([{
    userId: "me", displayName: "自分",
    items: [{
        id: "s1", src: "https://cdn/x/a.jpg", userId: "me", mediaType: "image",
        createdAt: "2026-07-04T10:00:00Z", expiresAt: "2099-07-05T10:00:00Z",
        location: "江ノ島",
        ...extra,
    }],
}] as unknown as StoryGroup[]);

const view = (extra: Record<string, unknown>) => render(
    <StoryViewer groups={groups(extra)} initialGroupIndex={0} locale="ja"
        ownUserId="me" isAuthenticated onSeen={vi.fn()} onClose={vi.fn()} />,
);

describe("撮影地の札を焼き込んだストーリー", () => {
    it("固定の撮影地の札を出さない", () => {
        view({ locationOnPhoto: true });
        expect(screen.queryByText("江ノ島"), "写真の上の札と2度出している").toBeNull();
    });

    it("印の無い1本（Web で出した撮影地）は今までどおり出す", () => {
        view({});
        expect(screen.getByText("江ノ島")).toBeInTheDocument();
    });

    it("印が true 以外（形の違う値）なら出す", () => {
        view({ locationOnPhoto: "true" });
        expect(screen.getByText("江ノ島")).toBeInTheDocument();
    });
});
