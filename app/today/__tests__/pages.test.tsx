import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { PREFECTURES } from "@/lib/data/prefectures";
import { siteConfig } from "@/lib/utils/seo";
import { ROUTES } from "@/lib/routes";
import { clockIn, sunTimes } from "@/lib/utils/sunTimes";
import { todayPlace, todayPrefTitle, TODAY_HUB_TITLE } from "@/lib/data/todayPlaces";
import { lightCellText, lightCalendar } from "@/lib/utils/lightCalendar";

/**
 * 県ごとの頁（47頁）とハブの中身。
 *   - 月ごとの表は12行・値は sunTimes と同じ（ビルド時に書く）
 *   - 🔴 **今日の値は静的 HTML に焼かない**——書き出した日が違っても HTML は同じで、今日の値はブラウザが計算する
 *   - 画面の文の決まり（「撮りどき」「注目スポット」「撮影地ガイド」「ガイドを見る」「この場所」を使わない）
 */
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const PrefPage = (await import("../[pref]/page")).default;
const prefMeta = await import("../[pref]/page");
const HubPage = (await import("../page")).default;
const hubMeta = await import("../page");

const prefEl = async (slug: string) => PrefPage({ params: Promise.resolve({ pref: slug }) });

afterEach(() => { vi.useRealTimers(); });

const BANNED = ["撮りどき", "注目スポット", "撮影地ガイド", "ガイドを見る", "この場所", "おすすめ"];

describe("/today/<県>", () => {
    it("47県ぶん静的パラメータを返し、それ以外は作らない", () => {
        expect(prefMeta.dynamicParams).toBe(false);
        expect(prefMeta.generateStaticParams()).toEqual(PREFECTURES.map((p) => ({ pref: p.slug })));
    });

    it("知らない県は 404", async () => {
        await expect(prefEl("atlantis")).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("47頁すべてで、月の表は12行・近くのスポットのリンクがあり、禁じた言葉が無い", async () => {
        for (const p of PREFECTURES) {
            const html = renderToStaticMarkup(await prefEl(p.slug));
            expect(html.match(/data-testid="today-month-row"/g), p.slug).toHaveLength(12);
            expect(html, p.slug).toContain('data-testid="today-nearby-section"');
            expect(html, p.slug).toMatch(/href="\/spots\/[a-z0-9-]+"/);
            expect(html, p.slug).toContain(`href="${ROUTES.SPOT_AREA(p.slug)}"`);
            for (const w of BANNED) expect(html, `${p.slug} に「${w}」`).not.toContain(w);
            // 公式の暦ではない・誤差・天気を含まないの注記
            expect(html, p.slug).toContain("公式の暦ではありません");
            expect(html, p.slug).toContain("誤差はおおむね1〜2分");
        }
    });

    it("月の表の値は sunTimes（各月15日）と同じ", async () => {
        const place = todayPlace("tokyo")!;
        const { container } = render(await prefEl("tokyo"));
        const rows = [...container.querySelectorAll('[data-testid="today-month-row"]')];
        expect(rows).toHaveLength(12);
        const cal = lightCalendar(place.coords, "日本")!;
        rows.forEach((tr, i) => {
            const m = i + 1;
            const t = sunTimes(`2026-${String(m).padStart(2, "0")}-15`, place.coords)!;
            const cells = [...tr.querySelectorAll("th, td")].map((c) => c.textContent ?? "");
            expect(cells[0]).toBe(`${m}月`);
            expect(cells[1]).toContain(clockIn("Asia/Tokyo", t.sunrise)!);
            expect(cells[2]).toContain(clockIn("Asia/Tokyo", t.sunset)!);
            expect(cells[3]).toMatch(/^\d+時間\d+分$/);
            expect(cells[4]).toBe(lightCellText(cal.rows[i].eveningGolden, true));
        });
    });

    it("🔴 今日の値は静的 HTML に焼かない（書き出した日が違っても HTML は同じ）", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
        const a = renderToStaticMarkup(await prefEl("tokyo"));
        vi.setSystemTime(new Date("2026-06-21T00:00:00Z"));
        const b = renderToStaticMarkup(await prefEl("tokyo"));
        expect(a).toBe(b);
        expect(a).toContain('data-ready="false"');
        expect(a).not.toContain("· 今日");
        expect(a).not.toContain('data-ymd=');
    });

    it("ブラウザで開くと、その日（日本の日付）の値になる", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        // UTC では 6/21 15:30 でも、日本は 6/22 0:30
        vi.setSystemTime(new Date("2026-06-21T15:30:00Z"));
        const place = todayPlace("tokyo")!;
        const { container } = render(await prefEl("tokyo"));
        const panel = container.querySelector('[data-testid="today-light"]')!;
        expect(panel.getAttribute("data-ready")).toBe("true");
        expect(panel.getAttribute("data-ymd")).toBe("2026-06-22");
        const t = sunTimes("2026-06-22", place.coords)!;
        expect(panel.textContent).toContain(clockIn("Asia/Tokyo", t.sunrise)!);
        expect(panel.textContent).toContain(clockIn("Asia/Tokyo", t.sunset)!);
        expect(screen.getByTestId("today-light-date").textContent).toContain("6月22日");
        expect(screen.getByTestId("today-light-date").textContent).toContain("今日");
    });

    it("題・説明・canonical・構造化データ（パンくず・近くのスポットの ItemList）", async () => {
        const titles = new Set<string>();
        for (const p of PREFECTURES) {
            const md = await prefMeta.generateMetadata({ params: Promise.resolve({ pref: p.slug }) });
            const place = todayPlace(p.slug)!;
            // 2026-11-11（札 journey.photo-ios#527）: template の長いサイト名を外し、短い名前を自分で付ける（60 字以内）
            const t = (md.title as { absolute: string }).absolute;
            expect(t).toBe(`${todayPrefTitle(place)} | Journey Photo`);
            expect([...t].length, t).toBeLessThanOrEqual(60);
            expect(md.openGraph?.title).toBe(todayPrefTitle(place));
            titles.add(t);
            expect(md.alternates?.canonical).toBe(`${siteConfig.url}/today/${p.slug}`);
            expect(String(md.description)).toContain("開いた日の値を表示します");
            expect(String(md.description).length).toBeLessThan(200);
            for (const w of BANNED) expect(t + String(md.description)).not.toContain(w);
        }
        expect(titles.size).toBe(47);

        const html = renderToStaticMarkup(await prefEl("kyoto"));
        const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)]
            .map((m) => JSON.parse(m[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">")));
        const bc = ld.find((d) => d["@type"] === "BreadcrumbList")!;
        expect(bc.itemListElement.map((i: { name: string }) => i.name)).toEqual(["ホーム", "今日の日の出・日の入り", "京都"]);
        const list = ld.find((d) => d["@type"] === "ItemList")!;
        expect(list.numberOfItems).toBeGreaterThan(0);
        expect(list.itemListElement[0].url).toMatch(new RegExp(`^${siteConfig.url}/spots/`));
    });
});

describe("/today（ハブ）", () => {
    it("47県のリンクを JavaScript なしで持ち、位置情報の約束を書いている", () => {
        const html = renderToStaticMarkup(<HubPage />);
        for (const p of PREFECTURES) expect(html).toContain(`href="/today/${p.slug}"`);
        expect(html).toContain("ボタンを押したときだけ");
        expect(html).toContain("サーバーにも解析（GA4）にも送らず、保存もしません");
        for (const w of BANNED) expect(html).not.toContain(w);
    });

    it("題は安定した文（日付なし・サイト名なし）で canonical が /today", () => {
        const md = hubMeta.metadata;
        expect(md.title).toBe(TODAY_HUB_TITLE);
        expect(md.alternates?.canonical).toBe(`${siteConfig.url}/today`);
        expect(String(md.title)).not.toMatch(/\d{4}|Journey Photo/);
    });
});
