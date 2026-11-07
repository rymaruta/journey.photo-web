import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import { lightCalendar } from "@/lib/utils/lightCalendar";

/**
 * スポットの頁から、その県の「今日の日の出・日の入り」（/today/<県>）へ（2026-11-07）。
 * 光の表の下に1本。海外・光の表が無いスポットには出さない（県の頁が無い・表が無い）
 */
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ slugs: [] }) })) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_92dc681b0f47",
    slug: "ginzan-onsen",
    name: "銀山温泉",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "山形県", city: "尾花沢市" },
    coords: { lat: 38.58, lng: 140.53 },
    highlights: ["木造多層の旅館"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};

const AREA = { slug: "yamagata", name: "山形県", nameEn: "Yamagata" };

const view = (props: Partial<React.ComponentProps<typeof SpotGuideClient>>, spot: Spot = SPOT) => render(
    <ToastProvider>
        <SpotGuideClient spot={spot} photos={[]} nearby={[]} locationPath={null} light={lightCalendar(spot.coords, spot.region?.country)} area={AREA} {...props} />
    </ToastProvider>,
);

describe("スポットの頁 → その県の今日の日の出・日の入り", () => {
    it("国内のスポットは /today/<県> へのリンクを1本出す", () => {
        view({});
        const link = screen.getByTestId("spot-today-link").querySelector("a")!;
        expect(link.getAttribute("href")).toBe("/today/yamagata");
        expect(link.textContent).toContain("山形の今日の日の出・日の入り時刻");
    });

    it("光の表が無いときは出さない", () => {
        view({ light: null });
        expect(screen.queryByTestId("spot-today-link")).toBeNull();
    });

    it("海外のスポットには出さない（県の頁が無い）", () => {
        const paris: Spot = { ...SPOT, slug: "eiffel", region: { country: "フランス", prefecture: "Île-de-France", city: "パリ" }, coords: { lat: 48.8584, lng: 2.2945 } };
        view({ area: { slug: "overseas", name: "海外", nameEn: "Outside Japan" } }, paris);
        expect(screen.queryByTestId("spot-today-link")).toBeNull();
    });
});
