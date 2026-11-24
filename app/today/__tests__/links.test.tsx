import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { allSitemapEntries as sitemap } from "../../../lib/server/sitemap";
import { siteConfig } from "@/lib/utils/seo";
import { PREFECTURES } from "@/lib/data/prefectures";
import { ROUTES } from "@/lib/routes";

/** 導線: サイトマップ（ハブ＋47県）・/spots の入口。フッターは `app/components/__tests__/Footer.test.tsx`、スポットの頁は `SpotGuideClient.todayLink.test.tsx` */
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

describe("サイトマップ", () => {
    it("ハブと47県がそろって載り、更新日を偽らない", async () => {
        const entries = await sitemap();
        const byUrl = new Map(entries.map((e) => [e.url, e]));
        const hub = byUrl.get(`${siteConfig.url}/today`);
        expect(hub).toBeTruthy();
        const prefUrls = PREFECTURES.map((p) => `${siteConfig.url}${ROUTES.TODAY_PREF(p.slug)}`);
        for (const u of prefUrls) expect(byUrl.has(u), u).toBe(true);
        expect(entries.filter((e) => /\/today(\/|$)/.test(e.url))).toHaveLength(48);
        // HTML は日付で変わらない（今日の値はブラウザが計算する）ので、ビルドの時刻を更新日と申告しない
        for (const u of [`${siteConfig.url}/today`, ...prefUrls]) expect(byUrl.get(u)!.lastModified, u).toBeUndefined();
    });
});

describe("/spots の入口", () => {
    it("「今日の日の出・日の入り」への入口がある", async () => {
        const Page = (await import("../../spots/page")).default;
        const html = renderToStaticMarkup(<Page />);
        expect(html).toContain('data-testid="spots-today-entry"');
        expect(html).toContain(`href="${ROUTES.TODAY}"`);
    }, 60_000);   // 切り口の索引（季節・テーマ・市区町村）を台帳全体から組むので重い
});
