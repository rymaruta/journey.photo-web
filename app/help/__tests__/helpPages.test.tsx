import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HELP_PAGES, CHECKED_APP_VERSION } from "@/lib/data/helpPages";
import { ROUTES } from "@/lib/routes";
import { allSitemapEntries } from "@/lib/server/sitemap";
import { siteConfig } from "@/lib/utils/seo";

/**
 * **使い方（/help）の目次と各頁**（2026-11-12・札 journey.photo-ios#517）。描いた形を見る。
 */
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import HelpIndexPage, { metadata as indexMeta } from "../page";
import HelpPage, { generateStaticParams, generateMetadata } from "../[slug]/page";
import { hasHelpFigure } from "../HelpFigure";

const ldOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent ?? "{}"));
const crumbHrefs = () =>
    within(screen.getByRole("navigation", { name: "パンくずリスト" })).queryAllByRole("link").map((a) => a.getAttribute("href"));

describe("/help（目次）", () => {
    it("明朝の h1・パンくず・台帳の全頁への札（台帳の順）・構造化データ", () => {
        const { container } = render(<HelpIndexPage />);
        const h1 = screen.getByRole("heading", { level: 1 });
        expect(h1.textContent).toBe("Journey Photo の使い方");
        expect(h1.className).toContain("font-serif");
        expect(crumbHrefs()).toEqual(["/"]);
        const cards = screen.getAllByTestId("help-card").map((a) => a.getAttribute("href"));
        expect(cards).toEqual(HELP_PAGES.map((p) => `/help/${p.slug}`));
        // 札の小さい絵は飾り（読み上げは札の題が言う）
        const svgs = Array.from(container.querySelectorAll("[data-testid='help-card'] svg"));
        expect(svgs).toHaveLength(HELP_PAGES.length);
        for (const svg of svgs) expect(svg.getAttribute("aria-hidden")).toBe("true");
        expect(ldOf(container).map((x) => x["@type"])).toEqual(["BreadcrumbList", "CollectionPage"]);
        expect(ldOf(container)[1].mainEntity.numberOfItems).toBe(HELP_PAGES.length);
    });

    it("メタデータ: 題・canonical・検索に出す・共有カード", () => {
        expect(String(indexMeta.title)).toBe("Journey Photo の使い方");
        expect(indexMeta.alternates?.canonical).toBe(`${siteConfig.url}/help`);
        expect((indexMeta.robots as { index: boolean }).index).toBe(true);
        expect(indexMeta.openGraph?.images).toBeTruthy();
    });
});

describe("/help/<slug>（各頁）", () => {
    it("台帳の全頁を建てる（それ以外は 404）", () => {
        expect(generateStaticParams()).toEqual(HELP_PAGES.map((p) => ({ slug: p.slug })));
    });

    for (const p of HELP_PAGES) {
        it(`${p.slug}: 題・絵1枚・3行・パンくず・ほかの全頁と目次へのリンク`, async () => {
            const { container } = render(await HelpPage({ params: Promise.resolve({ slug: p.slug }) }));
            expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(p.title);
            expect(crumbHrefs()).toEqual(["/", "/help"]);
            // 絵は1枚で、読み上げの説明がある
            expect(hasHelpFigure(p.slug)).toBe(true);
            const figs = container.querySelectorAll("main > figure svg[role='img']");
            expect(figs).toHaveLength(1);
            expect(figs[0].getAttribute("aria-label")).toBe(p.figureLabel);
            // 3行
            const lines = within(screen.getByTestId("help-lines")).getAllByRole("listitem").map((li) => li.textContent);
            expect(lines).toHaveLength(3);
            p.lines.forEach((l, i) => expect(lines[i]).toContain(l));
            // 畳んだ節は台帳どおり
            const summaries = Array.from(container.querySelectorAll("details > summary")).map((s) => s.textContent);
            expect(summaries).toEqual((p.folds ?? []).map((f) => `${f.title}＋`));
            // ほかの全頁と目次へ
            const others = within(screen.getByTestId("help-others")).getAllByRole("link").map((a) => a.getAttribute("href"));
            expect(others).toEqual([...HELP_PAGES.filter((x) => x.slug !== p.slug).map((x) => `/help/${x.slug}`), "/help"]);
            // 使える所と、読んだ版
            expect(screen.getByTestId("help-scope").textContent).toBe(p.scope);
            expect(screen.getByTestId("help-version").textContent).toContain(CHECKED_APP_VERSION);
            expect(ldOf(container).map((x) => x["@type"])).toEqual(["BreadcrumbList"]);
        });
    }

    it("メタデータ: 題は台帳の題（サイト名はルートの template が足す）・説明・canonical", async () => {
        for (const p of HELP_PAGES) {
            const meta = await generateMetadata({ params: Promise.resolve({ slug: p.slug }) });
            expect(String(meta.title)).toBe(p.title);
            expect(meta.description).toBe(p.description);
            expect(meta.alternates?.canonical).toBe(`${siteConfig.url}/help/${p.slug}`);
        }
    });

    it("眉の「iPhone のアプリ」が大文字に化けない（`eyebrow` は大文字にするので normal-case を足す）", async () => {
        render(await HelpPage({ params: Promise.resolve({ slug: "pass" }) }));
        expect(screen.getByTestId("help-scope").parentElement!.className).toContain("normal-case");
    });
});

describe("サイトマップ", () => {
    it("目次と全頁が載る", async () => {
        const urls = new Set((await allSitemapEntries()).map((e) => e.url));
        expect(urls.has(`${siteConfig.url}${ROUTES.HELP}`)).toBe(true);
        for (const p of HELP_PAGES) expect(urls.has(`${siteConfig.url}${ROUTES.HELP_PAGE(p.slug)}`), p.slug).toBe(true);
    });
});
