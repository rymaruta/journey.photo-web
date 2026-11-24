import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * 「検索エンジンにプロフィールを表示しない」（2026-11-11 owner 承認・journey.photo-ios#526）。
 * 選んだ人の `/users/<id>` は noindex・sitemap から外す・構造化データを出さない。
 * 材料はビルド時の `profiles.json` の `searchHidden`。
 */
const profiles = vi.hoisted(() => ({ current: {} as Record<string, { searchHidden?: boolean; username?: string }> }));
vi.mock("../data/profiles.json", () => ({ default: profiles.current }));
vi.mock("../users/UserProfileClient", () => ({ default: () => <div data-testid="client" /> }));

// `app/data/photos.json` に実在する（＝静的な頁と sitemap の行がある）投稿者
const OWNER = "67d49a68-80f1-7083-b0e0-c767886ef868";

beforeEach(() => { for (const k of Object.keys(profiles.current)) delete profiles.current[k]; });

const page = await import("../users/[id]/page");
const { sitemapGroups } = await import("../../lib/server/sitemap");

describe("検索エンジンにプロフィールを表示しない", () => {
    it("選んだ人の頁は noindex（リンクは辿らせる）", async () => {
        profiles.current[OWNER] = { searchHidden: true };
        const meta = await page.generateMetadata({ params: Promise.resolve({ id: OWNER }) });
        expect(meta.robots).toMatchObject({ index: false, follow: true });
    });

    it("選んでいない人は今までどおり index", async () => {
        const meta = await page.generateMetadata({ params: Promise.resolve({ id: OWNER }) });
        expect(meta.robots).toMatchObject({ index: true });
    });

    it("選んだ人の頁には構造化データ（ProfilePage・Person）を出さない", async () => {
        profiles.current[OWNER] = { searchHidden: true, username: "ryuhei" };
        const { container } = render(await page.default({ params: Promise.resolve({ id: OWNER }) }));
        expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
    });

    it("選んでいない人には構造化データを出す", async () => {
        const { container } = render(await page.default({ params: Promise.resolve({ id: OWNER }) }));
        expect(container.querySelector('script[type="application/ld+json"]')).not.toBeNull();
    });

    it("選んだ人は sitemap に載せない", async () => {
        const url = `/users/${OWNER}`;
        const shown = (await sitemapGroups()).pages.map((e) => e.url);
        expect(shown.some((u) => u.endsWith(url)), "前提: 選んでいなければ載る").toBe(true);
        profiles.current[OWNER] = { searchHidden: true };
        const hidden = (await sitemapGroups()).pages.map((e) => e.url);
        expect(hidden.some((u) => u.endsWith(url))).toBe(false);
    });
});
