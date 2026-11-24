import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * **郷土料理とお土産の頁（`/food/<県>`）**と、県の頁の入口・サイトマップ（2026-11-23・案 B の試作）。
 * 台帳はコミット済みの `content/local-food.json`
 */
vi.mock("../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import FoodAreaPage, { generateMetadata, generateStaticParams } from "../food/[area]/page";
import { foodAreas, foodArea } from "@/lib/data/localFood";
import { sitemapGroups } from "@/lib/server/sitemap";
import { siteConfig, INDEXABLE_ROBOTS } from "@/lib/utils/seo";

const params = (area: string) => ({ params: Promise.resolve({ area }) });

describe("/food/<県>", () => {
    it("書き出すのは公開済みの5県だけ", () => {
        expect(generateStaticParams().map((p) => p.area).sort()).toEqual(["hiroshima", "hokkaido", "kyoto", "miyagi", "okinawa"]);
    });

    it("北海道: 明朝の h1・パンくず（ホーム › 観光スポット › 北海道）・郷土料理とお土産の札・出典と作成元の断り", async () => {
        const a = foodArea("hokkaido")!;
        const { container } = render(await FoodAreaPage(params("hokkaido")));
        const h1 = screen.getByRole("heading", { level: 1 });
        expect(h1.textContent).toBe("北海道の郷土料理とお土産");
        expect(h1.className).toContain("font-serif");
        const crumbs = within(screen.getByRole("navigation", { name: "パンくずリスト" })).getAllByRole("link").map((x) => x.getAttribute("href"));
        expect(crumbs).toEqual(["/", "/spots", "/spots/area/hokkaido"]);
        expect(screen.getAllByTestId("food-dish")).toHaveLength(a.dishes.length);
        expect(screen.getAllByTestId("food-souvenir")).toHaveLength(a.souvenirs.length);
        // 品目ごとの出典（農水省の頁・別のタブ）
        const sources = Array.from(container.querySelectorAll('a[href^="https://www.maff.go.jp/"]'));
        expect(sources).toHaveLength(a.dishes.length + a.souvenirs.length);
        for (const s of sources) expect(s.getAttribute("rel")).toContain("noopener");
        // 国が作ったように見せない（公共データ利用規約 1.0）
        expect(screen.getByTestId("food-credit").textContent).toContain("農林水産省が作成したものではありません");
        expect(screen.getByTestId("food-credit").textContent).toContain("お店の情報は載せていません");
        // 伝承地域の撮影スポットへ（豚丼 → タウシュベツ川橋梁）
        const butadon = container.querySelector("#butadon")!;
        expect(within(butadon as HTMLElement).getByRole("link", { name: "タウシュベツ川橋梁" }).getAttribute("href")).toBe("/spots/taushubetsu");
        // 写真は使わない
        expect(container.querySelector("main img")).toBeNull();
        const ld = Array.from(container.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent ?? "{}"));
        expect(ld.map((x) => x["@type"])).toEqual(["BreadcrumbList"]);
    });

    it("🔴 お土産が0品の京都府は「お土産」と名乗らず、お土産の節も出さない", async () => {
        expect(foodArea("kyoto")!.souvenirs).toHaveLength(0);
        render(await FoodAreaPage(params("kyoto")));
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("京都府の郷土料理");
        expect(screen.queryByRole("heading", { name: "お土産" })).toBeNull();
        const m = await generateMetadata(params("kyoto"));
        expect((m.title as { absolute: string }).absolute.startsWith("京都府の郷土料理｜")).toBe(true);
        expect(String(m.description)).not.toContain("お土産");
    });

    it("題はサイト名なしの完全な形・検索に出す・正規の URL", async () => {
        const m = await generateMetadata(params("hokkaido"));
        expect(m.title).toEqual({ absolute: "北海道の郷土料理とお土産｜豚丼、いかめしほか" });
        expect(m.robots).toEqual(INDEXABLE_ROBOTS);
        expect(m.alternates?.canonical).toBe(`${siteConfig.url}/food/hokkaido`);
    });

    it("建っていない県は noindex（静的書き出しでは 404）", async () => {
        const m = await generateMetadata(params("kagawa"));
        expect(m.robots).toEqual({ index: false, follow: true });
    });
});

describe("県の頁の入口（旅のお供）", () => {
    it("郷土料理の頁がある県だけ入口を出す", async () => {
        const { default: SpotAreaPage } = await import("../spots/area/[area]/page");
        const { container } = render(await SpotAreaPage(params("hokkaido")));
        const entry = within(container).getByTestId("area-food-link");
        expect(within(entry).getByRole("link").getAttribute("href")).toBe("/food/hokkaido");
        expect(entry.textContent).toContain("北海道の郷土料理とお土産");
    }, 30_000);

    it("頁の無い県（香川県）には入口を出さない", async () => {
        expect(foodArea("kagawa")).toBeUndefined();
        const { default: SpotAreaPage } = await import("../spots/area/[area]/page");
        const { container } = render(await SpotAreaPage(params("kagawa")));
        expect(within(container).queryByTestId("area-food-link")).toBeNull();
    }, 30_000);
});

describe("サイトマップ", () => {
    it("公開済みの県の /food を areas の束に載せ、日付は確かめた日", async () => {
        const g = await sitemapGroups();
        for (const a of foodAreas()) {
            const e = g.areas.find((x) => x.url === `${siteConfig.url}/food/${a.area}`);
            expect(e, a.area).toBeTruthy();
            expect(e!.lastModified, a.area).toBe(a.aiCheck!.checkedAt);
        }
    }, 60_000);
});
