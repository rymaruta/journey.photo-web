import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
        const attrs: Record<string, unknown> = { ...rest };
        delete attrs.prefetch;
        return <a href={href} {...attrs}>{children}</a>;
    },
}));

import SpotIndexPage from "../spots/page";
import SpotAreaPage from "../spots/area/[area]/page";
import { LocaleProvider } from "../i18n/context";
import SpotIndexClient from "../components/SpotIndexClient";
import SpotAreaIndexClient from "../components/SpotAreaIndexClient";
import { spotAreas, visibleSpotsInArea, spotIndexItemsForArea, type SpotIndexItem, type SpotArea } from "../../lib/data/spotLink";
import { spotIndexPhotos, COUNTRY_TILES, SEASON_SHELF, type SpotIndexPhotos } from "../../lib/data/spotIndexPhotos";
import { countryTopics, homeSeasonalSpots, spotIndexTopics, cityLinksForPrefecture } from "../../lib/data/spotTopics";
import { OVERSEAS_SLUG } from "../../lib/data/prefectures";

/**
 * 🔴 **撮影スポットの入口（`/spots`）と県の頁を写真の格子にした**（2026-11-10・札 rymaruta/journey.photo-ios#516 の案A・owner 承認）。
 *
 * 見張ること:
 * - **検索の入口を落とさない**: 県名・件数・スポット名のリンク、畳んだ切り口のリンクが静的 HTML に全部ある
 * - **写真の出典（CC BY・CC BY-SA）は畳まず常に出る**（2026-11-10 秘書室の判断）。札の © は実在する項目を指す
 * - **写真が無い・読めない札は「名前だけの札」**（壊れた画像の印を出さない）。水和の前に読み損ねた写真も拾う
 */
const dom = (html: string) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("/spots の静的 HTML", () => {
    const html = renderToStaticMarkup(<LocaleProvider><SpotIndexPage /></LocaleProvider>);
    const root = dom(html);
    const photos = spotIndexPhotos(new Date());

    it("国内の全県の札が、県名と件数を持つ県の頁へのリンクで出る", () => {
        const areas = spotAreas().filter((a) => a.slug !== OVERSEAS_SLUG);
        expect(areas.length).toBeGreaterThan(40);
        for (const a of areas) {
            const link = root.querySelector(`a[data-testid="spots-area-tile"][href="/spots/area/${a.slug}"]`);
            expect(link, a.slug).not.toBeNull();
            expect(link!.textContent, a.slug).toContain(a.name);
            expect(link!.textContent, a.slug).toContain(String(a.count));
        }
        // 写真のある県は写真の札（0 なら代表写真の選び方が繋がっていない）
        const withPhoto = root.querySelectorAll('a[data-testid="spots-area-tile"][data-photo="1"] img');
        expect(withPhoto.length).toBe(Object.keys(photos.areaCovers).length);
        expect(withPhoto.length).toBeGreaterThan(40);
        for (const img of withPhoto) expect(img.getAttribute("loading")).toBe("lazy");
    });

    it("北海道は東北と同じ節（「北海道・東北」）", () => {
        const hk = root.querySelector('a[href="/spots/area/hokkaido"]')!.closest("section")!;
        expect(hk.querySelector('a[href="/spots/area/aomori"]')).not.toBeNull();
        expect(hk.querySelector("h2")!.textContent).toMatch(/^北海道・東北/);
    });

    it(`海外は件数の多い ${COUNTRY_TILES} か国の札と、「すべての国・地域（N）」の札`, () => {
        const top = countryTopics().slice(0, COUNTRY_TILES);
        const tiles = [...root.querySelectorAll('a[data-testid="spots-country-tile"]')];
        expect(tiles.map((a) => a.getAttribute("href"))).toEqual(top.map((c) => `/spots/area/overseas/${c.code}`));
        tiles.forEach((a, i) => {
            expect(a.textContent).toContain(top[i].name);
            expect(a.textContent).toContain(String(top[i].spots.length));
        });
        const all = root.querySelector('a[data-testid="spots-all-countries"]')!;
        expect(all.getAttribute("href")).toBe("/spots/area/overseas");
        expect(all.textContent).toContain(`すべての国・地域（${countryTopics().length}）`);
    });

    it("いまの季節の棚はホームと同じ選び方（homeSeasonalSpots）", () => {
        const want = homeSeasonalSpots(new Date(), undefined, SEASON_SHELF)!;
        const cards = [...root.querySelectorAll('a[data-testid="season-shelf-card"]')];
        expect(cards.map((a) => a.getAttribute("href"))).toEqual(want.spots.map((s) => `/spots/${s.slug}`));
        expect(root.querySelector('[data-testid="spots-season-shelf"] a[href="' + want.href + '"]')).not.toBeNull();
    });

    it("畳んだ切り口（季節・桜紅葉雪・季節×種類・市区町村・テーマ）のリンクは HTML に全部ある", () => {
        const t = spotIndexTopics();
        const links = [...t.seasons, ...t.sakura, ...t.momiji, ...t.snow, ...t.seasonThemes, ...t.cities, ...t.themes.flatMap((g) => g.links)];
        expect(links.length).toBeGreaterThan(100);
        const index = root.querySelector('[data-testid="spots-topic-index"]')!;
        for (const l of links) expect(index.querySelector(`a[href="${l.href}"]`), l.href).not.toBeNull();
        // 段は閉じた <details>（開いた形で出さない）
        const folds = index.querySelectorAll("details");
        expect(folds.length).toBeGreaterThanOrEqual(4);
        for (const d of folds) expect(d.hasAttribute("open")).toBe(false);
    });

    it("🔴 写真の出典は畳まずに出て、札の © はどれも実在する項目を指す", () => {
        const credits = root.querySelector('[data-testid="photo-credits"]')!;
        expect(credits).not.toBeNull();
        expect(credits.closest("details"), "写真の出典が畳まれている").toBeNull();
        const items = credits.querySelectorAll('[data-testid="photo-credit-item"]');
        expect(items.length).toBe(photos.credits.length);
        expect(items.length).toBeGreaterThan(20);
        photos.credits.forEach((c, i) => {
            expect(items[i].id).toBe(`photo-credit-${c.key}`);
            expect(items[i].textContent).toContain(c.name);
            expect(items[i].textContent).toContain(c.credit.author);
            if (c.credit.license) expect(items[i].textContent).toContain(c.credit.license);
        });
        const marks = [...root.querySelectorAll('a[data-testid="credit-mark"]')];
        // 出典の要る写真の札には全部 ©（棚・県・国）
        const needMark = [...(photos.seasonal?.spots.map((s) => s.cover) ?? []), ...Object.values(photos.areaCovers), ...photos.countries.flatMap((c) => c.cover ? [c.cover] : [])]
            .filter((c) => c.creditKey).length;
        expect(marks.length).toBe(needMark);
        for (const m of marks) {
            const id = m.getAttribute("href")!.slice(1);
            expect(root.querySelector(`[id="${id}"]`), id).not.toBeNull();
            // © は札のリンクの外（リンクの中にリンクを入れない）
            expect(m.parentElement!.closest("a")).toBeNull();
        }
    });

    it("札に渡すのは写真の場所と出典の鍵だけ（出典の中身は一覧に1回）", () => {
        const keys = new Set<string>();
        for (const c of Object.values(photos.areaCovers)) for (const k of Object.keys(c)) keys.add(k);
        expect([...keys].sort()).toEqual(["creditKey", "creditName", "src"]);
        expect(new Set(photos.credits.map((c) => c.key)).size).toBe(photos.credits.length);
    });

    // 2026-11-10 確かめ役の指摘 1: 北海道の札の写真の代替文が「阿寒湖」で、読み上げが「阿寒湖 北海道 120」になっていた
    it("🔴 札の写真は飾り（alt が空）——棚・県・国の写真のどれも", () => {
        const imgs = root.querySelectorAll('img[data-testid="spot-photo"]');
        expect(imgs.length).toBeGreaterThan(40);
        for (const img of imgs) expect(img.getAttribute("alt"), img.getAttribute("src")!).toBe("");
    });

    // 2026-11-10 確かめ役の指摘 4: © の読み上げが札の名前（北海道）だけで、何の写真か言っていなかった
    it("県の札の © は「写真の出典: 写っているスポット（県）」と読む", () => {
        const hk = photos.areaCovers.hokkaido;
        expect(hk?.creditKey).toBeTruthy();
        const mark = root.querySelector('a[data-testid="spots-area-tile"][href="/spots/area/hokkaido"]')!.parentElement!
            .querySelector('a[data-testid="credit-mark"]')!;
        expect(mark.getAttribute("aria-label")).toBe(`写真の出典: ${hk.creditName}（北海道）`);
    });

    // 2026-11-10 確かめ役の指摘 2: 出典の説明が内部の呼び名（「札の写真の…」）だった
    it("🔴 画面の文・読み上げに内部の呼び名「札」を出さない（地名の札幌・札所などは除く）", () => {
        expect(root.querySelector('[data-testid="photo-credits"] > p')!.textContent)
            .toBe("写真の作者とライセンスです。写真の右上の © から、その写真の項目に移れます。");
        const texts = [root.textContent ?? "", ...[...root.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")!)];
        for (const t of texts) expect(t.replace(PLACE_FUDA, "")).not.toContain("札");
    });
});

/** 地名・寺社の語に入る「札」（札幌・札所など）。画面の文に出る「札」の見張りから外す */
const PLACE_FUDA = /札(幌|所|沼|内|前|苅|弦|滑|比内|楽|森|実|的)|(棟|高|絵|お)札/g;

describe("県の頁の静的 HTML（全県）", () => {
    it("どの県でも、スポット名のリンクが全部あり、写真の出典が畳まずに出て、市区町村のリンクも残る", async () => {
        const areas = spotAreas().filter((a) => a.slug !== OVERSEAS_SLUG);
        let cards = 0;
        for (const a of areas) {
            const root = dom(renderToStaticMarkup(<LocaleProvider>{await SpotAreaPage({ params: Promise.resolve({ area: a.slug }) })}</LocaleProvider>));
            const items = spotIndexItemsForArea(a.slug);
            expect(items.map((i) => i.slug)).toEqual(visibleSpotsInArea(a.slug).map((s) => s.slug));
            for (const it of items) {
                const link = root.querySelector(`a[data-testid="spot-card"][href="/spots/${it.slug}"]`);
                expect(link, `${a.slug}/${it.slug}`).not.toBeNull();
                expect(link!.textContent).toContain(it.name);
                cards++;
            }
            const withCredit = items.filter((i) => i.cover?.credit);
            const list = root.querySelector('[data-testid="photo-credits"]');
            if (withCredit.length > 0) {
                expect(list, a.slug).not.toBeNull();
                expect(list!.closest("details"), a.slug).toBeNull();
                expect(list!.querySelectorAll('[data-testid="photo-credit-item"]').length, a.slug).toBe(withCredit.length);
                expect(list!.textContent, a.slug).not.toMatch(/札の/);
            }
            // 札の写真は飾り（名前は札の題が言う・2026-11-10 確かめ役の指摘 1）
            for (const img of root.querySelectorAll('img[data-testid="spot-photo"]')) expect(img.getAttribute("alt"), a.slug).toBe("");
            // 札の下に出典を置かない（頁の下の一覧だけ）
            for (const c of root.querySelectorAll('[data-testid="topic-credit"]')) expect(c.closest('[data-testid="photo-credits"]'), a.slug).not.toBeNull();
            for (const l of cityLinksForPrefecture(a.slug)) {
                const el = root.querySelector(`[data-testid="area-city-links"] a[href="${l.href}"]`);
                expect(el, l.href).not.toBeNull();
                expect(el!.closest("details")).not.toBeNull();
            }
        }
        expect(cards).toBeGreaterThan(1000);
    }, 120_000);
});

describe("写真が無い・読めない札", () => {
    const ITEMS: SpotIndexItem[] = [
        {
            slug: "abukuma", name: "あぶくま洞", region: "福島県 田村市", stage: "published", summary: "鍾乳洞。",
            cover: { src: "/images/spots/thumb/abukuma.jpg", alt: "あぶくま洞の鍾乳石",
                credit: { author: "Σ64", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" } },
        },
        { slug: "nophoto", name: "写真なしの滝", region: "福島県 西郷村", stage: "published", cover: null },
    ];
    const renderArea = () => render(<LocaleProvider><SpotIndexClient spots={ITEMS} area={{ name: "福島県", nameEn: "Fukushima" }} /></LocaleProvider>);

    it("県の頁: 写真の札は正方形・名前・市区町村（県名を繰り返さない）・説明は PC だけ・右上に ©", () => {
        renderArea();
        const [card, empty] = screen.getAllByTestId("spot-card");
        expect(card.getAttribute("data-photo")).toBe("1");
        // 写真は飾り（名前を2回読まない）。リンクの読み上げは題と市区町村
        expect(card.querySelector("img")!.getAttribute("alt")).toBe("");
        expect(within(screen.getByTestId("spot-grid")).getAllByRole("link")[0]).toBe(card);
        expect(screen.getByRole("link", { name: /^あぶくま洞\s*田村市/ })).toBe(card);
        expect(screen.queryByRole("link", { name: /あぶくま洞.*あぶくま洞/ })).toBeNull();
        expect(card.textContent).toContain("田村市");
        expect(card.textContent).not.toContain("福島県");
        expect(screen.getByTestId("spot-card-summary").className).toContain("hidden lg:block");
        expect(screen.getByTestId("credit-mark").getAttribute("href")).toBe("#photo-credit-abukuma");
        expect(empty.getAttribute("data-photo")).toBe("0");
        expect(empty.querySelector("img")).toBeNull();
    });

    it("県の頁: 写真が読めなければ名前だけの札に替わり、© も消える（出典の一覧は残す）", () => {
        renderArea();
        const img = screen.getAllByTestId("spot-card")[0].querySelector("img")!;
        fireEvent.error(img);
        const card = screen.getAllByTestId("spot-card")[0];
        expect(card.getAttribute("data-photo")).toBe("0");
        expect(card.querySelector("img")).toBeNull();
        expect(screen.getAllByText("あぶくま洞").length).toBe(2 + 1);   // 札の箱・札の名前・出典の一覧
        expect(screen.queryByTestId("credit-mark")).toBeNull();
        expect(screen.getByTestId("photo-credits")).toBeTruthy();
    });

    it("🔴 水和の前に読み損ねた写真（付いた時点で壊れている）も、確かめてから名前だけの札に替える", async () => {
        // 同じ場所をもう1回読むと失敗する（本物のブラウザで写真が届かないとき）
        class FailingImage { onerror: (() => void) | null = null; set src(_v: string) { queueMicrotask(() => this.onerror?.()); } }
        vi.stubGlobal("Image", FailingImage);
        renderArea();
        await waitFor(() => expect(screen.getAllByTestId("spot-card")[0].getAttribute("data-photo")).toBe("0"));
    });

    it("確かめの読み直しが何も言わなければ（読めた・まだ）、写真の札のまま", async () => {
        class SilentImage { onerror: (() => void) | null = null; set src(_v: string) { /* 何も起きない */ } }
        vi.stubGlobal("Image", SilentImage);
        renderArea();
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.getAllByTestId("spot-card")[0].getAttribute("data-photo")).toBe("1");
    });

    it("/spots: 県・国・いまの季節の札も、読めなければ名前だけの札（件数は残る）", () => {
        const AREAS: SpotArea[] = [
            { slug: "hokkaido", name: "北海道", nameEn: "Hokkaido", region: "北海道", count: 41, publishedCount: 41 },
            { slug: "aomori", name: "青森県", nameEn: "Aomori", region: "東北", count: 3, publishedCount: 3 },
            { slug: "overseas", name: "海外", nameEn: "Outside Japan", region: null, count: 5, publishedCount: 5 },
        ];
        const credit = { author: "A", license: "CC BY-SA 3.0" };
        const photos: SpotIndexPhotos = {
            areaCovers: { hokkaido: { src: "/h.jpg", creditKey: "akan", creditName: "阿寒湖" } },
            countries: [{ code: "fr", name: "フランス", nameEn: "France", href: "/spots/area/overseas/fr", count: 5, cover: { src: "/f.jpg" } }],
            countryTotal: 60,
            seasonal: { season: "autumn", href: "/spots/season/autumn", total: 9, spots: [{ slug: "akan", name: "阿寒湖", region: "北海道 釧路市", cover: { src: "/h.jpg", creditKey: "akan", creditName: "阿寒湖" } }] },
            credits: [{ key: "akan", name: "阿寒湖", credit }],
        };
        const { container } = render(<LocaleProvider><SpotAreaIndexClient areas={AREAS} total={49} draftCount={0} photos={photos} /></LocaleProvider>);
        const tile = (slug: string) => container.querySelector(`a[data-testid="spots-area-tile"][href="/spots/area/${slug}"]`)!;
        const hk = tile("hokkaido");
        expect(hk.getAttribute("data-photo")).toBe("1");
        // 写真の無い県は最初から名前だけ
        expect(tile("aomori").getAttribute("data-photo")).toBe("0");
        // 北海道と青森県は同じ節
        expect(hk.closest("section")).toBe(tile("aomori").closest("section"));
        // 🔴 読み上げは名前と件数だけ（写真の代替文「阿寒湖」を混ぜない）。© は写っているスポット（県）
        expect(screen.getByRole("link", { name: /^北海道\s*41$/ })).toBe(hk);
        // 棚の札は「阿寒湖 北海道 釧路市」（名前を2回読まない）
        expect(screen.getByRole("link", { name: /^阿寒湖\s*北海道 釧路市$/ }).getAttribute("data-testid")).toBe("season-shelf-card");
        expect(screen.getByRole("link", { name: "写真の出典: 阿寒湖（北海道）" })).toBeTruthy();
        // 棚の札は写っているスポットそのものなので、名前だけ
        expect(screen.getByRole("link", { name: "写真の出典: 阿寒湖" })).toBeTruthy();
        const imgs = [...container.querySelectorAll("img")];
        expect(imgs).toHaveLength(3);
        for (const img of imgs) expect(img.getAttribute("alt")).toBe("");
        for (const img of imgs) fireEvent.error(img);
        expect(hk.getAttribute("data-photo")).toBe("0");
        expect(hk.textContent).toContain("41");
        expect(screen.getByTestId("spots-country-tile").getAttribute("data-photo")).toBe("0");
        expect(screen.getByTestId("season-shelf-card").getAttribute("data-photo")).toBe("0");
        expect(container.querySelectorAll("img")).toHaveLength(0);
        expect(screen.queryAllByTestId("credit-mark")).toHaveLength(0);
        // 出典の一覧は残る
        expect(screen.getByTestId("photo-credit-item").id).toBe("photo-credit-akan");
        expect(screen.getByTestId("spots-all-countries").textContent).toContain("すべての国・地域（60）");
    });
});
