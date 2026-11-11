import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import type { Photo } from "@/lib/data/photos";

/**
 * 撮影スポットの頁: 写真を載せた人を、プロフィールへの `<a href>` で出す
 * （2026-11-11 journey.photo-ios#525）。本番のスポットの頁からプロフィールへの
 * リンクは0本だった（curl で確認）。
 */
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ slugs: [] }) })) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_000000000001",
    slug: "miyagi-zao-fox",
    name: "蔵王キツネ村",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "宮城県", city: "白石市" },
    coords: { lat: 38.02, lng: 140.55 },
    highlights: ["キツネ"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-10-31",
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
};
const PHOTO = { id: "p1", src: "https://cdn.example.com/a.webp", title: "夢の中" } as Photo;
// `app/data/photos.json` に実在する（＝静的な /users/<id> がある）投稿者
const OWNER = "67d49a68-80f1-7083-b0e0-c767886ef868";

beforeEach(() => {
    window.history.replaceState(null, "", "/spots/miyagi-zao-fox");
});

describe("撮影スポットの頁: 写真を載せた人", () => {
    it("プロフィールへのリンクで出す", () => {
        render(
            <ToastProvider>
                <SpotGuideClient spot={SPOT} photos={[PHOTO]} creators={[{ id: OWNER, name: "丸田 竜平" }]} nearby={[]} locationPath={null} />
            </ToastProvider>,
        );
        const box = screen.getByTestId("spot-photo-creators");
        expect(box.textContent).toContain("写真を載せた人");
        const link = screen.getByRole("link", { name: "丸田 竜平" });
        expect(link.getAttribute("href")).toBe(`/users/${OWNER}`);
    });

    it("載せた人が分からなければ行を出さない", () => {
        render(
            <ToastProvider>
                <SpotGuideClient spot={SPOT} photos={[PHOTO]} nearby={[]} locationPath={null} />
            </ToastProvider>,
        );
        expect(screen.queryByTestId("spot-photo-creators")).toBeNull();
    });
});

// 配線: 受ける側だけ直しても、頁が渡さなければ1本も出ない（台帳でいちばん多い失敗の形）
describe("撮影スポットの頁が、そのスポットの写真の投稿者を渡す", () => {
    it("SpotGuidePage は表示する写真（mine）から creators を組んで渡す", async () => {
        const fs = await import("node:fs");
        const src = fs.readFileSync(`${__dirname}/../SpotGuidePage.tsx`, "utf8");
        expect(src).toMatch(/creators=\{photoCreators\(mine\)\}/);
    });
});
