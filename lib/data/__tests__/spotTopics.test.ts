import { describe, it, expect } from "vitest";
import { SPOTS, type Spot } from "../spots";
import {
    CATEGORY_SLUGS, REGION_SLUGS, MIN_TOPIC_SPOTS, MIN_INDEXABLE_COUNTRY, SEASONS,
    topicSpots, countryTopics, themeTopics, seasonTopics, cityTopics, seasonThemeTopics, momijiTopics, momijiView, hasSeasonKeyword, MOMIJI_TOP_CARDS,
    featureTopics, featureView, FEATURE_KEYS, FEATURES, type FeatureKey,
    countryView, themeView, seasonView, overseasView, cityView, seasonThemeView, cityLinksForPrefecture,
    topicStructuredData, topicTitle, topicMetadata, topicLinksForSpot, spotIndexTopics,
    homeSeasonalSpots, seasonOfMonth, SEASON_TOP_CARDS, spotTopicSitemapEntries, themePath, seasonPath, areaIntro,
    themeBreakdown, THEME_TITLE_MAX, THEME_DESCRIPTION_MAX,
} from "../spotTopics";
import { prefectureByName, OVERSEAS_SLUG } from "../prefectures";
import { siteConfig, INDEXABLE_ROBOTS } from "../../utils/seo";
import { titleWidth } from "../../utils/titleWidth";

/**
 * **撮影スポットの切り口の頁（国・テーマ・季節）**（2026-10-11）。
 * 本物の台帳で確かめる（`spotSeo.test.ts` と同じ理由）。作り物が要る所は、
 * 公開済みの行を写して項目だけ変える（公開の門を通る行を一から作らない）。
 */

const shown = topicSpots();
const jp = (s: Spot) => s.region?.country === "日本";

/** 公開済みの行を写して、鍵・綴りと指定の項目だけ変える */
let seq = 0;
function clone(base: Spot, patch: Partial<Spot>): Spot {
    seq++;
    return { ...base, spotId: `sp_test${String(seq).padStart(8, "0")}`, slug: `test-topic-${seq}`, ...patch };
}
const kyotoBase = shown.find((s) => s.region?.prefecture === "京都府")!;

describe("前提", () => {
    it("台帳に公開済みの行がある（無いとこのファイルの全部が素通りする）", () => {
        expect(shown.length).toBeGreaterThan(100);
        expect(kyotoBase).toBeTruthy();
    });
});

describe("カテゴリと地方の綴り", () => {
    it("頁になる件数のカテゴリは、全部 URL の綴りを持つ（表に無いと頁が黙って消える）", () => {
        // 表を使わずに数える: 県・地方・国の組で MIN_TOPIC_SPOTS 件以上になるカテゴリ
        const counts = new Map<string, number>();
        for (const s of shown) {
            const c = s.category?.trim();
            if (!c) continue;
            const pref = jp(s) ? prefectureByName(s.region?.prefecture) : null;
            const keys = jp(s) ? [pref?.name, pref?.region] : [s.region?.country];
            for (const k of keys) if (k) counts.set(`${c}|${k}`, (counts.get(`${c}|${k}`) ?? 0) + 1);
        }
        const needed = new Set([...counts].filter(([, n]) => n >= MIN_TOPIC_SPOTS).map(([k]) => k.split("|")[0]));
        const missing = [...needed].filter((c) => !CATEGORY_SLUGS[c]);
        expect(missing).toEqual([]);
        expect(needed.size).toBeGreaterThan(10);
    });

    it("綴りは重ならず、URL にそのまま使える形", () => {
        const slugs = Object.values(CATEGORY_SLUGS);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of [...slugs, ...Object.values(REGION_SLUGS)]) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });
});

describe("テーマ（カテゴリ × 地域）", () => {
    const themes = themeTopics();

    it("どの頁も MIN_TOPIC_SPOTS 件以上・中身は全部そのカテゴリ（薄い頁を作らない）", () => {
        expect(themes.length).toBeGreaterThan(20);
        for (const t of themes) {
            expect(t.spots.length, themePath(t)).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
            for (const s of t.spots) expect(s.category).toBe(t.category);
        }
    });

    it("4件の組は頁にならず、5件で頁になる", () => {
        const four = Array.from({ length: 4 }, () => clone(kyotoBase, { category: "灯台" }));
        expect(themeTopics([...four]).some((t) => t.category === "灯台")).toBe(false);
        const five = [...four, clone(kyotoBase, { category: "灯台" })];
        const got = themeTopics(five).filter((t) => t.category === "灯台").map((t) => themePath(t));
        expect(got).toContain("/spots/theme/lighthouses/kyoto");
    });

    it("URL が重ならない（地方と県が同じ顔ぶれ＝北海道は地方の側を作らない）", () => {
        const paths = themes.map(themePath);
        expect(new Set(paths).size).toBe(paths.length);
        const hokkaido = Array.from({ length: 5 }, () => clone(shown.find((s) => s.region?.prefecture === "北海道")!, { category: "灯台" }));
        const got = themeTopics(hokkaido).map(themePath);
        expect(got).toEqual(["/spots/theme/lighthouses/hokkaido"]);
    });

    it("🔴 どの頁も同じスポットを2回数えない（北海道は県と地方の綴りが同じ）", () => {
        for (const t of themes) {
            const ids = t.spots.map((s) => s.spotId);
            expect(new Set(ids).size, themePath(t)).toBe(ids.length);
        }
        // 北海道の灯台が3件なら、県の頁も地方の頁も作らない（2回数えると6件になって頁ができていた）
        const base = shown.find((s) => s.region?.prefecture === "北海道")!;
        const three = Array.from({ length: 3 }, () => clone(base, { category: "灯台" }));
        expect(themeTopics(three).map(themePath)).toEqual([]);
        const five = [...three, clone(base, { category: "灯台" }), clone(base, { category: "灯台" })];
        const got = themeTopics(five);
        expect(got.map(themePath)).toEqual(["/spots/theme/lighthouses/hokkaido"]);
        expect(got[0].spots).toHaveLength(5);
        expect(got[0].place.kind).toBe("prefecture");
    });

    it("1県だけで埋まる地方の頁は作らない（京都府だけの近畿の灯台＝県の頁と同じ顔ぶれ）", () => {
        const five = Array.from({ length: 5 }, () => clone(kyotoBase, { category: "灯台" }));
        expect(themeTopics(five).map(themePath)).toEqual(["/spots/theme/lighthouses/kyoto"]);
        // 2県にまたがれば地方の頁もできる
        const nara = shown.find((s) => s.region?.prefecture === "奈良県")!;
        const mixed = [...five, clone(nara, { category: "灯台" })];
        expect(themeTopics(mixed).map(themePath)).toEqual(["/spots/theme/lighthouses/kyoto", "/spots/theme/lighthouses/kinki"]);
    });

    it("県・地方・国の3段がそろう（京都府の寺社・近畿の寺社・フランスの教会）", () => {
        const paths = themes.map(themePath);
        expect(paths).toContain("/spots/theme/temples-shrines/kyoto");
        expect(paths).toContain("/spots/theme/temples-shrines/kinki");
        expect(paths).toContain("/spots/theme/churches/fr");
    });

    it("頁の題・導入文はデータの事実（件数と先頭のスポット名）", () => {
        const v = themeView("temples-shrines", "kyoto")!;
        const n = shown.filter((s) => s.category === "寺社" && s.region?.prefecture === "京都府").length;
        expect(v.heading).toBe("京都府の寺社の撮影スポット");
        // 2026-11-11（#527）: 題の後ろに載っている名所の名前（並びの先頭から・全角33以内）
        expect(topicTitle(v).startsWith(`京都府の寺社の撮影スポット${n}選｜${v.cards[0].name}`)).toBe(true);
        expect(v.intro).toContain(`${n}件`);
        expect(v.intro).toContain(v.cards[0].name);
        // パンくずは県の一覧を通る
        expect(v.crumbs).toEqual([{ name: "京都府", nameEn: "Kyoto", href: "/spots/area/kyoto" }]);
        expect(v.headingEn).toBe("Temples & shrines photo spots in Kyoto");
    });

    it("在らない組は null（頁を作らない）", () => {
        expect(themeView("temples-shrines", "nowhere")).toBeNull();
        expect(themeView("no-such-category", "kyoto")).toBeNull();
    });
});

describe("国", () => {
    const countries = countryTopics();

    it("海外の公開済みの行は、ちょうど1つの国の頁に入る", () => {
        const overseas = shown.filter((s) => !jp(s));
        expect(countries.reduce((n, c) => n + c.spots.length, 0)).toBe(overseas.length);
        const ids = countries.flatMap((c) => c.spots.map((s) => s.spotId));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("🔴 `/spots/area/overseas` は国の一覧で、スポットのカードを積まない（814件 1.3MB に戻さない）", () => {
        const v = overseasView();
        expect(v.cards).toEqual([]);
        expect(v.related[0].links.length).toBe(countries.length);
        expect(v.related[0].links[0]).toMatchObject({ href: `/spots/area/overseas/${countries[0].code}`, count: countries[0].spots.length });
        // 構造化データは並べている国のリンク
        const { itemList } = topicStructuredData(v);
        expect(itemList?.itemListElement.length).toBe(countries.length);
    });

    it("1件の国は頁を建てるが検索に出さない（noindex・サイトマップ外）", () => {
        const one = countries.find((c) => c.spots.length < MIN_INDEXABLE_COUNTRY);
        expect(one, "1件の国が台帳から消えたらこの項は別の作り物で確かめる").toBeTruthy();
        const v = countryView(one!.code)!;
        expect(v.indexable).toBe(false);
        expect(topicMetadata(v).robots).toEqual({ index: false, follow: true });
        expect(spotTopicSitemapEntries().map((e) => e.url)).not.toContain(`${siteConfig.url}/spots/area/overseas/${one!.code}`);
        const big = countryView("fr")!;
        expect(big.indexable).toBe(true);
        expect(topicMetadata(big).robots).toEqual(INDEXABLE_ROBOTS);
        expect(topicMetadata(big).alternates?.canonical).toBe(`${siteConfig.url}/spots/area/overseas/fr`);
    });

    it("国の頁のパンくずは 海外 → 国", () => {
        const { breadcrumb } = topicStructuredData(countryView("fr")!);
        expect(breadcrumb.itemListElement.map((x) => x.name)).toEqual(["ホーム", "撮影スポット", "海外", "フランスの撮影スポット"]);
    });
});

describe("季節", () => {
    const seasons = seasonTopics();

    it("載るのはその季節の案内を持つスポットだけ・地方別は MIN_TOPIC_SPOTS 件以上", () => {
        expect(seasons.filter((t) => t.area === null).map((t) => t.season)).toEqual([...SEASONS]);
        for (const t of seasons) {
            for (const s of t.spots) expect(s.seasonalGuide?.some((g) => g.season === t.season), `${seasonPath(t)} ${s.slug}`).toBe(true);
            if (t.area) expect(t.spots.length).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
        }
        expect(seasons.map(seasonPath)).toContain("/spots/season/autumn/kinki");
    });

    it("季節の案内の無い行は、どの季節の頁にも載らない", () => {
        const none = clone(kyotoBase, { seasonalGuide: undefined });
        const one = clone(kyotoBase, { seasonalGuide: [{ season: "winter", text: "雪" }] });
        const got = seasonTopics([none, one]);
        expect(got.map((t) => [t.season, t.spots.map((s) => s.slug)])).toEqual([["winter", [one.slug]]]);
    });

    it("🔴 全体の頁は並べる数を絞る（600KB に戻さない）が、どの行もどこかの季節の頁に載る", () => {
        for (const season of SEASONS) {
            const top = seasonView(season, null)!;
            const all = seasons.find((t) => t.season === season && t.area === null)!;
            const subs = seasons.filter((t) => t.season === season && t.area !== null);
            const onSub = new Set(subs.flatMap((t) => t.spots.map((s) => s.slug)));
            const orphans = all.spots.filter((s) => !onSub.has(s.slug)).length;
            expect(top.cards.length, season).toBeLessThanOrEqual(Math.max(SEASON_TOP_CARDS, orphans));
            const reachable = new Set([...onSub, ...top.cards.map((c) => c.slug)]);
            expect(all.spots.filter((s) => !reachable.has(s.slug)).map((s) => s.slug), season).toEqual([]);
            if (all.spots.length > top.cards.length) expect(top.intro).toContain(`${all.spots.length}件あります`);
        }
    });

    it("🔴 季節の語は、その季節の案内の中だけを数える（春の案内の「紅葉」を秋に数えない）", () => {
        const kinki = Array.from({ length: 5 }, () => clone(kyotoBase, { seasonalGuide: [{ season: "autumn", text: "落ち着いた色" }] }));
        const wrongSeason = clone(kyotoBase, { seasonalGuide: [{ season: "autumn", text: "静か" }, { season: "spring", text: "紅葉の若葉" }] });
        const right = clone(kyotoBase, { seasonalGuide: [{ season: "autumn", text: "紅葉が見事" }] });
        const v = seasonView("autumn", "kinki", [...kinki, wrongSeason, right])!;
        expect(v.intro).toContain("うち1件は秋の案内に「紅葉」の記述があります");
    });

    it("🔴 全体の頁の並びは、季節の語のある行が先で、地方を均す（読み順の先頭にしない）", () => {
        const v = seasonView("autumn", null)!;
        const all = seasons.find((t) => t.season === "autumn" && t.area === null)!;
        const bySlug = new Map(all.spots.map((s) => [s.slug, s]));
        const firstSix = v.cards.slice(0, 6).map((c) => bySlug.get(c.slug)!);
        // 先頭の6件は、写真があり「紅葉」の案内のある行（地方ごとに1件ずつ回すので、地方が重ならない）
        for (const s of firstSix) expect(s.seasonalGuide!.some((g) => g.season === "autumn" && g.text.includes("紅葉")), s.slug).toBe(true);
        const regionOf = (s: Spot) => (s.region?.country === "日本" ? prefectureByName(s.region?.prefecture)?.region : "海外");
        expect(new Set(firstSix.map(regionOf)).size).toBe(6);
        // OGP は元の写真（サムネではない）。2026-10-22: 横 1,200px 以上の版（Commons の 1280px）があればそれ
        expect(v.ogImage?.src).toBeTruthy();
        expect(v.ogImage!.src).not.toContain("/images/spots/thumb/");
        expect(v.ogImage!.width).toBeGreaterThanOrEqual(1200);
        const abs = v.ogImage!.src.startsWith("http") ? v.ogImage!.src : `${siteConfig.url}${v.ogImage!.src}`;
        expect(topicMetadata(v).openGraph?.images?.[0].url).toBe(abs);
    });

    it("秋の導入文は「紅葉」の記述の件数を数える（題には使わない）", () => {
        const v = seasonView("autumn", "kinki")!;
        expect(v.heading).toBe("近畿地方（関西）の秋の撮影スポット");
        expect(v.intro).toMatch(/うち\d+件は秋の案内に「紅葉」の記述があります/);
        expect(v.crumbs).toEqual([{ name: "秋の撮影スポット", nameEn: "Autumn photo spots", href: "/spots/season/autumn" }]);
    });
});

describe("説明（description）", () => {
    it("🔴 決まり文句（見どころ・季節・時間帯の撮影ガイドつき）を足さない・時間帯の件数は数えた分だけ", () => {
        for (const v of [themeView("temples-shrines", "kyoto")!, countryView("fr")!, seasonView("autumn", "kinki")!, overseasView()]) {
            const d = topicMetadata(v).description!;
            expect(d).not.toContain("撮影ガイドつき");
            // テーマの頁は自分の説明（`themeDescription`・#527）。ほかは導入文の頭のまま
            if (v.path.startsWith("/spots/theme/")) expect(d).toBe(v.description);
            else expect(d.startsWith(v.intro.slice(0, 40))).toBe(true);
        }
        const v = countryView("fr")!;
        const n = shown.filter((s) => s.region?.country === "フランス" && (s.timeOfDayGuide ?? []).length > 0).length;
        if (n > 0) expect(v.descriptionExtra).toBe(`時間帯ごとの撮影の案内があるのは${n}件です。`);
        else expect(v.descriptionExtra).toBeUndefined();
    });

    it("海外の区画の頁の題・説明は国の一覧のもの（814選と名乗らない）", async () => {
        const { generateMetadata } = await import("../../../app/spots/area/[area]/page");
        const m = await generateMetadata({ params: Promise.resolve({ area: "overseas" }) });
        expect(m.title).toBe("海外の撮影スポット");
        expect(String(m.description)).toContain("の国・地域に分けています");
    });
});

describe("並べ方・構造化データ", () => {
    it("代表写真のあるカードが先・ItemList は画面と同じ順と URL", () => {
        const v = themeView("temples-shrines", "kinki")!;
        const firstNoCover = v.cards.findIndex((c) => !c.cover);
        if (firstNoCover >= 0) expect(v.cards.slice(firstNoCover).every((c) => !c.cover)).toBe(true);
        expect(v.cards.some((c) => c.cover)).toBe(true);
        const { itemList } = topicStructuredData(v);
        expect(itemList?.itemListElement.map((x) => x.url)).toEqual(v.cards.map((c) => `${siteConfig.url}/spots/${c.slug}`));
    });

    it("CC BY 系の写真は作者とライセンスの文字を持つ", () => {
        const withCredit = themeView("temples-shrines", "kinki")!.cards.filter((c) => c.cover?.credit);
        expect(withCredit.length).toBeGreaterThan(0);
        for (const c of withCredit) {
            const cr = c.cover!.credit!;
            expect(cr.author || cr.text, c.slug).toBeTruthy();
            if (cr.license) expect(cr.license, c.slug).toMatch(/CC|Public|PD/i);
        }
        // ライセンス名のある写真は、文面への URL を持つ（スポットの頁と同じ中身）
        expect(withCredit.some((c) => c.cover!.credit!.license && c.cover!.credit!.licenseUrl?.startsWith("https://creativecommons.org/"))).toBe(true);
    });
});

describe("内部リンク（スポットの頁 → 切り口）", () => {
    it("リンク先の頁は、そのスポットを本当に載せている", () => {
        const sample = shown.filter((_, i) => i % 37 === 0);
        let total = 0;
        for (const spot of sample) {
            for (const l of topicLinksForSpot(spot)) {
                total++;
                const m = /^\/spots\/(?:area\/overseas\/([a-z]+)|theme\/([a-z0-9-]+)\/([a-z0-9-]+)|city\/([a-z0-9-]+)\/([^/]+)|season\/([a-z]+)\/theme\/([a-z0-9-]+)|season\/([a-z]+)(?:\/([a-z0-9-]+))?|(momiji|sakura|snow)(?:\/([a-z0-9-]+))?)$/.exec(l.href);
                expect(m, l.href).toBeTruthy();
                const view = m![10] ? featureView(m![10] as FeatureKey, m![11] ?? null)
                    : m![1] ? countryView(m![1])
                    : m![2] ? themeView(m![2], m![3])
                        : m![4] ? cityView(m![4], decodeURIComponent(m![5]))
                            : m![6] ? seasonThemeView(m![6], m![7])
                                : seasonView(m![8], m![9] ?? null);
                expect(view?.cards.map((c) => c.slug), `${spot.slug} → ${l.href}`).toContain(spot.slug);
            }
        }
        expect(total).toBeGreaterThan(20);
    });

    it("京都府の寺社のスポットは県と地方のテーマへ、海外の行は国へ張る", () => {
        const kyotoTemple = shown.find((s) => s.category === "寺社" && s.region?.prefecture === "京都府")!;
        const hrefs = topicLinksForSpot(kyotoTemple).map((l) => l.href);
        expect(hrefs).toEqual(expect.arrayContaining(["/spots/theme/temples-shrines/kyoto", "/spots/theme/temples-shrines/kinki"]));
        const fr = shown.find((s) => s.region?.country === "フランス")!;
        expect(topicLinksForSpot(fr)[0]).toMatchObject({ href: "/spots/area/overseas/fr", label: "フランスの撮影スポット" });
    });

    it("公開済みでない行には張らない", () => {
        const draft = { ...kyotoBase, status: "review" as const, verifiedBy: undefined, aiCheck: undefined };
        expect(topicLinksForSpot(draft, [draft])).toEqual([]);
    });
});

describe("`/spots` の入口・サイトマップ", () => {
    it("季節4つとテーマの全部へのリンクを持つ", () => {
        const { seasons, themes } = spotIndexTopics();
        expect(seasons.map((l) => l.href)).toEqual(SEASONS.map((s) => `/spots/season/${s}`));
        expect(themes.flatMap((g) => g.links).length).toBe(themeTopics().length);
    });

    it("サイトマップは国（2件以上）・テーマ・季節を全部持ち、日付はビルドの時刻ではなくスポットの更新日", () => {
        const entries = spotTopicSitemapEntries("https://x.test");
        const urls = entries.map((e) => e.url);
        expect(new Set(urls).size).toBe(urls.length);
        expect(urls).toContain("https://x.test/spots/theme/temples-shrines/kyoto");
        expect(urls).toContain("https://x.test/spots/season/autumn/kinki");
        expect(urls).toContain("https://x.test/spots/area/overseas/fr");
        expect(entries.length).toBe(
            countryTopics().filter((c) => c.spots.length >= MIN_INDEXABLE_COUNTRY).length + themeTopics().length + seasonTopics().length
            + cityTopics().length + seasonThemeTopics().length
            + FEATURE_KEYS.reduce((n, f) => n + featureTopics(f).length, 0));
        const fr = entries.find((e) => e.url.endsWith("/overseas/fr"))!;
        const latest = countryTopics().find((c) => c.code === "fr")!.spots.map((s) => s.updatedAt).sort().pop();
        expect(fr.lastModified).toBe(latest);
    });

    it("`lib/server/sitemap.ts` が切り口の頁を載せている", async () => {
        const sitemap = (await import("../../server/sitemap")).allSitemapEntries;
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${siteConfig.url}/spots/theme/temples-shrines/kyoto`);
        expect(urls).toContain(`${siteConfig.url}/spots/season/spring`);
    }, 30_000); // サイトマップは写真・台帳を全部読む（`mapMetadata.test.ts` は develop でも5秒前後）
});

describe("ホーム: いまの季節の撮影スポット", () => {
    it("月で季節が決まる（日本時間）", () => {
        expect([1, 2, 3, 5, 6, 8, 9, 11, 12].map(seasonOfMonth)).toEqual(
            ["winter", "winter", "spring", "spring", "summer", "summer", "autumn", "autumn", "winter"]);
        // 9/30 15:00 UTC は日本の 10/1 0:00＝秋。8/31 14:59 UTC は日本の 8/31＝夏
        expect(homeSeasonalSpots(new Date("2026-08-31T14:59:00Z"))?.season).toBe("summer");
        expect(homeSeasonalSpots(new Date("2026-11-30T15:00:00Z"))?.season).toBe("winter");
    });

    it("その季節の案内と代表写真がある行だけ・南半球は外す・同じ月なら同じ顔ぶれ", () => {
        const now = new Date("2026-10-11T00:00:00Z");
        const h = homeSeasonalSpots(now)!;
        expect(h.season).toBe("autumn");
        expect(h.href).toBe("/spots/season/autumn");
        expect(h.spots.length).toBe(6);
        for (const x of h.spots) {
            const s = shown.find((y) => y.slug === x.slug)!;
            expect(s.seasonalGuide?.some((g) => g.season === "autumn")).toBe(true);
            expect(x.src).toMatch(/^\/images\/spots\//);
            expect(s.coords?.lat ?? 1).toBeGreaterThan(0);
        }
        expect(homeSeasonalSpots(new Date("2026-10-30T00:00:00Z"))!.spots).toEqual(h.spots);
        // 南半球の行は、秋の案内と写真があっても出ない
        const withPhoto = shown.find((s) => h.spots[0].slug === s.slug)!;
        const south = clone(withPhoto, { coords: { lat: -33.9, lng: 151.2 }, slug: withPhoto.slug });
        expect(homeSeasonalSpots(now, [south])).toBeNull();
    });

    it("渡すのは名前・場所・写真の場所だけ（台帳の本文を積まない）", () => {
        const h = homeSeasonalSpots(new Date("2026-10-11T00:00:00Z"))!;
        for (const x of h.spots) expect(Object.keys(x).sort()).toEqual(["alt", "credit", "name", "region", "slug", "src"]);
        expect(JSON.stringify(h).length).toBeLessThan(3000);
    });
});

describe("区画（`/spots/area/<x>`）との関係", () => {
    it("海外の区画の綴りは国の頁の親", () => {
        expect(countryView("fr")!.path.startsWith(`/spots/area/${OVERSEAS_SLUG}/`)).toBe(true);
    });

    it("全体の頁の数（報告に使う）が台帳の伸びに比べて大きくなりすぎない", () => {
        const pages = countryTopics().length + themeTopics().length + seasonTopics().length;
        // 2026-10-11: 国54・テーマ115（北海道の二重数えを直した後）・季節36＝205枚（スポットの頁は約1,800枚）
        expect(pages).toBeLessThan(shown.length / 4);
    });
});

void SPOTS;

describe("市区町村の頁（2026-11-05）", () => {
    it("頁は日本の市区町村で MIN_TOPIC_SPOTS 件以上・中身は全部その県その市区町村（薄い頁を作らない）", () => {
        const all = cityTopics();
        expect(all.length).toBeGreaterThan(20);
        for (const t of all) {
            expect(t.spots.length, `${t.prefName}${t.city}`).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
            for (const s of t.spots) {
                expect(jp(s)).toBe(true);
                expect(s.region?.city).toBe(t.city);
                expect(prefectureByName(s.region?.prefecture)?.slug).toBe(t.prefSlug);
            }
        }
    });

    it("同じ名前の市が別の県にあっても混ぜない（県＋市区町村で1つ）・URL が重ならない", () => {
        const urls = cityTopics().map((t) => t.prefSlug + "/" + t.city);
        expect(new Set(urls).size).toBe(urls.length);
        // 4件の市は頁にならない（件数の線）
        const base = shown.find((s) => s.region?.prefecture === "京都府")!;
        const fake = Array.from({ length: 4 }, () => clone(base, { region: { country: "日本", prefecture: "京都府", city: "架空市" } }));
        expect(cityTopics([...shown, ...fake]).some((t) => t.city === "架空市")).toBe(false);
        expect(cityTopics([...shown, ...fake, clone(base, { region: { country: "日本", prefecture: "京都府", city: "架空市" } })]).some((t) => t.city === "架空市")).toBe(true);
    });

    it("頁の題は「N選」・導入文はデータの事実・パンくずは県", () => {
        const t = cityTopics()[0];
        const v = cityView(t.prefSlug, t.city)!;
        expect(v.heading).toBe(`${t.prefName}${t.city}の撮影スポット`);
        expect(topicTitle(v)).toBe(`${v.heading}${v.cards.length}選`);
        expect(v.intro).toContain(`${t.spots.length}件`);
        expect(v.crumbs[0].href).toBe(`/spots/area/${t.prefSlug}`);
        expect(v.cards.map((c) => c.slug).sort()).toEqual(t.spots.map((s) => s.slug).sort());
        expect(cityView("kyoto", "存在しない市")).toBeNull();
    });

    it("県の頁へ張る市区町村のリンクは、頁がある市区町村だけ", () => {
        const t = cityTopics()[0];
        const links = cityLinksForPrefecture(t.prefSlug);
        expect(links.map((l) => l.href)).toContain(`/spots/city/${t.prefSlug}/${encodeURIComponent(t.city)}`);
        expect(links.length).toBe(cityTopics().filter((x) => x.prefSlug === t.prefSlug).length);
    });
});

describe("季節 × 種類の頁（2026-11-05）", () => {
    it("頁はその季節の案内を持つ行のうち、そのカテゴリの MIN_TOPIC_SPOTS 件以上", () => {
        const all = seasonThemeTopics();
        expect(all.length).toBeGreaterThan(20);
        for (const t of all) {
            expect(t.spots.length).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
            for (const s of t.spots) {
                expect(s.category).toBe(t.category);
                expect((s.seasonalGuide ?? []).some((g) => g?.season === t.season)).toBe(true);
            }
        }
    });

    it("題は「春の寺社の撮影スポットN選」の形・URL は季節/theme/カテゴリ・同じ頁が2枚にならない", () => {
        const t = seasonThemeTopics()[0];
        const v = seasonThemeView(t.season, t.categorySlug)!;
        expect(v.path).toBe(`/spots/season/${t.season}/theme/${t.categorySlug}`);
        expect(topicTitle(v)).toMatch(/^[春夏秋冬]の.+の撮影スポット\d+選$/);
        const paths = seasonThemeTopics().map((x) => x.season + "/" + x.categorySlug);
        expect(new Set(paths).size).toBe(paths.length);
        expect(seasonThemeView("autumn", "zzz")).toBeNull();
    });

    it("季節の全体の頁と入口から、種類の頁に辿れる", () => {
        const t = seasonThemeTopics()[0];
        const top = seasonView(t.season, null)!;
        expect(top.related.flatMap((g) => g.links.map((l) => l.href))).toContain(`/spots/season/${t.season}/theme/${t.categorySlug}`);
        expect(spotIndexTopics().seasonThemes.length).toBe(seasonThemeTopics().length);
        expect(spotIndexTopics().cities.length).toBe(cityTopics().length);
    });
});

describe("紅葉の頁（2026-11-06）", () => {
    it("まとめ1枚＋地方・県。載るのは日本の、秋の案内に「紅葉」の語があるスポットだけ", () => {
        const all = momijiTopics();
        expect(all.filter((t) => t.place === null).length).toBe(1);
        const hub = all.find((t) => t.place === null)!;
        expect(hub.spots.length).toBeGreaterThan(30);
        for (const s of hub.spots) {
            expect(jp(s)).toBe(true);
            expect(hasSeasonKeyword(s, "autumn")).toBe(true);
        }
        // 地方・県の頁は MIN_TOPIC_SPOTS 件以上・まとめの部分集合
        const hubIds = new Set(hub.spots.map((s) => s.spotId));
        for (const t of all.filter((x) => x.place)) {
            expect(t.spots.length, t.place!.name).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
            for (const s of t.spots) expect(hubIds.has(s.spotId)).toBe(true);
        }
    });

    it("綴りが重ならない（北海道は県と地方が同じ綴り＝県だけ）", () => {
        const slugs = momijiTopics().filter((t) => t.place).map((t) => t.place!.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    it("🔴 まとめの頁は並べる数を絞る（600KB に戻さない）が、地方・県の頁が無い行は全部載せ、どの行もどこかの紅葉の頁に載る", () => {
        const hubView = momijiView(null)!;
        const all = momijiTopics();
        const subs = all.filter((t) => t.place);
        const inSub = new Set(subs.flatMap((t) => t.spots.map((s) => s.slug)));
        const hub = all.find((t) => t.place === null)!;
        const orphans = hub.spots.filter((s) => !inSub.has(s.slug));
        expect(hubView.cards.length).toBeLessThanOrEqual(Math.max(MOMIJI_TOP_CARDS, orphans.length));
        const shown = new Set(hubView.cards.map((c) => c.slug));
        for (const s of orphans) expect(shown.has(s.slug), s.slug).toBe(true);
    });

    it("題は「…の紅葉の撮影スポットN選」・導入文は数えた事実・見頃の日付は書かない", () => {
        const v = momijiView(null)!;
        expect(v.heading).toBe("紅葉の撮影スポット");
        expect(topicTitle(v)).toBe(`紅葉の撮影スポット${v.cards.length}選`);
        // まとめの頁は一部だけ並べる＝全体の数と、並べた数（題の「N選」）を分けて言う（2026-11-11・#527）
        const n = momijiTopics().find((t) => t.place === null)!.spots.length;
        expect(v.cards.length).toBeLessThan(n);
        expect(v.intro).toContain(`「紅葉」の記述があるスポットは${n}件あります。`);
        expect(v.intro).toContain(`${v.cards.length}件を載せ`);
        expect(v.intro + (v.descriptionExtra ?? "")).not.toMatch(/見頃|\d+月|例年/);
        const sub = momijiTopics().find((t) => t.place)!;
        const sv = momijiView(sub.place!.slug)!;
        expect(sv.heading).toBe(`${sub.place!.name}の紅葉の撮影スポット`);
        expect(sv.crumbs[0].href).toBe("/spots/momiji");
        expect(sv.cards.map((c) => c.slug).sort()).toEqual(sub.spots.map((s) => s.slug).sort());
        expect(momijiView("nowhere")).toBeNull();
    });

    it("入口（/spots）とサイトマップに出る", () => {
        expect(spotIndexTopics().momiji.length).toBe(momijiTopics().length);
        const urls = spotTopicSitemapEntries("https://x.test").map((e) => e.url);
        expect(urls).toContain("https://x.test/spots/momiji");
    });
});

// 桜（春）・雪景色（冬）は紅葉と同じ作り（2026-11-07）。紅葉の組み立てを共通にしたので、3つ全部に同じ決まりを掛ける
describe.each([
    ["sakura", "spring", "桜", "桜の撮影スポット", "/spots/sakura"],
    ["snow", "winter", "雪", "雪景色の撮影スポット", "/spots/snow"],
    ["momiji", "autumn", "紅葉", "紅葉の撮影スポット", "/spots/momiji"],
] as const)("見どころ別の頁: %s", (key, season, kw, hubHeading, hubPath) => {
    it("載るのは日本の、その季節の案内にその語があるスポットだけ。地方・県は MIN_TOPIC_SPOTS 件以上の部分集合", () => {
        expect(FEATURES[key].season).toBe(season);
        expect(FEATURES[key].keyword).toBe(kw);
        const all = featureTopics(key);
        const hub = all.find((t) => t.place === null)!;
        expect(all.filter((t) => t.place === null).length).toBe(1);
        expect(hub.spots.length).toBeGreaterThan(30);
        for (const s of hub.spots) {
            expect(jp(s)).toBe(true);
            expect(hasSeasonKeyword(s, season)).toBe(true);
            // **その季節の項目の本文**にある（別の季節の項目の「雪」「桜」では拾わない）
            expect((s.seasonalGuide ?? []).some((g) => g.season === season && g.text.includes(kw))).toBe(true);
        }
        const hubIds = new Set(hub.spots.map((s) => s.spotId));
        for (const t of all.filter((x) => x.place)) {
            expect(t.spots.length, t.place!.name).toBeGreaterThanOrEqual(MIN_TOPIC_SPOTS);
            for (const s of t.spots) expect(hubIds.has(s.spotId)).toBe(true);
        }
        const slugs = all.filter((t) => t.place).map((t) => t.place!.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    it("題・道・パンくず・導入文（見頃や積雪・開花の日付は書かない）", () => {
        const v = featureView(key, null)!;
        expect(v.heading).toBe(hubHeading);
        expect(v.path).toBe(hubPath);
        expect(topicTitle(v)).toBe(`${hubHeading}${v.cards.length}選`);
        const total = featureTopics(key).find((t) => t.place === null)!.spots.length;
        expect(v.intro).toContain(v.cards.length < total ? `「${kw}」の記述があるスポットは${total}件あります。` : `「${kw}」の記述があるスポットを`);
        expect(v.intro + (v.descriptionExtra ?? "")).not.toMatch(/見頃|\d+月|例年|撮りどき|注目スポット|撮影地ガイド/);
        const sub = featureTopics(key).find((t) => t.place)!;
        const sv = featureView(key, sub.place!.slug)!;
        expect(sv.path).toBe(`${hubPath}/${sub.place!.slug}`);
        expect(sv.heading).toBe(`${sub.place!.name}の${hubHeading}`);
        expect(sv.crumbs[0].href).toBe(hubPath);
        expect(sv.cards.map((c) => c.slug).sort()).toEqual(sub.spots.map((s) => s.slug).sort());
        expect(featureView(key, "nowhere")).toBeNull();
    });

    it("まとめの頁は並べる数を絞るが、地方・県の頁が無い行は全部載せる", () => {
        const all = featureTopics(key);
        const inSub = new Set(all.filter((t) => t.place).flatMap((t) => t.spots.map((s) => s.slug)));
        const orphans = all.find((t) => t.place === null)!.spots.filter((s) => !inSub.has(s.slug));
        const hubView = featureView(key, null)!;
        expect(hubView.cards.length).toBeLessThanOrEqual(Math.max(MOMIJI_TOP_CARDS, orphans.length));
        const shown = new Set(hubView.cards.map((c) => c.slug));
        for (const s of orphans) expect(shown.has(s.slug), s.slug).toBe(true);
    });

    it("入口（/spots）・サイトマップ・スポットの頁からのリンクに出る", () => {
        expect(spotIndexTopics()[key].length).toBe(featureTopics(key).length);
        const urls = spotTopicSitemapEntries("https://x.test").map((e) => e.url);
        expect(urls).toContain(`https://x.test${hubPath}`);
        const spot = featureTopics(key).find((t) => t.place === null)!.spots[0];
        expect(topicLinksForSpot(spot).map((l) => l.href).some((h) => h === hubPath || h.startsWith(`${hubPath}/`))).toBe(true);
    });
});

describe("見どころ別の頁どうし", () => {
    it("3つの見どころは別の綴り・別の題で、まとめの頁から互いに行き来できる", () => {
        const heads = FEATURE_KEYS.map((k) => featureView(k, null)!.heading);
        expect(new Set(heads).size).toBe(FEATURE_KEYS.length);
        const sakura = featureView("sakura", null)!;
        const hrefs = sakura.related.flatMap((g) => g.links.map((l) => l.href));
        expect(hrefs).toEqual(expect.arrayContaining(["/spots/momiji", "/spots/snow"]));
    });

    it("紅葉の頁は従来のまま（URL・題・パンくず）", () => {
        expect(momijiView(null)!.path).toBe("/spots/momiji");
        expect(momijiView(null)!.headingEn).toBe("Autumn foliage photo spots");
        expect(momijiView(null)!.crumbs).toEqual([]);
    });
});

describe("季節の語の判定（固有名詞で拾わない・2026-11-07）", () => {
    const withGuide = (season: "spring" | "winter" | "autumn", text: string) => ({ ...kyotoBase, seasonalGuide: [{ season, text }] });
    it("桜島・若桜・桜井・芝桜・大雪山だけの案内は、桜・雪の語として数えない。桜・雪そのものは数える", () => {
        for (const t of ["桜島を望む朝の海岸です。", "若桜の町並みを歩きます。", "桜井の町から登ります。", "芝桜の丘が広がります。"]) {
            expect(hasSeasonKeyword(withGuide("spring", t), "spring"), t).toBe(false);
        }
        expect(hasSeasonKeyword(withGuide("winter", "大雪山の稜線を歩きます。"), "winter")).toBe(false);
        expect(hasSeasonKeyword(withGuide("spring", "桜島を背に桜が咲きます。"), "spring")).toBe(true);
        expect(hasSeasonKeyword(withGuide("winter", "大雪山の稜線は雪に覆われます。"), "winter")).toBe(true);
        // 別の季節の項目では拾わない
        expect(hasSeasonKeyword(withGuide("autumn", "桜の木が紅葉します。"), "spring")).toBe(false);
    });
});

/**
 * **見どころの頁（紅葉・桜・雪景色）の題と説明**（2026-11-11・札 rymaruta/journey.photo-ios#527）。
 * 本番の HTML で見つけた2つ: 説明に時間帯の件数が2回並ぶ（「うち93件は時間帯ごとの…。時間帯ごとの…のは93件です。」）、
 * 題は「36選」なのに説明は「149件まとめました」。
 */
describe("見どころの頁の題と説明が食い違わない（#527）", () => {
    const views = FEATURE_KEYS.flatMap((k) => featureTopics(k).map((t) => featureView(k, t.place?.slug ?? null)!));

    it("前提: 一部だけ並べる頁と全部並べる頁の両方がある", () => {
        expect(views.length).toBeGreaterThan(FEATURE_KEYS.length);
        expect(views.some((v) => /件を載せ/.test(v.intro))).toBe(true);
        expect(views.some((v) => /件まとめました/.test(v.intro))).toBe(true);
    });

    it("説明に時間帯の件数は1回だけ", () => {
        for (const v of views) {
            const d = topicMetadata(v).description as string;
            expect(d.split("時間帯ごとの撮影の案内").length - 1, v.path).toBeLessThanOrEqual(1);
        }
    });

    it("題の「N選」の N は、説明の「まとめました」か「この頁には…N件を載せ」の N と同じ", () => {
        for (const v of views) {
            const title = topicTitle(v);
            const d = topicMetadata(v).description as string;
            const n = Number(title.match(/(\d+)選$/)![1]);
            const said = d.match(/(\d+)件まとめました/)?.[1] ?? d.match(/など(\d+)件を載せ/)?.[1];
            expect(Number(said), `${v.path}: ${title} / ${d}`).toBe(n);
        }
    });
});

describe("県の頁の導入文（areaIntro・#527）", () => {
    it("台帳から数えた種類・市区町村・季節の件数を書く（京都府）", () => {
        const spots = shown.filter((s) => s.region?.prefecture === "京都府");
        const intro = areaIntro(spots);
        const temples = spots.filter((s) => s.category === "寺社").length;
        expect(temples).toBeGreaterThan(0);
        expect(intro).toContain(`寺社${temples}件`);
        const sakyo = spots.filter((s) => s.region?.city === "京都市左京区").length;
        expect(intro).toContain(`京都市左京区${sakyo}件`);
        const autumn = spots.filter((s) => (s.seasonalGuide ?? []).some((g) => g.season === "autumn")).length;
        expect(intro).toContain(`秋${autumn}件`);
        const momiji = spots.filter((s) => hasSeasonKeyword(s, "autumn")).length;
        if (momiji > 0) expect(intro).toContain(`「紅葉」は${momiji}件`);
        expect(intro).not.toMatch(/撮りどき|見頃|例年|撮影地ガイド/);
    });

    it("県ごとに違う文になる（決まり文句にしない）・2件未満は空", () => {
        const byPref = new Map<string, Spot[]>();
        for (const s of shown.filter(jp)) {
            const p = s.region!.prefecture!;
            byPref.set(p, [...(byPref.get(p) ?? []), s]);
        }
        const intros = [...byPref.values()].filter((l) => l.length >= 2).map((l) => areaIntro(l));
        expect(intros.length).toBeGreaterThan(30);
        expect(new Set(intros).size).toBe(intros.length);
        expect(areaIntro(shown.slice(0, 1))).toBe("");
    });

    it("1件だけの市区町村は「多い」に入れない", () => {
        const a = clone(kyotoBase, { region: { ...kyotoBase.region!, city: "テスト市" }, category: "寺社" });
        const b = clone(kyotoBase, { region: { ...kyotoBase.region!, city: "テスト町" }, category: "寺社" });
        const intro = areaIntro([a, b]);
        expect(intro).not.toContain("多いのは");
        expect(intro).toContain("寺社2件");
    });
});


describe("テーマの頁の題・説明・導入文（2026-11-11・#527 GSC: 8〜13位で押されていない）", () => {
    const themes = themeTopics();
    const views = themes.map((t) => themeView(t.categorySlug, t.place.slug)!);
    const len = (t: string) => [...t].length;

    it("題はサイト名を付けない完全な形（absolute）・全角33以内・載っている名所の名前を入れる", () => {
        const v = themeView("churches", "it")!;
        const m = topicMetadata(v);
        // 以前は「イタリアの教会の撮影スポット54選 | Journey Photo 旅フォトギャラリー」（どの教会かが題に無い）
        expect(m.title).toEqual({ absolute: `イタリアの教会の撮影スポット${v.cards.length}選｜${v.cards[0].name}ほか` });
        expect((m.openGraph as { title?: string }).title).toBe(topicTitle(v));
        for (const x of views) {
            const t = topicTitle(x);
            expect(t.startsWith(`${x.heading}${x.cards.length}選`), x.path).toBe(true);
            // 名前が入らない長さのときは「見出し＋N選」だけ（それより短くは削らない）
            if (t !== `${x.heading}${x.cards.length}選`) expect(titleWidth(t), `${x.path}: ${t}`).toBeLessThanOrEqual(THEME_TITLE_MAX);
            expect(t, x.path).not.toMatch(/Journey Photo|撮りどき/);
        }
        // 名前の入った題が大半（全部が「N選」止まりなら組み方が効いていない）
        expect(views.filter((x) => topicTitle(x).includes("｜")).length / views.length).toBeGreaterThan(0.8);
    });

    it("説明は名所の名前で始まり、件数・多い市（州・県）・案内の件数を数えた値で書く（決まり文句の2文を足さない）", () => {
        const t = themes.find((x) => x.categorySlug === "churches" && x.place.slug === "it")!;
        const v = themeView("churches", "it")!;
        const d = topicMetadata(v).description as string;
        expect(d.startsWith(`${v.cards[0].name}、${v.cards[1].name}、${v.cards[2].name}など、イタリアの教会の撮影スポット${t.spots.length}か所。`)).toBe(true);
        const rome = t.spots.filter((s) => s.region?.city === "ローマ").length;
        expect(rome).toBeGreaterThanOrEqual(2);
        expect(d).toContain(`ローマ${rome}か所`);
        const seasonal = t.spots.filter((s) => (s.seasonalGuide ?? []).length > 0).length;
        // 台帳に季節の案内が無い組では書かない（無いものを数えない）
        if (seasonal > 0) expect(d).toContain(`${seasonal === t.spots.length ? "全か所" : `${seasonal}か所`}に季節ごとの撮影の案内`);
        else expect(d).not.toContain("季節ごとの撮影の案内");
        // 以前の決まり文句
        expect(d).not.toMatch(/うち\d+件は季節ごとの撮影の案内があります|時間帯ごとの撮影の案内があるのは/);
        for (const x of views) {
            const dx = topicMetadata(x).description as string;
            expect(len(dx), x.path).toBeLessThanOrEqual(THEME_DESCRIPTION_MAX);
            expect(dx, x.path).toMatch(/。$/);
            expect(dx, x.path).not.toContain("撮りどき");
        }
        // 頁ごとに違う文（同じ説明の頁が2つ無い）
        expect(new Set(views.map((x) => topicMetadata(x).description)).size).toBe(views.length);
    });

    it("内訳: 国は市と州・県のうち多く言える方、2件以上の所だけ（アメリカの火山はハワイ州）", () => {
        const us = themes.find((x) => x.categorySlug === "volcanoes" && x.place.slug === "us")!;
        const hawaii = us.spots.filter((s) => s.region?.prefecture === "ハワイ州").length;
        expect(themeBreakdown(us)[0]).toEqual(["ハワイ州", hawaii]);
        for (const t of themes) for (const [, k] of themeBreakdown(t)) expect(k).toBeGreaterThanOrEqual(2);
        // 地方の頁は県ごと
        const kinki = themes.find((x) => x.categorySlug === "old-townscapes" && x.place.slug === "kinki")!;
        for (const [name] of themeBreakdown(kinki)) expect(name).toMatch(/[都道府県]$/);
    });

    it("導入文に、その組の台帳から数えた事実（季節ごと・撮り方のこつ・世界遺産の記述）を足す", () => {
        const t = themes.find((x) => x.categorySlug === "churches" && x.place.slug === "it")!;
        const v = themeView("churches", "it")!;
        const autumn = t.spots.filter((s) => (s.seasonalGuide ?? []).some((g) => g.season === "autumn")).length;
        if (autumn > 0) expect(v.intro).toContain(`秋${autumn}件`);
        else expect(v.intro).not.toContain("秋0件");
        const heritage = t.spots.filter((s) => /世界遺産/.test(`${s.summary ?? ""}${s.description ?? ""}`)).length;
        if (heritage > 0) expect(v.intro).toContain(`「世界遺産」とあるのは${heritage}件`);
        const tips = t.spots.filter((s) => (s.compositionTips ?? []).length > 0).length;
        expect(v.intro).toContain(tips === t.spots.length ? "撮り方のこつは全件に" : `撮り方のこつは${tips}件に`);
        // 組ごとに違う導入文
        expect(new Set(views.map((x) => x.intro)).size).toBe(views.length);
    });

    it("カードに撮り方のこつ（台帳の compositionTips の1つ目）・国と県の一覧へのリンク", () => {
        const t = themes.find((x) => x.categorySlug === "churches" && x.place.slug === "it")!;
        const v = themeView("churches", "it")!;
        const first = t.spots.find((s) => s.slug === v.cards[0].slug)!;
        expect(v.cards[0].tip).toBe(first.compositionTips![0]);
        expect(v.placeLink?.href).toBe("/spots/area/overseas/it");
        expect(v.placeLink?.count).toBe(countryTopics().find((c) => c.code === "it")!.spots.length);
        expect(themeView("temples-shrines", "kyoto")!.placeLink?.href).toBe("/spots/area/kyoto");
        expect(themeView("temples-shrines", "kinki")!.placeLink).toBeUndefined();
        // テーマの頁以外のカードには付けない（頁の重さを変えない）
        expect(countryView("it")!.cards.some((c) => c.tip)).toBe(false);
    });
});
