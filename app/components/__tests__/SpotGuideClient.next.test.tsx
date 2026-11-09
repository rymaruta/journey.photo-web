import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";
import type { Spot } from "@/lib/data/spots";

/**
 * 撮影スポット詳細の「次へ」（2026-11-09 owner「任せる」・デザイナーの提案書の案C）。
 *
 *  - 県・近く・季節の一覧への文字リンクとアプリの札が、説明文（summary）のすぐ下（行動3つの下）にある
 *  - **リンクの集合は従来と同じ（増えない）。** 従来の頁の `href` の集合は、この変更の前の部品を同じ材料で描いて
 *    取った値を `BASELINE_HREFS` に固定してある
 *  - 元の置き場（右の柱）から**移した**ので、国・テーマ・季節の一覧と「すべて見る」は1頁に1回だけ
 *  - パンくずは押せる高さ（44px）
 *  - `nav_click`（area=spot_next）と `app_store_click`（placement=spot_detail）
 *  - 禁止語（「撮りどき」「この場所」「注目スポット」）を新しい文に使わない
 */
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn(async () => ({ ok: true, json: async () => ({ slugs: [] }) })) }));
vi.mock("../GalleryGrid", () => ({ default: () => <div data-testid="grid" /> }));

import SpotGuideClient from "../SpotGuideClient";

const gtag = vi.fn();
beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});
const events = (name: string) => gtag.mock.calls.filter((c) => c[1] === name).map((c) => c[2]);

const SPOT: Spot = {
    spotId: "sp_goryokaku",
    slug: "goryokaku",
    name: "五稜郭",
    summary: "江戸時代末期に築かれた星形の城郭。".repeat(2),
    description: "春は桜、冬は雪景色。",
    region: { country: "日本", prefecture: "北海道", city: "函館市" },
    coords: { lat: 41.79, lng: 140.75 },
    highlights: ["星形の堀"],
    status: "published",
    verifiedBy: "運営",
    verifiedAt: "2026-09-23",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
};
const AREA = { slug: "hokkaido", name: "北海道", nameEn: "Hokkaido" };
const NEARBY = [{ slug: "hakodate-yama", name: "函館山" }, { slug: "komagatake", name: "北海道駒ヶ岳" }];
const SAME = { label: "北海道", spots: [{ slug: "otaru-unga", name: "小樽運河" }] };
const TOPICS = [
    { href: "/spots/season/spring", label: "春の撮影スポット", count: 120 },
    { href: "/spots/season/winter", label: "冬の撮影スポット", count: 90 },
    { href: "/spots/theme/castle/hokkaido", label: "北海道の城", count: 4 },
];

const view = (props: Partial<React.ComponentProps<typeof SpotGuideClient>> = {}) => render(
    <ToastProvider>
        <SpotGuideClient spot={SPOT} photos={[]} nearby={NEARBY} sameArea={SAME} locationPath="/location/hakodate"
            pageUrl="https://journey-photo.com/spots/goryokaku" area={AREA} topics={TOPICS} {...props} />
    </ToastProvider>,
);

const hrefs = (root: ParentNode) => Array.from(root.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")!);
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * 変更前の部品を同じ材料（上の SPOT・NEARBY・SAME・TOPICS・AREA）で描いて取った、頁の中のリンクの集合（重複を除き並べ替え）。
 * 変更前: 右の柱の「すべて見る」（県）と「この撮影スポットが載っている一覧」がここにあった。
 */
const BASELINE_HREFS: string[] = ["/", "/location/hakodate", "/map#14/41.79/140.75", "/spots", "/spots/area/hokkaido", "/spots/hakodate-yama", "/spots/komagatake", "/spots/otaru-unga", "/spots/season/spring", "/spots/season/winter", "/spots/theme/castle/hokkaido", "/user/upload"];

describe("撮影スポット詳細の「次へ」", () => {
    it("説明文（summary）の下・行動3つの下・写真・魅力・近くの節より前にある", () => {
        const { container } = view();
        const next = screen.getByTestId("spot-next");
        const summary = screen.getByText(SPOT.summary!);
        const mapTile = screen.getByRole("link", { name: "地図で見る" });
        expect(before(summary, next)).toBe(true);
        expect(before(mapTile, next)).toBe(true);
        for (const id of ["spot-photos", "spot-charm", "spot-nearby", "spot-same-area", "spot-map"]) {
            const el = container.querySelector(`#${id}`);
            expect(el, id).not.toBeNull();
            expect(before(next, el!), `${id} より前`).toBe(true);
        }
    });

    it("兄弟の並びで見る: 基本情報（summary）→ 行動3つ → 次へ → 本文の2段組（写真・魅力・右の柱）", () => {
        const { container } = view({ photos: [{ id: "p1", src: "https://cdn/p1.jpg", title: "t" } as never] });
        const next = screen.getByTestId("spot-next");
        const siblings = Array.from(next.parentElement!.children);
        const i = siblings.indexOf(next);
        expect(siblings[i - 2].tagName).toBe("HEADER");
        expect(siblings[i - 2].textContent).toContain(SPOT.summary!);
        expect(siblings[i - 1].contains(screen.getByRole("link", { name: "地図で見る" }))).toBe(true);
        const grid = siblings[i + 1];
        for (const id of ["spot-photos", "spot-charm", "spot-nearby"]) expect(grid.contains(container.querySelector(`#${id}`)), id).toBe(true);
    });

    it("県の一覧・近くの節への行き・季節などの一覧・アプリの札が、すべてこの中にある", () => {
        view();
        const next = screen.getByTestId("spot-next");
        expect(within(next).getByRole("link", { name: /北海道の撮影スポットをすべて見る/ }).getAttribute("href")).toBe("/spots/area/hokkaido");
        expect(within(next).getByRole("link", { name: "近くの撮影スポット" }).getAttribute("href")).toBe("#spot-nearby");
        for (const t of TOPICS) expect(within(next).getByRole("link", { name: new RegExp(t.label) }).getAttribute("href")).toBe(t.href);
        expect(within(next).getByTestId("app-install-card").getAttribute("data-placement")).toBe("spot_detail");
    });

    it("リンクの集合は従来と同じ（増えない・減らない）", () => {
        const { container } = view();
        // サイト内の URL だけ見る。外へ出る App Store のリンク（アプリの札）は新しい導線で、フッターの札からこちらへ移したもの
        const now = Array.from(new Set(hrefs(container).filter((h) => !h.startsWith("#") && !h.startsWith("http")))).sort();
        expect(now).toEqual(BASELINE_HREFS);
        expect(hrefs(container).filter((h) => h.startsWith("http"))).toEqual(["https://apps.apple.com/jp/app/id6814335283"]);
    });

    it("移したものを複製しない: 季節などの一覧と県の「すべて見る」は頁に1回だけ", () => {
        const { container } = view();
        const all = hrefs(container);
        for (const t of TOPICS) expect(all.filter((h) => h === t.href), t.href).toHaveLength(1);
        expect(container.querySelectorAll('[data-testid="spot-topics"]')).toHaveLength(1);
        expect(screen.getAllByRole("link", { name: /北海道の撮影スポットをすべて見る/ })).toHaveLength(1);
        expect(container.querySelectorAll('[data-testid="app-install-card"]')).toHaveLength(1);
    });

    it("近くの節の ID と、行の頁内リンクの行き先が一致する（空振りしない）", () => {
        const { container } = view();
        const target = within(screen.getByTestId("spot-next")).getByRole("link", { name: "近くの撮影スポット" }).getAttribute("href")!.slice(1);
        expect(container.querySelector(`#${target}`)).not.toBeNull();
    });

    it("近くが無いときは近くの行を出さず、県も国も無いときは県の行を出さない（空の行を作らない）", () => {
        view({ nearby: [], area: null, country: null, topics: [] });
        const next = screen.getByTestId("spot-next");
        expect(within(next).queryAllByRole("link")).toHaveLength(1);   // アプリの札のボタンだけ
        expect(screen.queryByTestId("spot-topics")).toBeNull();
    });

    it("海外は国の一覧へ", () => {
        view({ area: { slug: "overseas", name: "海外", nameEn: "Outside Japan" }, country: { href: "/spots/area/overseas/fr", name: "フランス", nameEn: "France" } });
        expect(within(screen.getByTestId("spot-next")).getByRole("link", { name: /フランスの撮影スポットをすべて見る/ }).getAttribute("href")).toBe("/spots/area/overseas/fr");
    });

    it("パンくずのリンクは押せる高さ（44px）", () => {
        view();
        const crumbs = within(screen.getByRole("navigation", { name: "パンくずリスト" })).getAllByRole("link");
        expect(crumbs.length).toBeGreaterThanOrEqual(3);
        for (const a of crumbs) expect(a.className).toContain("min-h-[44px]");
    });

    it("押すと nav_click（area=spot_next・dest）を送る。URL・slug は送らない", () => {
        view();
        const next = screen.getByTestId("spot-next");
        const stop = (e: Event) => e.preventDefault();
        next.addEventListener("click", stop);
        fireEvent.click(within(next).getByRole("link", { name: /北海道の撮影スポットをすべて見る/ }));
        fireEvent.click(within(next).getByRole("link", { name: "近くの撮影スポット" }));
        fireEvent.click(within(next).getByRole("link", { name: /春の撮影スポット/ }));
        expect(events("nav_click")).toEqual([
            expect.objectContaining({ area: "spot_next", dest: "area" }),
            expect.objectContaining({ area: "spot_next", dest: "nearby" }),
            expect.objectContaining({ area: "spot_next", dest: "topic" }),
        ]);
        expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/hokkaido|season|spring/);
    });

    it("アプリの札を押すと app_store_click（placement=spot_detail）", () => {
        view();
        const card = within(screen.getByTestId("spot-next")).getByTestId("app-install-card");
        const link = within(card).getByRole("link");
        link.addEventListener("click", (e) => e.preventDefault());
        fireEvent.click(link);
        expect(events("app_store_click")).toEqual([expect.objectContaining({ placement: "spot_detail" })]);
    });

    it("新しい文に禁止語（撮りどき・この場所・注目スポット）を使わない", () => {
        view();
        const text = screen.getByTestId("spot-next").textContent!;
        for (const w of ["撮りどき", "この場所", "注目スポット"]) expect(text).not.toContain(w);
    });
});
