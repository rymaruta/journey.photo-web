import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";
import type { SpotVisitFacts } from "@/lib/data/spotVisitFacts";

/**
 * 撮影スポットの頁の「行く前に知りたい事実」の段（札 rymaruta/journey.photo-ios#527 の案 2・2026-11-11）。
 * 事実があれば段と出典のリンクが出る・無ければ段ごと出ない・三脚などは書いていなければ「記載なし」
 */
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ slugs: [] }) })) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const SPOT: Spot = {
    spotId: "sp_000000000001",
    slug: "example-tera",
    name: "例の寺",
    summary: "あ".repeat(40),
    region: { country: "日本", prefecture: "京都府", city: "京都市" },
    coords: { lat: 35.0, lng: 135.7 },
    highlights: ["朱の門"],
    officialWebsiteUrl: "https://example.example/",
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};

const A = { url: "https://example.example/access/", title: "交通アクセス｜例の寺", readAt: "2026-11-11" };
const R = { url: "https://example.example/request/", title: "お願い｜例の寺", readAt: "2026-11-11" };
const FACTS: SpotVisitFacts = {
    delegatedBy: "rymaruta",
    readPages: [A, R],
    bestSeasons: [{ ...A, subject: "紅葉", text: "例年11月中旬から12月上旬" }],
    access: [{ ...A, mode: "train", text: "例の駅から東へ歩いて5分" }],
    parking: { ...A, available: true, text: "参拝者用の駐車場あり" },
    hours: [{ ...A, text: "8時30分から17時", opens: "08:30", closes: "17:00" }],
    fees: [{ ...A, text: "大人500円" }],
    photoRules: {
        drone: { ...R, status: "prohibited", text: "境内で飛ばすことは禁止" },
        notes: [{ ...R, text: "本堂の中は撮影禁止" }],
    },
};

const view = (visit: SpotVisitFacts | null, spot: Spot = SPOT) => render(
    <ToastProvider>
        <SpotGuideClient spot={spot} photos={[]} nearby={[]} locationPath={null} visit={visit} />
    </ToastProvider>,
);

describe("スポットの頁の事実の段", () => {
    it("見頃・アクセス・時間と料金・撮影の決まりの段が、出典のリンクつきで出る", () => {
        view(FACTS);
        const season = screen.getByTestId("spot-best-season");
        expect(season.textContent).toContain("紅葉");
        expect(season.textContent).toContain("例年11月中旬から12月上旬");
        expect(within(season).getByRole("link", { name: "交通アクセス｜例の寺" }).getAttribute("href")).toBe(A.url);

        const access = screen.getByTestId("spot-visit-access");
        expect(access.textContent).toContain("電車");
        expect(access.textContent).toContain("例の駅から東へ歩いて5分");
        expect(access.textContent).toContain("参拝者用の駐車場あり");
        expect(screen.getByTestId("spot-visit-access-sources").textContent).toContain("（公式サイトより・2026年11月11日確認）");

        const hours = screen.getByTestId("spot-hours");
        expect(hours.textContent).toContain("8時30分から17時");
        expect(hours.textContent).toContain("大人500円");

        const rules = screen.getByTestId("spot-photo-rules");
        expect(within(rules).getByRole("heading", { name: "撮影の決まり" })).toBeTruthy();
        expect(screen.getByTestId("photo-rule-drone").textContent).toContain("不可");
        expect(rules.textContent).toContain("本堂の中は撮影禁止");
        expect(within(screen.getByTestId("spot-photo-rules-sources")).getByRole("link").getAttribute("href")).toBe(R.url);
    });

    it("公式の頁に書いていない道具は行ごと出さない（可否を推さず、「記載なし」とも言わない）。ドローンの法律の注意は出す", () => {
        view(FACTS);
        expect(screen.queryByTestId("photo-rule-tripod")).toBeNull();
        expect(screen.queryByTestId("photo-rule-selfieStick")).toBeNull();
        expect(screen.getByTestId("spot-photo-rules").textContent).not.toContain("記載なし");
        expect(screen.getByTestId("photo-rule-drone-law").textContent).toContain("小型無人機等飛行禁止法");
    });

    it("道具の決まりが無く注記だけでも、段は出る（道具の行は無し）", () => {
        view({ ...FACTS, photoRules: { notes: [{ ...R, text: "本堂の中は撮影禁止" }] } });
        expect(screen.getByTestId("spot-photo-rules").textContent).toContain("本堂の中は撮影禁止");
        expect(screen.queryByTestId("photo-rule-drone")).toBeNull();
    });

    it("事実が無ければ段を出さない", () => {
        view(null);
        for (const id of ["spot-best-season", "spot-visit-access", "spot-hours", "spot-photo-rules"]) {
            expect(screen.queryByTestId(id)).toBeNull();
        }
    });

    it("事実の一部だけなら、その段だけ出す", () => {
        view({ delegatedBy: "rymaruta", readPages: [A], fees: [{ ...A, text: "無料" }] });
        expect(screen.getByTestId("spot-hours").textContent).toContain("無料");
        expect(screen.queryByTestId("spot-best-season")).toBeNull();
        expect(screen.queryByTestId("spot-photo-rules")).toBeNull();
        expect(screen.queryByTestId("spot-visit-access")).toBeNull();
    });

    it("人が確かめたアクセスがある行では、公式の頁から読んだアクセスを重ねない", () => {
        const human: Spot = {
            ...SPOT,
            access: { transit: "人が確かめた行き方" },
            sources: [{ field: "access", url: "https://example.example/a", checkedAt: "2026-09-25", checkedBy: "rymaruta" }],
        };
        view(FACTS, human);
        expect(screen.getByText("人が確かめた行き方")).toBeTruthy();
        expect(screen.queryByTestId("spot-visit-access")).toBeNull();
    });
});
