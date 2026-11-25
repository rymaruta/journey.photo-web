// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * **利用者が書いたリンクには `rel="ugc nofollow"`**（2026-11-25・SEO の観点 M10）。
 *
 * プロフィールの「Web サイト」と、マイBGM の曲の頁へのリンクは、利用者が自分で入れた行き先。
 * Google の「外部リンクに適切な属性を付ける」の決まりどおり、運営が確かめていないリンクに
 * このサイトの評価を渡さない。以前は `noopener noreferrer` だけだった
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../data/photos.json", () => ({ default: [] }));

const USER = "44444444-4444-4444-8444-444444444444";

import UserProfileClient from "../UserProfileClient";

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: USER, displayName: "旅人", website: "https://example.com/me" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

describe("プロフィールの Web サイトのリンク", () => {
    it("🔴 rel に ugc と nofollow が付く（新しいタブなので noopener noreferrer も）", async () => {
        render(<UserProfileClient userId={USER} />);
        const link = (await screen.findByText("example.com/me")).closest("a")!;
        expect(link.getAttribute("href")).toBe("https://example.com/me");
        const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
        for (const r of ["ugc", "nofollow", "noopener", "noreferrer"]) expect(rel, r).toContain(r);
    });
});
