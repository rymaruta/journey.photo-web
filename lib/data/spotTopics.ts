// lib/data/spotTopics.ts（サーバー専用・ビルド時に焼く）
//
// **撮影スポットの「切り口の一覧」**——国・テーマ（カテゴリ × 地域）・季節（2026-10-11）。
//
// owner の方針（2026-10-11・最優先「検索で見つけてもらう」）:
//   - 海外 814件が `/spots/area/overseas` の1頁（約1.3MB）だった → **国ごとに分ける**
//   - 「京都府の寺社の撮影スポット」「秋の撮影スポット（近畿）」のような**検索語の形の頁**を作る
//   - **データの事実だけを載せる**（件数・スポット名・台帳の季節の案内）
//   - **薄い頁を量産しない**——テーマ・季節の地方別は `MIN_TOPIC_SPOTS` 件以上の組だけ
//
// 2026-10-11 判断: 頁に載せるのは**公開済み（`isPublished`）の行だけ**。下書きを建てる設定
// （`BUILD_DRAFT_SPOTS`）に戻しても、切り口の頁は下書きを検索の着地点にしない
// （`sameAreaSpots` と同じ線）。
//
// 🔴 台帳（`SPOTS`）を値で読む。**`"use client"` から import しない**
// （`spotLink.ts` の冒頭・見張りは `spotLedgerClientImport.test.ts`）。
// 画面へは下の `TopicCard` / `TopicLink` に落としてから渡す。

import { SPOTS, type Spot, type SpotSeason } from "./spots";
import { visibleSpots, isPublished } from "../utils/spotGuide";
import { spotCoverImage, spotCoverLarge, spotCoverSize } from "./spotImages";
import { spotThumbSrc, spotThumbExists } from "./spotThumbs";
import { COUNTRY_SHARD_KEYS } from "./spotFeedShards";
import { REGIONS, prefectureByName, OVERSEAS_SLUG, OVERSEAS_NAME, type RegionName } from "./prefectures";
import { siteConfig, generateItemListStructuredData, generateBreadcrumbStructuredData, pageRobots, shareOgImage, shareImageUrl } from "../utils/seo";
import { ROUTES } from "../routes";

/**
 * テーマ・季節の地方別の頁を作る最小の件数。**これ未満の組は頁を作らない**
 * （5件に満たない「◯◯の△△」は、個別頁の寄せ集めで中身が薄い）
 */
export const MIN_TOPIC_SPOTS = 5;

/**
 * 国の頁を検索に出す最小の件数。**`app/spots/area/[area]/page.tsx` の
 * `MIN_INDEXABLE_AREA` と同じ線**——1件の国の頁はそのスポットの個別頁と食い合う。
 * 頁は建てる（国の一覧から行き止まりにしない）が `noindex`・サイトマップ外
 */
export const MIN_INDEXABLE_COUNTRY = 2;

/** 季節の並び（台帳の `SpotSeason` の順） */
export const SEASONS: readonly SpotSeason[] = ["spring", "summer", "autumn", "winter"];
export const SEASON_JA: Record<SpotSeason, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };
export const SEASON_EN: Record<SpotSeason, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };

/**
 * 季節の案内の文に出てくる、検索でよく打たれる語（導入文で件数を数えるだけ）。
 * **頁の題には使わない**——秋の頁の全部が紅葉の案内ではない
 */
const SEASON_KEYWORD: Partial<Record<SpotSeason, string>> = { spring: "桜", autumn: "紅葉", winter: "雪" };
// 夏は置かない（多いのは「緑」「青」で、季節らしさを言う語にならない・2026-10-11 台帳で数えた）

/**
 * 語を含んでいても、季節の語ではない固有名詞（地名・山名・別の花）。**判定の前に取り除く**（2026-11-07）。
 * 例: 「桜島」「若桜（鉄道・町）」「桜井」「大雪山」「芝桜」（桜の木ではなく別の花）。台帳の実データで見つけた分だけ。
 * 紅葉は固有名詞に紛れる形が見つかっていないので置かない
 */
const NOT_SEASON_WORD: Partial<Record<SpotSeason, RegExp>> = {
    spring: /桜島|桜井|若桜|桜川|桜町|桜木町|桜田|芝桜/g,
    winter: /大雪山|雪ノ下|雪谷/g,
};

/** その季節の案内に、その季節の語（`SEASON_KEYWORD`）がある行か。**その季節の項目だけを見る** */
export function hasSeasonKeyword(s: Spot, season: SpotSeason): boolean {
    const kw = SEASON_KEYWORD[season];
    const strip = NOT_SEASON_WORD[season];
    return Boolean(kw) && (s.seasonalGuide ?? []).some((g) => g?.season === season && Boolean(g.text && (strip ? g.text.replace(strip, "") : g.text).includes(kw!)));
}

/** 地方 → URL の綴り（季節の地方別・テーマの地方別で共用） */
export const REGION_SLUGS: Record<RegionName, string> = {
    "北海道": "hokkaido",
    "東北": "tohoku",
    "関東": "kanto",
    "中部": "chubu",
    "近畿": "kinki",
    "中国": "chugoku",
    "四国": "shikoku",
    "九州・沖縄": "kyushu-okinawa",
};

/**
 * 地方の呼び名。**「中国」は国の中国と紛れるので「中国地方」**（台帳に国の中国が56件ある）。
 * 近畿は検索でよく打たれる「関西」を添える
 */
export const REGION_LABEL: Record<RegionName, string> = {
    "北海道": "北海道",
    "東北": "東北地方",
    "関東": "関東地方",
    "中部": "中部地方",
    "近畿": "近畿地方（関西）",
    "中国": "中国地方",
    "四国": "四国地方",
    "九州・沖縄": "九州・沖縄",
};

/** 地方の英語名（英語表示の枠だけに使う） */
export const REGION_EN: Record<RegionName, string> = {
    "北海道": "Hokkaido", "東北": "Tohoku", "関東": "Kanto", "中部": "Chubu",
    "近畿": "Kansai", "中国": "Chugoku", "四国": "Shikoku", "九州・沖縄": "Kyushu & Okinawa",
};

/** カテゴリの英語名。綴り（`CATEGORY_SLUGS`）から作り、読みにくいものだけ手で書く */
const CATEGORY_EN_OVERRIDE: Record<string, string> = { "temples-shrines": "Temples & shrines", "lakes-ponds": "Lakes & ponds" };
export function categoryEn(categorySlug: string): string {
    const o = CATEGORY_EN_OVERRIDE[categorySlug];
    if (o) return o;
    const t = categorySlug.replace(/-/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
}

/** 国の英語名（台帳に無いので ISO の2文字から引く）。引けなければ2文字を大文字で */
let regionNames: Intl.DisplayNames | null = null;
export function countryEn(code: string): string {
    try {
        regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
        return regionNames.of(code.toUpperCase()) ?? code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

/**
 * カテゴリ（台帳の `category`）→ URL の綴り。**台帳に出るものは全部持つ**
 * （無いカテゴリはテーマの頁が作られない。見張りは `spotTopics.test.ts`——
 * 頁になる件数のカテゴリが表に無ければ落ちる）
 */
export const CATEGORY_SLUGS: Readonly<Record<string, string>> = {
    寺社: "temples-shrines", 寺院: "temples", 神社: "shrines", 教会: "churches", 仏像: "buddha-statues",
    城: "castles", 城跡: "castle-ruins", 宮殿: "palaces", 史跡: "historic-sites", 遺跡: "ruins",
    産業遺産: "industrial-heritage", 古道: "old-roads",
    町並み: "old-townscapes", 街並み: "streetscapes", 街: "towns", 集落: "villages", 農村: "rural-villages",
    温泉街: "onsen-towns", 広場: "squares", 市場: "markets", 運河: "canals", 駅: "stations", 鉄道: "railways",
    建築: "architecture", 橋: "bridges", 展望台: "observation-decks", 灯台: "lighthouses", ダム: "dams",
    道路: "scenic-roads", 劇場: "theaters", 博物館: "museums", 美術館: "art-museums", アート: "art",
    水族館: "aquariums", 動物園: "zoos", 植物園: "botanical-gardens", 庭園: "gardens", 公園: "parks",
    花畑: "flower-fields", 花園: "flower-gardens", 並木道: "tree-lined-avenues", 樹木: "notable-trees",
    棚田: "rice-terraces", 農場: "farms", 祭り: "festivals", 夜景: "night-views", 温泉: "hot-springs",
    山岳: "mountains", 火山: "volcanoes", 高原: "highlands", 草原: "grasslands", 森林: "forests",
    渓谷: "gorges", 峡谷: "canyons", 渓流: "mountain-streams", 滝: "waterfalls", 湧水: "springs",
    湖沼: "lakes-ponds", 湖: "lakes", 池: "ponds", 火口湖: "crater-lakes", 湿原: "wetlands",
    海岸: "coasts", 岬: "capes", 湾: "bays", 海峡: "straits", 島: "islands", 諸島: "archipelagos",
    砂丘: "sand-dunes", 鍾乳洞: "limestone-caves", 洞窟: "caves", 動物: "wildlife", 自然現象: "natural-phenomena",
};

// ─────────────────────────────────────────────────────────────
// 画面へ渡す形
// ─────────────────────────────────────────────────────────────

/** 一覧のカード1枚。**画面が読む項目だけ**（`SpotIndexItem` と同じ考え方） */
export type TopicCard = {
    slug: string;
    name: string;
    /** 「京都府 京都市」・海外は「フランス イル・ド・フランス」 */
    region: string;
    summary?: string;
    /**
     * 代表写真（`spotCoverImage`＝スポットの頁と同じ判断）。**サムネが在ればサムネ**
     * （短い辺 240px・`spotThumbs.ts`）。`credit` は表示が条件のとき（CC BY 系）の文字
     */
    cover: { src: string; alt: string; credit: TopicCredit | null } | null;
};

/**
 * 写真の表示（CC BY・CC BY-SA の条件＝作者・ライセンス（文面へ）・出典）。スポットの頁
 * （`SpotGuideClient` の代表写真の下）と同じ中身。`text` はライセンス名の無い写真の表記
 */
export type TopicCredit = { author: string; license?: string; licenseUrl?: string; sourceUrl?: string; text?: string };

/** 別の切り口の頁へのリンク。`labelEn` は英語表示のとき（無ければ日本語のまま） */
export type TopicLink = {
    href: string; label: string; labelEn?: string; count: number;
    /** 構造化データ（`ItemList`）での名前。無ければ「<label>の撮影スポット」。リンクが1件のスポットへ直に行くときだけ持つ */
    itemName?: string;
};

/** 頁の中身（`SpotTopicPage` が描く） */
export type TopicView = {
    path: string;
    /** h1・題（「京都府の寺社の撮影スポット」） */
    heading: string;
    /** 英語表示の h1（枠だけ英語にする。導入文・カードは日本語のまま） */
    headingEn: string;
    /** 導入文（データから組み立てた事実だけ） */
    intro: string;
    /** パンくず（ホーム・撮影スポットの後ろ、自分の前まで） */
    crumbs: Array<{ name: string; nameEn: string; href: string }>;
    cards: TopicCard[];
    /** 関連する切り口（見出しごと） */
    related: Array<{ heading: string; headingEn: string; links: TopicLink[] }>;
    /** 説明（`description`）に足す事実（導入文の後ろ・数えた件数だけ） */
    descriptionExtra?: string;
    /** OGP の画像（**元の大きさ**の代表写真・サムネではない）。クライアントへは渡さない */
    ogImage?: { src: string; alt: string; width?: number; height?: number };
    /** 検索に出すか */
    indexable: boolean;
    /** 中身の最終更新（載せたスポットの `updatedAt` の最大） */
    lastModified?: string;
};

// ─────────────────────────────────────────────────────────────
// 母集合と分け方
// ─────────────────────────────────────────────────────────────

/** 切り口の頁に載せてよい行（**建てられて・公開済み**）。配列ごとに1回だけ数える */
const shownCache = new WeakMap<readonly Spot[], Spot[]>();
export function topicSpots(spots: readonly Spot[] = SPOTS): Spot[] {
    let rows = shownCache.get(spots);
    if (!rows) {
        rows = visibleSpots(spots).filter(isPublished);
        shownCache.set(spots, rows);
    }
    return rows;
}

/**
 * 分け方は**台帳の配列ごとに1回だけ**計算する。スポットの頁（約1,800枚）が1枚ごとに
 * `topicLinksForSpot` を呼ぶので、毎回組み直すと件数の2乗で遅くなる（`spotSeo.ts` の
 * `publishedVisibleOf` と同じ理由）。台帳の配列は作り直さないので、同じ配列なら結果も同じ
 */
const countryCache = new WeakMap<readonly Spot[], CountryTopic[]>();
const themeCache = new WeakMap<readonly Spot[], ThemeTopic[]>();
const seasonCache = new WeakMap<readonly Spot[], SeasonTopic[]>();
const cityCache = new WeakMap<readonly Spot[], CityTopic[]>();
const seasonThemeCache = new WeakMap<readonly Spot[], SeasonThemeTopic[]>();
const featureCache = new Map<FeatureKey, WeakMap<readonly Spot[], FeatureTopic[]>>();
function memo<T>(cache: WeakMap<readonly Spot[], T>, spots: readonly Spot[], build: (s: readonly Spot[]) => T): T {
    let v = cache.get(spots);
    if (v === undefined) {
        v = build(spots);
        cache.set(spots, v);
    }
    return v;
}

const isJapan = (s: Spot) => s.region?.country === "日本";
const regionOf = (s: Spot): RegionName | null => (isJapan(s) ? prefectureByName(s.region?.prefecture)?.region ?? null : null);
const hasSeason = (s: Spot, season: SpotSeason) => (s.seasonalGuide ?? []).some((g) => g?.season === season);

/** 国の2文字（小文字）。表に無い国は `null`（頁を作らない） */
export function countryCode(country: string | undefined): string | null {
    return country && country !== "日本" ? COUNTRY_SHARD_KEYS[country] ?? null : null;
}

export type CountryTopic = { code: string; name: string; spots: Spot[] };

/** 海外の国ごと。**件数の多い順**（同数は名前の順） */
export function countryTopics(spots: readonly Spot[] = SPOTS): CountryTopic[] {
    return memo(countryCache, spots, buildCountryTopics);
}
function buildCountryTopics(spots: readonly Spot[]): CountryTopic[] {
    const by = new Map<string, CountryTopic>();
    for (const s of topicSpots(spots)) {
        const code = countryCode(s.region?.country);
        if (!code) continue;
        const t = by.get(code) ?? { code, name: s.region!.country!, spots: [] };
        t.spots.push(s);
        by.set(code, t);
    }
    return [...by.values()].sort((a, b) => b.spots.length - a.spots.length || a.name.localeCompare(b.name, "ja"));
}

/** テーマの「地域」側。県・地方・国のどれか */
export type TopicPlace =
    | { kind: "prefecture"; slug: string; name: string; areaSlug: string; region: RegionName }
    | { kind: "region"; slug: string; name: string; region: RegionName }
    | { kind: "country"; slug: string; name: string };

export type ThemeTopic = { category: string; categorySlug: string; place: TopicPlace; spots: Spot[] };

/**
 * テーマ（カテゴリ × 地域）。**`MIN_TOPIC_SPOTS` 件以上の組だけ。**
 *
 * 地域は3段: 都道府県・地方（日本）・国（海外）。地方の頁が県の頁と**同じ顔ぶれ**になる
 * とき（北海道は1県1地方）は地方の側を作らない（同じ中身の頁を2枚にしない）。
 * 並びは**カテゴリの件数の多い順 → 県・地方・国の順 → 件数の多い順**
 */
export function themeTopics(spots: readonly Spot[] = SPOTS): ThemeTopic[] {
    return memo(themeCache, spots, buildThemeTopics);
}
function buildThemeTopics(spots: readonly Spot[]): ThemeTopic[] {
    const groups = new Map<string, ThemeTopic>();
    const add = (s: Spot, place: TopicPlace) => {
        const category = (s.category ?? "").trim();
        const categorySlug = CATEGORY_SLUGS[category];
        if (!categorySlug) return;
        // 🔴 **鍵に種類を入れる。** 北海道は県と地方の綴りがどちらも `hokkaido` で、綴りだけを鍵に
        // すると同じスポットが県と地方で2回数えられ、3件の組が「6件」になって頁ができていた
        const key = `${place.kind}/${categorySlug}/${place.slug}`;
        const g = groups.get(key) ?? { category, categorySlug, place, spots: [] };
        g.spots.push(s);
        groups.set(key, g);
    };
    for (const s of topicSpots(spots)) {
        if (isJapan(s)) {
            const pref = prefectureByName(s.region?.prefecture);
            if (!pref) continue;
            add(s, { kind: "prefecture", slug: pref.slug, name: pref.name, areaSlug: pref.slug, region: pref.region });
            add(s, { kind: "region", slug: REGION_SLUGS[pref.region], name: REGION_LABEL[pref.region], region: pref.region });
        } else {
            const code = countryCode(s.region?.country);
            if (code) add(s, { kind: "country", slug: code, name: s.region!.country! });
        }
    }
    const kept = [...groups.values()].filter((g) => g.spots.length >= MIN_TOPIC_SPOTS);
    // 地方の頁が、同じカテゴリ・その地方の県の頁と同じ顔ぶれなら落とす
    // （県の頁はその地方の部分集合なので、件数が同じなら顔ぶれも同じ）
    const sameAsPrefecture = (g: ThemeTopic) => g.place.kind === "region" && kept.some((o) =>
        o.place.kind === "prefecture" && o.categorySlug === g.categorySlug
        && g.place.kind === "region" && o.place.region === g.place.region && o.spots.length === g.spots.length);
    // 同じ URL になる組（北海道の県と地方）は**県・国を残して地方を捨てる**
    const kindRank = { prefecture: 0, country: 1, region: 2 } as const;
    const byPath = new Map<string, ThemeTopic>();
    for (const g of [...kept].sort((a, b) => kindRank[a.place.kind] - kindRank[b.place.kind])) {
        if (sameAsPrefecture(g)) continue;
        const path = themePath(g);
        if (!byPath.has(path)) byPath.set(path, g);
    }
    const out = [...byPath.values()];
    const catCount = new Map<string, number>();
    for (const s of topicSpots(spots)) if (s.category) catCount.set(s.category, (catCount.get(s.category) ?? 0) + 1);
    const kindOrder = { prefecture: 0, region: 1, country: 2 } as const;
    return out.sort((a, b) =>
        (catCount.get(b.category) ?? 0) - (catCount.get(a.category) ?? 0)
        || a.category.localeCompare(b.category, "ja")
        || kindOrder[a.place.kind] - kindOrder[b.place.kind]
        || b.spots.length - a.spots.length
        || a.place.slug.localeCompare(b.place.slug));
}

/** 季節の頁。`region` が無ければ全体、`"overseas"` は海外 */
export type SeasonTopic = {
    season: SpotSeason;
    /** 地方の綴り（`REGION_SLUGS`）か `OVERSEAS_SLUG`。全体の頁は `null` */
    area: string | null;
    /** 地方の呼び名（`REGION_LABEL`）か「海外」。全体は `null` */
    areaName: string | null;
    spots: Spot[];
};

/**
 * 季節（台帳の `seasonalGuide` にその季節の項目を持つスポット）。
 *
 * - 全体の頁は**1件でもあれば**作る（4枚だけ・入口になる）
 * - 地方別・海外は `MIN_TOPIC_SPOTS` 件以上のときだけ
 *
 * ⚠️ 南半球の行（オーストラリアなど）の「秋」は3〜5月。頁は季節の名前だけを言い、
 * **月は名乗らない**（ホームの「いまの季節」だけが月を使い、そこでは南半球を外す）
 */
export function seasonTopics(spots: readonly Spot[] = SPOTS): SeasonTopic[] {
    return memo(seasonCache, spots, buildSeasonTopics);
}
function buildSeasonTopics(spots: readonly Spot[]): SeasonTopic[] {
    const out: SeasonTopic[] = [];
    const rows = topicSpots(spots);
    for (const season of SEASONS) {
        const all = rows.filter((s) => hasSeason(s, season));
        if (all.length === 0) continue;
        out.push({ season, area: null, areaName: null, spots: all });
        for (const r of REGIONS) {
            const list = all.filter((s) => regionOf(s) === r);
            if (list.length >= MIN_TOPIC_SPOTS) out.push({ season, area: REGION_SLUGS[r], areaName: REGION_LABEL[r], spots: list });
        }
        const overseas = all.filter((s) => !isJapan(s));
        if (overseas.length >= MIN_TOPIC_SPOTS) out.push({ season, area: OVERSEAS_SLUG, areaName: OVERSEAS_NAME, spots: overseas });
    }
    return out;
}

/**
 * 市区町村の頁（2026-11-05・「○○市の撮影スポット」）。**日本の行だけ**・`MIN_TOPIC_SPOTS` 件以上の市区町村だけ。
 * 同じ名前の市が別の県にある（府中市・伊達市）ので、鍵は**県＋市区町村**。URL は
 * `/spots/city/<県の綴り>/<市区町村名>`（`/location/<名前>` と同じく日本語の綴り）
 */
export type CityTopic = { prefSlug: string; prefName: string; prefNameEn: string; region: RegionName; city: string; spots: Spot[] };

export function cityTopics(spots: readonly Spot[] = SPOTS): CityTopic[] {
    return memo(cityCache, spots, buildCityTopics);
}
function buildCityTopics(spots: readonly Spot[]): CityTopic[] {
    const by = new Map<string, CityTopic>();
    for (const s of topicSpots(spots)) {
        if (!isJapan(s)) continue;
        const city = (s.region?.city ?? "").trim();
        const pref = prefectureByName(s.region?.prefecture);
        if (!city || !pref) continue;
        const key = `${pref.slug}/${city}`;
        const t = by.get(key) ?? { prefSlug: pref.slug, prefName: pref.name, prefNameEn: pref.nameEn, region: pref.region, city, spots: [] };
        t.spots.push(s);
        by.set(key, t);
    }
    return [...by.values()].filter((t) => t.spots.length >= MIN_TOPIC_SPOTS)
        .sort((a, b) => b.spots.length - a.spots.length || a.prefSlug.localeCompare(b.prefSlug) || a.city.localeCompare(b.city, "ja"));
}

export const cityHeading = (t: Pick<CityTopic, "prefName" | "city">) => `${t.prefName}${t.city}の撮影スポット`;
export const cityHeadingEn = (t: Pick<CityTopic, "prefNameEn" | "city">) => `Photo spots in ${t.city}, ${t.prefNameEn}`;
export const cityPath = (t: Pick<CityTopic, "prefSlug" | "city">) => ROUTES.SPOT_CITY(t.prefSlug, t.city);

/** 季節 × カテゴリの頁（2026-11-05・「秋の寺社の撮影スポット」）。季節の案内を持つ行のうち、そのカテゴリの `MIN_TOPIC_SPOTS` 件以上 */
export type SeasonThemeTopic = { season: SpotSeason; category: string; categorySlug: string; spots: Spot[] };

export function seasonThemeTopics(spots: readonly Spot[] = SPOTS): SeasonThemeTopic[] {
    return memo(seasonThemeCache, spots, buildSeasonThemeTopics);
}
function buildSeasonThemeTopics(spots: readonly Spot[]): SeasonThemeTopic[] {
    const by = new Map<string, SeasonThemeTopic>();
    for (const s of topicSpots(spots)) {
        const category = (s.category ?? "").trim();
        const categorySlug = CATEGORY_SLUGS[category];
        if (!categorySlug) continue;
        for (const season of SEASONS) {
            if (!hasSeason(s, season)) continue;
            const key = `${season}/${categorySlug}`;
            const t = by.get(key) ?? { season, category, categorySlug, spots: [] };
            t.spots.push(s);
            by.set(key, t);
        }
    }
    return [...by.values()].filter((t) => t.spots.length >= MIN_TOPIC_SPOTS)
        .sort((a, b) => SEASONS.indexOf(a.season) - SEASONS.indexOf(b.season) || b.spots.length - a.spots.length || a.category.localeCompare(b.category, "ja"));
}

export const seasonThemeHeading = (t: Pick<SeasonThemeTopic, "season" | "category">) => `${SEASON_JA[t.season]}の${t.category}の撮影スポット`;
export const seasonThemeHeadingEn = (t: Pick<SeasonThemeTopic, "season" | "categorySlug">) => `${SEASON_EN[t.season]} ${categoryEn(t.categorySlug)} photo spots`;
export const seasonThemePath = (t: Pick<SeasonThemeTopic, "season" | "categorySlug">) => ROUTES.SPOT_SEASON_THEME(t.season, t.categorySlug);

/**
 * **季節の見どころ別の頁**——紅葉（2026-11-06 owner「紅葉シーズンで調べられることが多いから充実させて欲しい」）に、
 * 桜（春）・雪景色（冬）を同じ作りで足した（2026-11-07）。紅葉の URL・見た目は変えない。
 *
 * 対象は**日本の、その季節の案内にその語（紅葉＝秋の「紅葉」・桜＝春の「桜」・雪景色＝冬の「雪」）があるスポット**
 * （`hasSeasonKeyword`・台帳の記述だけを根拠にする）。見頃・開花・積雪の日付は台帳に無いので書かない
 * （数えられない事実を頁に書かない）。
 * 頁は まとめ（place なし）・地方別・県別。**地方別・県別は `MIN_TOPIC_SPOTS` 件以上だけ**（薄い頁を作らない）。
 * 北海道は県と地方が同じ顔ぶれなので県の側だけ（`themeTopics` と同じ判断）。
 */
export type FeatureKey = "momiji" | "sakura" | "snow";
export const FEATURE_KEYS: readonly FeatureKey[] = ["momiji", "sakura", "snow"];

type FeatureDef = {
    season: SpotSeason;
    /** 頁の題に入れる語（「紅葉の撮影スポット」「桜の撮影スポット」「雪景色の撮影スポット」） */
    noun: string;
    nounEn: string;
    /** 英語の題の頭（"Autumn foliage photo spots"） */
    headEn: string;
    /** 導入文で数える台帳の語（`SEASON_KEYWORD` と同じ） */
    keyword: string;
    eyebrow: string;
};
export const FEATURES: Record<FeatureKey, FeatureDef> = {
    momiji: { season: "autumn", noun: "紅葉", nounEn: "Autumn foliage", headEn: "Autumn foliage photo spots", keyword: "紅葉", eyebrow: "Photo spots · Autumn foliage" },
    sakura: { season: "spring", noun: "桜", nounEn: "Cherry blossoms", headEn: "Cherry blossom photo spots", keyword: "桜", eyebrow: "Photo spots · Cherry blossoms" },
    snow: { season: "winter", noun: "雪景色", nounEn: "Snow scenery", headEn: "Snow scenery photo spots", keyword: "雪", eyebrow: "Photo spots · Snow scenery" },
};

export type FeaturePlace =
    | { kind: "prefecture"; slug: string; name: string; nameEn: string; region: RegionName }
    | { kind: "region"; slug: string; name: string; region: RegionName };
export type FeatureTopic = { place: FeaturePlace | null; spots: Spot[] };
export type MomijiPlace = FeaturePlace;
export type MomijiTopic = FeatureTopic;

export function featureTopics(feature: FeatureKey, spots: readonly Spot[] = SPOTS): FeatureTopic[] {
    let cache = featureCache.get(feature);
    if (!cache) featureCache.set(feature, cache = new WeakMap());
    return memo(cache, spots, (sp) => buildFeatureTopics(feature, sp));
}
export const momijiTopics = (spots: readonly Spot[] = SPOTS): FeatureTopic[] => featureTopics("momiji", spots);
function buildFeatureTopics(feature: FeatureKey, spots: readonly Spot[]): FeatureTopic[] {
    const season = FEATURES[feature].season;
    const all = topicSpots(spots).filter((s) => isJapan(s) && hasSeasonKeyword(s, season));
    if (all.length === 0) return [];
    const byPref = new Map<string, FeatureTopic>();
    const byRegion = new Map<string, FeatureTopic>();
    for (const s of all) {
        const pref = prefectureByName(s.region?.prefecture);
        if (!pref) continue;
        const pk = byPref.get(pref.slug) ?? { place: { kind: "prefecture" as const, slug: pref.slug, name: pref.name, nameEn: pref.nameEn, region: pref.region }, spots: [] };
        pk.spots.push(s); byPref.set(pref.slug, pk);
        const rk = byRegion.get(pref.region) ?? { place: { kind: "region" as const, slug: REGION_SLUGS[pref.region], name: REGION_LABEL[pref.region], region: pref.region }, spots: [] };
        rk.spots.push(s); byRegion.set(pref.region, rk);
    }
    const prefs = [...byPref.values()].filter((t) => t.spots.length >= MIN_TOPIC_SPOTS);
    const prefSlugs = new Set(prefs.map((t) => (t.place as { slug: string }).slug));
    // 地方の頁: 5 件以上で、県の頁と同じ綴り（北海道）・同じ顔ぶれでないもの
    const regions = [...byRegion.values()].filter((t) => t.spots.length >= MIN_TOPIC_SPOTS && !prefSlugs.has((t.place as { slug: string }).slug)
        && !prefs.some((p) => p.spots.length === t.spots.length && (p.place as { region: string }).region === (t.place as { region: string }).region));
    const order = (a: FeatureTopic, b: FeatureTopic) => b.spots.length - a.spots.length
        || (a.place as { slug: string }).slug.localeCompare((b.place as { slug: string }).slug);
    return [{ place: null, spots: all }, ...regions.sort(order), ...prefs.sort(order)];
}

export const featurePath = (feature: FeatureKey, t: Pick<FeatureTopic, "place">) => ROUTES.SPOT_FEATURE(feature, t.place?.slug);
export const featureHeading = (feature: FeatureKey, t: Pick<FeatureTopic, "place">) => `${t.place ? t.place.name : ""}の${FEATURES[feature].noun}の撮影スポット`.replace(/^の/, "");
export const featureHeadingEn = (feature: FeatureKey, t: Pick<FeatureTopic, "place">) =>
    `${FEATURES[feature].headEn}${t.place ? ` in ${t.place.kind === "prefecture" ? t.place.nameEn : REGION_EN[t.place.region]}` : ""}`;
export const momijiPath = (t: Pick<FeatureTopic, "place">) => featurePath("momiji", t);
export const momijiHeading = (t: Pick<FeatureTopic, "place">) => featureHeading("momiji", t);
export const momijiHeadingEn = (t: Pick<FeatureTopic, "place">) => featureHeadingEn("momiji", t);

// ─────────────────────────────────────────────────────────────
// 題・道・導入文
// ─────────────────────────────────────────────────────────────

export const themeHeading = (t: Pick<ThemeTopic, "category" | "place">) => `${t.place.name}の${t.category}の撮影スポット`;

/** 地域の英語名（県・地方・国） */
export function placeEn(p: TopicPlace): string {
    if (p.kind === "prefecture") return prefectureByName(p.name)?.nameEn ?? p.name;
    if (p.kind === "region") return REGION_EN[p.region];
    return countryEn(p.slug);
}
const seasonAreaEn = (area: string | null) => {
    if (!area) return null;
    if (area === OVERSEAS_SLUG) return "outside Japan";
    const r = (Object.keys(REGION_SLUGS) as RegionName[]).find((k) => REGION_SLUGS[k] === area);
    return r ? `in ${REGION_EN[r]}` : null;
};
export const themeHeadingEn = (t: Pick<ThemeTopic, "categorySlug" | "place">) => `${categoryEn(t.categorySlug)} photo spots in ${placeEn(t.place)}`;
export const seasonHeadingEn = (t: Pick<SeasonTopic, "season" | "area">) =>
    `${SEASON_EN[t.season]} photo spots${t.area ? ` ${seasonAreaEn(t.area)}` : ""}`;
export const countryHeadingEn = (t: Pick<CountryTopic, "code">) => `Photo spots in ${countryEn(t.code)}`;
export const seasonHeading = (t: Pick<SeasonTopic, "season" | "areaName">) =>
    `${t.areaName ? `${t.areaName}の` : ""}${SEASON_JA[t.season]}の撮影スポット`;
export const countryHeading = (t: Pick<CountryTopic, "name">) => `${t.name}の撮影スポット`;

export const themePath = (t: Pick<ThemeTopic, "categorySlug" | "place">) => ROUTES.SPOT_THEME(t.categorySlug, t.place.slug);
export const seasonPath = (t: Pick<SeasonTopic, "season" | "area">) => ROUTES.SPOT_SEASON(t.season, t.area ?? undefined);

/**
 * 代表写真（スポットの頁と同じ判断）。サムネが在ればサムネ。
 * 県の頁（`/spots/area/<県>`・`spotIndexItemsForArea`）のカードも同じものを使う（2026-10-22）
 */
export function topicCardCover(s: Spot): TopicCard["cover"] {
    const c = spotCoverImage(s);
    if (!c?.src) return null;
    const thumb = spotThumbSrc(c.src);
    const src = thumb && spotThumbExists(thumb) ? thumb : c.src;
    // CC BY・CC BY-SA は作者とライセンスの表示が条件（運営の写真で表記の求めが無いときだけ出さない）
    const showCredit = c.license !== "owner" || Boolean(c.requiredCreditText?.trim());
    let credit: TopicCredit | null = null;
    if (showCredit) {
        // スポットの頁と同じ分け方: ライセンス名があれば「作者 / ライセンス（文面へ）/ 出典」、
        // 無ければ求められた表記（`requiredCreditText`）か作者
        const author = (c.credit || "").trim();
        if (c.licenseLabel && author) {
            credit = { author, license: c.licenseLabel,
                ...(c.licenseUrl ? { licenseUrl: c.licenseUrl } : {}), ...(c.sourceUrl ? { sourceUrl: c.sourceUrl } : {}) };
        } else {
            const text = (c.requiredCreditText || author).trim();
            if (text) credit = { author, text };
        }
    }
    return { src, alt: c.alt || s.name, credit };
}

export function toTopicCard(s: Spot): TopicCard {
    return {
        slug: s.slug,
        name: s.name,
        region: [isJapan(s) ? undefined : s.region?.country, s.region?.prefecture, s.region?.city].filter(Boolean).join(" "),
        ...(s.summary ? { summary: s.summary } : {}),
        cover: topicCardCover(s),
    };
}

/** カードの並び: **代表写真のあるものを先に**、その中は台帳の順のまま */
export function topicCards(spots: readonly Spot[]): TopicCard[] {
    const cards = spots.map(toTopicCard);
    return [...cards.filter((c) => c.cover), ...cards.filter((c) => !c.cover)];
}

/**
 * OGP の画像の1枚（**元の大きさ**の代表写真・サムネは 240px で小さすぎる）。寸法つき。
 * 2026-10-22: 横 1,200px 以上の版（`spotCoverLarge`・Commons の 1280px）があればそれ、無ければサイトに置いた 960px
 */
function coverOgOf(s: Spot): { src: string; alt: string; width?: number; height?: number; large: boolean } | undefined {
    const c = spotCoverImage(s);
    if (!c?.src) return undefined;
    const alt = c.alt || s.name;
    const large = spotCoverLarge(s);
    if (large) return { src: large.src, alt, width: large.width, height: large.height, large: true };
    return { src: c.src, alt, ...spotCoverSize(s), large: false };
}

/**
 * 並びの順に見て、**横 1,200px 以上の版を持つ最初の行**の代表写真。どの行にも無ければ、写真のある最初の行の
 * 960px（2026-10-22・SEO。1,200 に届かない写真は代表に選ぶ順を下げる）
 */
function firstOgCover(spots: readonly Spot[]): TopicView["ogImage"] {
    let fallback: ReturnType<typeof coverOgOf>;
    for (const s of spots) {
        const og = coverOgOf(s);
        if (!og) continue;
        if (og.large) return { src: og.src, alt: og.alt, width: og.width, height: og.height };
        if (!fallback) fallback = og;
    }
    if (!fallback) return undefined;
    return { src: fallback.src, alt: fallback.alt, ...(fallback.width && fallback.height ? { width: fallback.width, height: fallback.height } : {}) };
}

/** OGP の画像: カードの並び（写真のある行が先）の順で `firstOgCover` */
function ogImageOf(spots: readonly Spot[], cards: readonly TopicCard[]): TopicView["ogImage"] {
    const bySlug = new Map(spots.map((s) => [s.slug, s]));
    return firstOgCover(cards.filter((c) => c.cover).map((c) => bySlug.get(c.slug)).filter((s): s is Spot => Boolean(s)));
}

/** 説明に足す事実: 時間帯の案内を持つ件数（数えた分だけ。無ければ足さない） */
function timeGuideNote(spots: readonly Spot[]): string | undefined {
    const k = spots.filter((s) => (s.timeOfDayGuide ?? []).length > 0).length;
    return k > 0 ? `時間帯ごとの撮影の案内があるのは${k}件です。` : undefined;
}

const names = (cards: readonly TopicCard[], n = 3) => cards.slice(0, n).map((c) => c.name).join("、");

/** カテゴリの内訳（多い順に `n` 個・「寺院14件・山岳12件」） */
function categoryBreakdown(spots: readonly Spot[], n = 3): string {
    const m = new Map<string, number>();
    for (const s of spots) if (s.category) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, n)
        .map(([c, k]) => `${c}${k}件`).join("・");
}

const seasonalCount = (spots: readonly Spot[]) => spots.filter((s) => (s.seasonalGuide ?? []).length > 0).length;
const latest = (spots: readonly Spot[]) => spots.map((s) => s.updatedAt).filter(Boolean).sort().pop();

/** 国の頁の導入文 */
export function countryIntro(t: CountryTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const kinds = categoryBreakdown(t.spots);
    return `${t.name}の撮影スポットを${n}件まとめました。`
        + (kinds ? `種類は${kinds}など。` : "")
        + (n > 1 ? `${names(cards)}${n > 3 ? "ほか" : ""}を載せています。` : "");
}

/** テーマの頁の導入文 */
export function themeIntro(t: ThemeTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const seasonal = seasonalCount(t.spots);
    return `${t.place.name}にある${t.category}の撮影スポットを${n}件まとめました。${names(cards)}など。`
        + (seasonal > 0 ? `うち${seasonal}件は季節ごとの撮影の案内があります。` : "");
}

/** 季節の頁の導入文 */
export function seasonIntro(t: SeasonTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const label = SEASON_JA[t.season];
    let text = t.area || cards.length >= n
        ? `${t.areaName ? `${t.areaName}で、` : ""}${label}の撮影の案内があるスポットを${n}件まとめました。${names(cards)}など。`
        : `${label}の撮影の案内があるスポットは${n}件あります。この頁には${names(cards)}など${cards.length}件を載せ、ほかは地方別の頁にあります。`;
    const kw = SEASON_KEYWORD[t.season];
    if (kw) {
        const k = t.spots.filter((s) => hasSeasonKeyword(s, t.season)).length;
        if (k > 0) text += `うち${k}件は${label}の案内に「${kw}」の記述があります。`;
    }
    if (!t.area) {
        // 全体の頁は地方の内訳（多い順に3つ）
        const m = new Map<string, number>();
        for (const s of t.spots) {
            const r = regionOf(s);
            const key = r ? REGION_LABEL[r] : OVERSEAS_NAME;
            m.set(key, (m.get(key) ?? 0) + 1);
        }
        const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, k]) => `${r}${k}件`).join("・");
        if (top) text += `多いのは${top}です。`;
    }
    return text;
}

// ─────────────────────────────────────────────────────────────
// 頁の組み立て
// ─────────────────────────────────────────────────────────────

const link = (href: string, label: string, count: number): TopicLink => ({ href, label, count });
const themeLink = (t: ThemeTopic): TopicLink => ({
    ...link(themePath(t), `${t.place.name}の${t.category}`, t.spots.length),
    labelEn: `${categoryEn(t.categorySlug)} in ${placeEn(t.place)}`,
});
const seasonLink = (t: SeasonTopic): TopicLink => ({
    ...link(seasonPath(t), seasonHeading(t).replace(/の撮影スポット$/, ""), t.spots.length),
    labelEn: `${SEASON_EN[t.season]}${t.area ? ` ${seasonAreaEn(t.area)}` : ""}`,
});
/**
 * 国のリンク。**頁が検索に出ない国（1件だけ・`MIN_INDEXABLE_COUNTRY` 未満）は、その1件のスポットの頁へ直に張る**
 * （2026-11-11 判断・札 journey.photo-ios#527）。
 *
 * 国の頁は `noindex, follow` なので、そこからしか張られていないスポットの頁は検索から見て孤立していた
 * （本番の sitemap の全 4,344 URL を辿って数えた: サン・ピエトロ大聖堂・ヴィクトリアの滝・エルデネ・ゾーの3件）。
 * 1件しかない国の頁は、押してもその1件へもう一度押す行き止まり同然なので、直に行くほうが手数も1回少ない。
 * 国の頁そのものは建てたまま（スポットの頁のパンくずから行ける）
 */
const countryLink = (t: CountryTopic): TopicLink => {
    const only = t.spots.length < MIN_INDEXABLE_COUNTRY && t.spots.length === 1 ? t.spots[0] : undefined;
    return only
        ? { ...link(`/spots/${only.slug}`, t.name, 1), labelEn: countryEn(t.code), itemName: only.name }
        : { ...link(ROUTES.SPOT_COUNTRY(t.code), t.name, t.spots.length), labelEn: countryEn(t.code) };
};
const OVERSEAS_CRUMB = () => ({ name: OVERSEAS_NAME, nameEn: "Outside Japan", href: ROUTES.SPOT_AREA(OVERSEAS_SLUG) });

/** 海外の一覧（`/spots/area/overseas`）: 国の一覧。カードは出さない（国の頁に分けた） */
export function overseasView(spots: readonly Spot[] = SPOTS): TopicView {
    const countries = countryTopics(spots);
    const total = countries.reduce((n, c) => n + c.spots.length, 0);
    const top = countries.slice(0, 3).map((c) => `${c.name}${c.spots.length}件`).join("・");
    return {
        path: ROUTES.SPOT_AREA(OVERSEAS_SLUG),
        heading: `${OVERSEAS_NAME}の撮影スポット`,
        headingEn: "Photo spots outside Japan",
        intro: total > 0
            ? `海外の撮影スポット${total}件を、${countries.length}の国・地域に分けています。多いのは${top}です。`
            : "",
        crumbs: [],
        cards: [],
        related: [
            { heading: "国・地域でさがす", headingEn: "By country or region", links: countries.map(countryLink) },
            {
                heading: "海外のテーマ", headingEn: "Themes outside Japan",
                links: themeTopics(spots).filter((t) => t.place.kind === "country").map(themeLink),
            },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(countries.flatMap((c) => c.spots)),
        lastModified: latest(countries.flatMap((c) => c.spots)),
    };
}

export function countryView(code: string, spots: readonly Spot[] = SPOTS): TopicView | null {
    const t = countryTopics(spots).find((c) => c.code === code);
    if (!t) return null;
    const cards = topicCards(t.spots);
    const themes = themeTopics(spots).filter((x) => x.place.kind === "country" && x.place.slug === code);
    return {
        path: ROUTES.SPOT_COUNTRY(code),
        heading: countryHeading(t),
        headingEn: countryHeadingEn(t),
        intro: countryIntro(t, cards),
        crumbs: [OVERSEAS_CRUMB()],
        cards,
        related: [
            { heading: `${t.name}のテーマ`, headingEn: `Themes in ${countryEn(code)}`, links: themes.map(themeLink) },
            { heading: "ほかの国・地域", headingEn: "Other countries and regions", links: countryTopics(spots).filter((c) => c.code !== code).slice(0, 12).map(countryLink) },
        ].filter((g) => g.links.length > 0),
        indexable: t.spots.length >= MIN_INDEXABLE_COUNTRY,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

export function themeView(categorySlug: string, place: string, spots: readonly Spot[] = SPOTS): TopicView | null {
    const all = themeTopics(spots);
    const t = all.find((x) => x.categorySlug === categorySlug && x.place.slug === place);
    if (!t) return null;
    const cards = topicCards(t.spots);
    // 上の段（県の一覧・国の一覧）。地方には一覧の頁が無いので飛ばす
    const parent = t.place.kind === "prefecture"
        ? [{ name: t.place.name, nameEn: placeEn(t.place), href: ROUTES.SPOT_AREA(t.place.areaSlug) }]
        : t.place.kind === "country"
            ? [OVERSEAS_CRUMB(), { name: t.place.name, nameEn: placeEn(t.place), href: ROUTES.SPOT_COUNTRY(t.place.slug) }]
            : [];
    const samePlace = all.filter((x) => x.place.kind === t.place.kind && x.place.slug === t.place.slug && x !== t);
    const sameCategory = all.filter((x) => x.categorySlug === t.categorySlug && x !== t);
    return {
        path: themePath(t),
        heading: themeHeading(t),
        headingEn: themeHeadingEn(t),
        intro: themeIntro(t, cards),
        crumbs: parent,
        cards,
        related: [
            { heading: `${t.place.name}のほかのテーマ`, headingEn: `Other themes in ${placeEn(t.place)}`, links: samePlace.map(themeLink) },
            { heading: `ほかの地域の${t.category}`, headingEn: `${categoryEn(t.categorySlug)} in other areas`, links: sameCategory.map(themeLink) },
            {
                heading: `季節でさがす（${t.category}）`, headingEn: `${categoryEn(t.categorySlug)} by season`,
                links: seasonThemeTopics(spots).filter((x) => x.categorySlug === t.categorySlug).map(seasonThemeLink),
            },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

/**
 * 季節の全体の頁に並べる数。**全部は並べない**（2026-10-11・実ビルド: 秋194件・冬202件を全部並べると
 * 1頁 600KB を超えた）。地方別の頁（全件を並べる）がある行は写真のある先頭からこの数まで、
 * **地方別の頁が無い行（件数の少ない地方・海外）は全部**載せる——どの行も、どこかの季節の頁から辿れる
 */
export const SEASON_TOP_CARDS = 36;

/**
 * 全体の頁の並び（2026-10-11 見直し）。**読み順の先頭36件にしない**——台帳の先頭は五十音の
 * 「あ」で、地方も偏る（秋は阿寺渓谷・愛知県庁が先頭だった）。
 *
 * 1. 地方（海外は1つ）ごとに、**写真がある → その季節の語（秋は「紅葉」）が案内にある → 台帳の順**で並べる
 * 2. 地方を**順に1件ずつ**取る（多い地方が並びを占めない）
 * 3. 地方別の頁が無い行は全部残し、ほかは2の順で `SEASON_TOP_CARDS` 件まで
 * 4. 画面の並びも2の順（写真のあるものが先）。題・OGP・導入文の名前はこの先頭から取る
 */
function seasonTopCards(t: SeasonTopic, subs: readonly SeasonTopic[]): TopicCard[] {
    const covered = new Set(subs.flatMap((x) => x.spots.map((s) => s.spotId)));
    const cards = new Map(t.spots.map((s) => [s.spotId, toTopicCard(s)]));
    const rank = (s: Spot) => (cards.get(s.spotId)!.cover ? 0 : 2) + (hasSeasonKeyword(s, t.season) ? 0 : 1);
    const buckets = new Map<string, Spot[]>();
    for (const s of t.spots) {
        const key = regionOf(s) ?? OVERSEAS_SLUG;
        buckets.set(key, [...(buckets.get(key) ?? []), s]);
    }
    const lists = [...buckets.values()].map((l) => l.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s));
    // 地方を順に回す。ただし「写真のある行」を全地方で取り切ってから写真の無い行へ
    const order: Spot[] = [];
    for (const pass of [(s: Spot) => Boolean(cards.get(s.spotId)!.cover), (s: Spot) => !cards.get(s.spotId)!.cover]) {
        const ls = lists.map((l) => l.filter(pass));
        for (let i = 0; ls.some((l) => i < l.length); i++) for (const l of ls) if (i < l.length) order.push(l[i]);
    }
    const orphans = order.filter((s) => !covered.has(s.spotId));
    const rest = order.filter((s) => covered.has(s.spotId)).slice(0, Math.max(0, SEASON_TOP_CARDS - orphans.length));
    const keep = new Set([...orphans, ...rest].map((s) => s.spotId));
    return order.filter((s) => keep.has(s.spotId)).map((s) => cards.get(s.spotId)!);
}

export function seasonView(season: string, area: string | null, spots: readonly Spot[] = SPOTS): TopicView | null {
    const all = seasonTopics(spots);
    const t = all.find((x) => x.season === season && x.area === area);
    if (!t) return null;
    const top = all.find((x) => x.season === t.season && x.area === null)!;
    const subs = all.filter((x) => x.season === t.season && x.area !== null);
    const cards = t.area ? topicCards(t.spots) : seasonTopCards(t, subs);
    const otherSeasons = all.filter((x) => x.season !== t.season && x.area === t.area);
    return {
        path: seasonPath(t),
        heading: seasonHeading(t),
        headingEn: seasonHeadingEn(t),
        intro: seasonIntro(t, cards),
        crumbs: t.area ? [{ name: seasonHeading(top), nameEn: seasonHeadingEn(top), href: seasonPath(top) }] : [],
        cards,
        related: [
            {
                heading: t.area ? `ほかの地方の${SEASON_JA[t.season]}` : "地方でさがす",
                headingEn: t.area ? `${SEASON_EN[t.season]} in other regions` : "By region",
                links: subs.filter((x) => x !== t).map(seasonLink),
            },
            { heading: "ほかの季節", headingEn: "Other seasons", links: otherSeasons.map(seasonLink) },
            {
                heading: `${SEASON_JA[t.season]}の撮影スポットを種類でさがす`, headingEn: `${SEASON_EN[t.season]} by type`,
                links: t.area ? [] : seasonThemeTopics(spots).filter((x) => x.season === t.season).map(seasonThemeLink),
            },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

const cityLink = (t: CityTopic): TopicLink => ({
    ...link(cityPath(t), `${t.prefName}${t.city}`, t.spots.length),
    labelEn: `${t.city}, ${t.prefNameEn}`,
});
const seasonThemeLink = (t: SeasonThemeTopic): TopicLink => ({
    ...link(seasonThemePath(t), `${SEASON_JA[t.season]}の${t.category}`, t.spots.length),
    labelEn: `${SEASON_EN[t.season]} ${categoryEn(t.categorySlug)}`,
});

/** 県の頁に並べる「市区町村でさがす」（その県の市区町村の頁・件数の多い順） */
export function cityLinksForPrefecture(prefSlug: string, spots: readonly Spot[] = SPOTS): TopicLink[] {
    return cityTopics(spots).filter((t) => t.prefSlug === prefSlug).map((t) => ({ ...link(cityPath(t), t.city, t.spots.length), labelEn: t.city }));
}

export function cityIntro(t: CityTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const seasonal = seasonalCount(t.spots);
    const kinds = categoryBreakdown(t.spots);
    return `${t.prefName}${t.city}の撮影スポットを${n}件まとめました。`
        + (kinds ? `種類は${kinds}など。` : "")
        + `${names(cards)}など。`
        + (seasonal > 0 ? `うち${seasonal}件は季節ごとの撮影の案内があります。` : "");
}

/**
 * **県の頁（`/spots/area/<県>`）の導入文**（2026-11-11・札 rymaruta/journey.photo-ios#527）。
 * 以前は件数の1文（「撮影スポットの案内です（57件）」）だけで、47頁が同じ形だった。
 * **その県の台帳から数えた事実だけ**を書く（決まり文句を足さない・`topicDescription` の注記と同じ線）:
 * 種類の内訳・多い市区町村・季節の案内がある件数・「桜」「紅葉」「雪」の記述がある件数。
 * 数が無い項目は文ごと省く。2件未満の県は空（並べる中身と同じことしか言えない）
 */
export function areaIntro(spots: readonly Spot[]): string {
    if (spots.length < 2) return "";
    const kinds = categoryBreakdown(spots);
    const cities = new Map<string, number>();
    for (const s of spots) if (s.region?.city) cities.set(s.region.city, (cities.get(s.region.city) ?? 0) + 1);
    // 1件ずつしか無い市区町村は「多い」と言えないので、2件以上の所だけ
    const topCities = [...cities.entries()].filter(([, k]) => k >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 3)
        .map(([c, k]) => `${c}${k}件`).join("・");
    const seasons = SEASONS.map((se) => [se, spots.filter((s) => hasSeason(s, se)).length] as const).filter(([, k]) => k > 0);
    const keywords = SEASONS.flatMap((se) => {
        const kw = SEASON_KEYWORD[se];
        const k = kw ? spots.filter((s) => hasSeasonKeyword(s, se)).length : 0;
        return kw && k > 0 ? [[kw, k] as const] : [];
    }).map(([kw, k], i) => i === 0 ? `「${kw}」の記述があるのは${k}件` : `「${kw}」は${k}件`);
    return (kinds ? `種類は${kinds}など。` : "")
        + (topCities ? `多いのは${topCities}です。` : "")
        + (seasons.length > 0 ? `季節ごとの撮影の案内があるのは${seasons.map(([se, k]) => `${SEASON_JA[se]}${k}件`).join("・")}です。` : "")
        + (keywords.length > 0 ? `季節の案内に${keywords.join("、")}です。` : "");
}

export function seasonThemeIntro(t: SeasonThemeTopic, cards: readonly TopicCard[]): string {
    const n = t.spots.length;
    const label = SEASON_JA[t.season];
    let text = `${label}の撮影の案内がある${t.category}のスポットを${n}件まとめました。${names(cards)}など。`;
    const kw = SEASON_KEYWORD[t.season];
    if (kw) {
        const k = t.spots.filter((s) => hasSeasonKeyword(s, t.season)).length;
        if (k > 0) text += `うち${k}件は${label}の案内に「${kw}」の記述があります。`;
    }
    return text;
}

export function cityView(prefSlug: string, city: string, spots: readonly Spot[] = SPOTS): TopicView | null {
    const all = cityTopics(spots);
    const t = all.find((x) => x.prefSlug === prefSlug && x.city === city);
    if (!t) return null;
    const cards = topicCards(t.spots);
    const sameRegion = all.filter((x) => x.prefSlug === prefSlug && x !== t);
    const themes = themeTopics(spots).filter((x) => x.place.kind === "prefecture" && x.place.slug === prefSlug);
    return {
        path: cityPath(t),
        heading: cityHeading(t),
        headingEn: cityHeadingEn(t),
        intro: cityIntro(t, cards),
        crumbs: [{ name: t.prefName, nameEn: t.prefNameEn, href: ROUTES.SPOT_AREA(t.prefSlug) }],
        cards,
        related: [
            { heading: `${t.prefName}のほかの市区町村`, headingEn: `Other cities in ${t.prefNameEn}`, links: sameRegion.map(cityLink) },
            { heading: `${t.prefName}のテーマ`, headingEn: `Themes in ${t.prefNameEn}`, links: themes.map(themeLink) },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

export function seasonThemeView(season: string, categorySlug: string, spots: readonly Spot[] = SPOTS): TopicView | null {
    const all = seasonThemeTopics(spots);
    const t = all.find((x) => x.season === season && x.categorySlug === categorySlug);
    if (!t) return null;
    const cards = topicCards(t.spots);
    const top = seasonTopics(spots).find((x) => x.season === t.season && x.area === null);
    return {
        path: seasonThemePath(t),
        heading: seasonThemeHeading(t),
        headingEn: seasonThemeHeadingEn(t),
        intro: seasonThemeIntro(t, cards),
        crumbs: top ? [{ name: seasonHeading(top), nameEn: seasonHeadingEn(top), href: seasonPath(top) }] : [],
        cards,
        related: [
            { heading: `${SEASON_JA[t.season]}のほかの種類`, headingEn: `Other types in ${SEASON_EN[t.season]}`, links: all.filter((x) => x.season === t.season && x !== t).map(seasonThemeLink) },
            { heading: `ほかの季節の${t.category}`, headingEn: `${categoryEn(t.categorySlug)} in other seasons`, links: all.filter((x) => x.categorySlug === t.categorySlug && x !== t).map(seasonThemeLink) },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        descriptionExtra: timeGuideNote(t.spots),
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}

const featureLink = (feature: FeatureKey, t: FeatureTopic): TopicLink => ({
    ...link(featurePath(feature, t), t.place ? `${t.place.name}の${FEATURES[feature].noun}` : `${FEATURES[feature].noun}の撮影スポット`, t.spots.length),
    labelEn: t.place ? `${FEATURES[feature].nounEn} in ${t.place.kind === "prefecture" ? t.place.nameEn : REGION_EN[t.place.region]}` : FEATURES[feature].headEn,
});
const momijiLink = (t: FeatureTopic): TopicLink => featureLink("momiji", t);

export function featureIntro(feature: FeatureKey, t: FeatureTopic, cards: readonly TopicCard[]): string {
    const def = FEATURES[feature];
    const n = t.spots.length;
    const where = t.place ? `${t.place.name}で、` : "";
    const kinds = categoryBreakdown(t.spots);
    const time = t.spots.filter((s) => (s.timeOfDayGuide ?? []).length > 0).length;
    // 2026-11-11 判断（札 rymaruta/journey.photo-ios#527）: まとめの頁は全部を並べない（`FEATURE_TOP_CARDS`）。
    // 題は並べた数（「36選」）なので、導入文も「全部で N 件・この頁には M 件」と分けて言う
    // （以前は「149件まとめました」と書き、題の「36選」と食い違っていた。`seasonIntro` と同じ言い方）
    const lead = cards.length < n
        ? `${where}${SEASON_JA[def.season]}の撮影の案内に「${def.keyword}」の記述があるスポットは${n}件あります。`
            + (kinds ? `種類は${kinds}など。` : "")
            + `この頁には${names(cards)}など${cards.length}件を載せ、ほかは地方・県の頁にあります。`
        : `${where}${SEASON_JA[def.season]}の撮影の案内に「${def.keyword}」の記述があるスポットを${n}件まとめました。`
            + (kinds ? `種類は${kinds}など。` : "")
            + `${names(cards)}など。`;
    // 一部だけ並べる頁では「うち」が並べた数のうちと読めるので、全体の数を言う
    return time > 0 ? `${lead}${cards.length < n ? `${n}件のうち` : "うち"}${time}件は時間帯ごとの撮影の案内もあります。` : lead;
}
export const momijiIntro = (t: FeatureTopic, cards: readonly TopicCard[]): string => featureIntro("momiji", t, cards);

/** まとめの頁に並べる数（全部は並べない・`SEASON_TOP_CARDS` と同じ理由）。地方・県の頁が無い行は全部残す */
export const FEATURE_TOP_CARDS = 36;
export const MOMIJI_TOP_CARDS = FEATURE_TOP_CARDS;

function featureTopCards(t: FeatureTopic, subs: readonly FeatureTopic[]): TopicCard[] {
    const covered = new Set(subs.flatMap((x) => x.spots.map((s) => s.spotId)));
    const ranked = topicCards(t.spots);                 // 写真のあるものが先
    const bySlug = new Map(t.spots.map((s) => [s.slug, s]));
    const orphans = ranked.filter((c) => !covered.has(bySlug.get(c.slug)!.spotId));
    // 地方を順に 1 件ずつ（多い地方が並びを占めない）
    const buckets = new Map<string, TopicCard[]>();
    for (const c of ranked.filter((c) => covered.has(bySlug.get(c.slug)!.spotId))) {
        const r = regionOf(bySlug.get(c.slug)!) ?? "?";
        buckets.set(r, [...(buckets.get(r) ?? []), c]);
    }
    const lists = [...buckets.values()];
    const rest: TopicCard[] = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) rest.push(l[i]);
    const keep = new Set([...orphans, ...rest.slice(0, Math.max(0, FEATURE_TOP_CARDS - orphans.length))].map((c) => c.slug));
    return ranked.filter((c) => keep.has(c.slug));
}

export function featureView(feature: FeatureKey, place: string | null, spots: readonly Spot[] = SPOTS): TopicView | null {
    const def = FEATURES[feature];
    const sj = SEASON_JA[def.season];
    const se = SEASON_EN[def.season];
    const all = featureTopics(feature, spots);
    const t = all.find((x) => (x.place?.slug ?? null) === place);
    if (!t) return null;
    const hub = all.find((x) => x.place === null)!;
    const subs = all.filter((x) => x.place !== null);
    const cards = t.place ? topicCards(t.spots) : featureTopCards(t, subs);
    const seasonTop = seasonTopics(spots).find((x) => x.season === def.season && x.area === null);
    const prefsInRegion = t.place?.kind === "region"
        ? subs.filter((x) => x.place!.kind === "prefecture" && (x.place as { region: string }).region === t.place!.region) : [];
    const lk = (x: FeatureTopic) => featureLink(feature, x);
    return {
        path: featurePath(feature, t),
        heading: featureHeading(feature, t),
        headingEn: featureHeadingEn(feature, t),
        intro: featureIntro(feature, t, cards),
        crumbs: t.place ? [{ name: `${def.noun}の撮影スポット`, nameEn: def.headEn, href: featurePath(feature, hub) }] : [],
        cards,
        related: [
            { heading: "地方でさがす", headingEn: "By region", links: t.place ? [] : subs.filter((x) => x.place!.kind === "region").map(lk) },
            { heading: "県でさがす", headingEn: "By prefecture", links: t.place ? prefsInRegion.map(lk) : subs.filter((x) => x.place!.kind === "prefecture").map(lk) },
            {
                heading: `ほかの地方・県の${def.noun}`, headingEn: "Other areas",
                links: t.place ? subs.filter((x) => x !== t && !prefsInRegion.includes(x)).slice(0, 12).map(lk) : [],
            },
            { heading: `${sj}の撮影スポット`, headingEn: `${se} photo spots`, links: seasonTop ? [seasonLink(seasonTop)] : [] },
            {
                heading: `${sj}の撮影スポットを種類でさがす`, headingEn: `${se} by type`,
                links: seasonThemeTopics(spots).filter((x) => x.season === def.season).map(seasonThemeLink),
            },
            // ほかの見どころ（桜・紅葉・雪景色の行き来）。まとめの頁だけ
            {
                heading: "ほかの季節の見どころ", headingEn: "Other seasonal highlights",
                links: t.place ? [] : FEATURE_KEYS.filter((k) => k !== feature).flatMap((k) => {
                    const h = featureTopics(k, spots).find((x) => x.place === null);
                    return h ? [featureLink(k, h)] : [];
                }),
            },
        ].filter((g) => g.links.length > 0),
        indexable: true,
        // 時間帯の件数は導入文（`featureIntro`）が言っている。ここで足すと説明に同じ事実が2回並ぶ
        // （「うち93件は時間帯ごとの…。時間帯ごとの…のは93件です。」・2026-11-11 本番の HTML で確かめた・#527）
        ogImage: ogImageOf(t.spots, cards),
        lastModified: latest(t.spots),
    };
}
export const momijiView = (place: string | null, spots: readonly Spot[] = SPOTS): TopicView | null => featureView("momiji", place, spots);

/** 構造化データ（パンくず・並べたスポットの `ItemList`）。**画面に並べたものと同じ順** */
export function topicStructuredData(view: TopicView) {
    const abs = (p: string) => `${siteConfig.url}${p}`;
    const breadcrumb = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: "撮影スポット", url: abs(ROUTES.SPOTS) },
        ...view.crumbs.map((c) => ({ name: c.name, url: abs(c.href) })),
        { name: view.heading, url: abs(view.path) },
    ]);
    // カードの無い頁（海外の国の一覧）は、並べている国のリンクを ItemList にする
    const items = view.cards.length > 0
        ? view.cards.map((c) => ({ name: c.name, url: abs(`/spots/${c.slug}`) }))
        : (view.related[0]?.links ?? []).map((l) => ({ name: l.itemName ?? `${l.label}の撮影スポット`, url: abs(l.href) }));
    const itemList = items.length > 0 ? generateItemListStructuredData(view.heading, items) : null;
    return { breadcrumb, itemList };
}

/**
 * **OGP の画像に使う代表写真**（台帳の順で、代表写真を持つ最初の行の元の大きさ）。
 * 撮影スポットの入口（`/spots`）は子の `openGraph` が親の画像を消すので、絵が無かった（2026-10-16）
 */
export function firstSpotOgImage(
    spots: readonly Spot[],
    alt: string,
): { url: string; alt: string; width?: number; height?: number } | undefined {
    // 2026-10-22: 横 1,200px 以上の版を持つ行を先に（`firstOgCover`）
    const og = firstOgCover(spots);
    if (!og) return undefined;
    return {
        url: og.src.startsWith("http") ? og.src : `${siteConfig.url}${og.src}`,
        alt,
        ...(og.width && og.height ? { width: og.width, height: og.height } : {}),
    };
}

/**
 * **県の頁（`/spots/area/<県>`）の構造化データと OGP の画像**（2026-10-16・SEO）。
 *
 * 切り口の頁（国・テーマ・季節）はパンくずと `ItemList` と代表写真の OGP を持っていたのに、
 * 一番数の多い入口の県の頁（47頁）だけ、どれも無かった（実ビルドで数えた）。
 * 並びは**画面と同じ**（`spotIndexItemsForArea` ＝ `visibleSpotsInArea` の順）。
 * 画像は切り口の頁と同じ判断（写真のある先頭の行の、元の大きさの代表写真）
 */
export function areaStructuredData(area: { slug: string; name: string }, spots: readonly Spot[]) {
    const abs = (p: string) => `${siteConfig.url}${p}`;
    const path = `${ROUTES.SPOTS}/area/${area.slug}`;
    const heading = `${area.name}の撮影スポット`;
    const breadcrumb = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: "撮影スポット", url: abs(ROUTES.SPOTS) },
        { name: area.name, url: abs(path) },
    ]);
    const items = spots.map((s) => ({ name: s.name, url: abs(`${ROUTES.SPOTS}/${s.slug}`) }));
    const itemList = items.length > 0 ? generateItemListStructuredData(heading, items) : null;
    const og = ogImageOf(spots, topicCards(spots));
    const ogImage = og
        ? {
            url: og.src.startsWith("http") ? og.src : abs(og.src),
            ...(og.width && og.height ? { width: og.width, height: og.height } : {}),
            alt: heading,
        }
        : undefined;
    return { breadcrumb, itemList, ogImage };
}

/** 頁の題（`<title>`）。検索に出す頁は「N選」（県の頁 `/spots/area/<x>` と同じ言い方） */
export function topicTitle(view: TopicView): string {
    const n = view.cards.length;
    return view.indexable && n > 0 ? `${view.heading}${n}選` : view.heading;
}

/**
 * 頁の説明（`description`）。導入文の頭に件数が入っている。
 * 🔴 **決まり文句を足さない**（以前は「見どころ・季節・時間帯の撮影ガイドつき。」を全頁に付けていたが、
 * 季節の案内は全体の約4分の1、時間帯は約2割の行にしか無い）。足すのは数えた事実だけ
 */
export function topicDescription(view: TopicView): string {
    return `${view.intro}${view.descriptionExtra ?? ""}`.slice(0, 160);
}

// ─────────────────────────────────────────────────────────────
// 内部リンク: スポットの頁 → 属する切り口
// ─────────────────────────────────────────────────────────────

/**
 * そのスポットが載っている切り口の頁（国・テーマ・季節）。**頁が在るものだけ**。
 * 並び: 国 → テーマ（県・地方・国）→ 季節（地方別が在ればそちら、無ければ全体）
 */
export function topicLinksForSpot(spot: Spot, spots: readonly Spot[] = SPOTS): TopicLink[] {
    if (!topicSpots(spots).some((s) => s.spotId === spot.spotId)) return [];
    const out: TopicLink[] = [];
    const code = countryCode(spot.region?.country);
    const country = code ? countryTopics(spots).find((c) => c.code === code) : undefined;
    if (country) out.push({ ...link(ROUTES.SPOT_COUNTRY(country.code), countryHeading(country), country.spots.length), labelEn: countryHeadingEn(country) });
    for (const t of themeTopics(spots)) {
        if (t.spots.some((s) => s.spotId === spot.spotId)) out.push({ ...link(themePath(t), themeHeading(t), t.spots.length), labelEn: themeHeadingEn(t) });
    }
    const city = cityTopics(spots).find((t) => t.spots.some((x) => x.spotId === spot.spotId));
    if (city) out.push({ ...link(cityPath(city), cityHeading(city), city.spots.length), labelEn: cityHeadingEn(city) });
    const seasons = seasonTopics(spots);
    for (const season of SEASONS) {
        if (!hasSeason(spot, season)) continue;
        const mine = seasons.filter((t) => t.season === season && t.spots.some((s) => s.spotId === spot.spotId));
        const best = mine.find((t) => t.area !== null) ?? mine.find((t) => t.area === null);
        if (best) out.push({ ...link(seasonPath(best), seasonHeading(best), best.spots.length), labelEn: seasonHeadingEn(best) });
    }
    // 紅葉・桜・雪景色（県の頁があればそれ、無ければ地方、無ければまとめ）
    for (const feature of FEATURE_KEYS) {
        const mine = featureTopics(feature, spots).filter((t) => t.spots.some((x) => x.spotId === spot.spotId));
        const best = mine.find((t) => t.place?.kind === "prefecture") ?? mine.find((t) => t.place?.kind === "region") ?? mine[0];
        if (best) out.push({ ...link(featurePath(feature, best), featureHeading(feature, best), best.spots.length), labelEn: featureHeadingEn(feature, best) });
    }
    for (const t of seasonThemeTopics(spots)) {
        if (t.spots.some((x) => x.spotId === spot.spotId)) out.push({ ...link(seasonThemePath(t), seasonThemeHeading(t), t.spots.length), labelEn: seasonThemeHeadingEn(t) });
    }
    return out;
}

/**
 * スポットの国の頁（パンくず・「すべて見る」の行き先）。国の頁が在るときだけ。
 * 海外のスポットのパンくずは 海外 → 国 → スポット（区画の一覧は国の一覧になったので、
 * 間に国を入れないと「すべて見る」がスポットの無い頁に飛ぶ）
 */
export function spotCountryRef(spot: Spot, spots: readonly Spot[] = SPOTS): { href: string; name: string; nameEn: string } | null {
    const code = countryCode(spot.region?.country);
    const c = code ? countryTopics(spots).find((x) => x.code === code) : undefined;
    return c ? { href: ROUTES.SPOT_COUNTRY(c.code), name: c.name, nameEn: countryEn(c.code) } : null;
}

// ─────────────────────────────────────────────────────────────
// `/spots` の入口
// ─────────────────────────────────────────────────────────────

/** `/spots` に並べる切り口（季節・テーマ）。テーマはカテゴリごとにまとめる */
export function spotIndexTopics(spots: readonly Spot[] = SPOTS): {
    seasons: TopicLink[];
    themes: Array<{ category: string; categoryEn: string; links: TopicLink[] }>;
    seasonThemes: TopicLink[];
    cities: TopicLink[];
    momiji: TopicLink[];
    sakura: TopicLink[];
    snow: TopicLink[];
} {
    const seasons = seasonTopics(spots).filter((t) => t.area === null)
        .map((t) => ({ ...link(seasonPath(t), seasonHeading(t), t.spots.length), labelEn: seasonHeadingEn(t) }));
    const themes: Array<{ category: string; categoryEn: string; links: TopicLink[] }> = [];
    for (const t of themeTopics(spots)) {
        let g = themes.find((x) => x.category === t.category);
        if (!g) themes.push(g = { category: t.category, categoryEn: categoryEn(t.categorySlug), links: [] });
        g.links.push({ ...link(themePath(t), t.place.name, t.spots.length), labelEn: placeEn(t.place) });
    }
    return {
        seasons, themes,
        seasonThemes: seasonThemeTopics(spots).map(seasonThemeLink),
        cities: cityTopics(spots).map(cityLink),
        momiji: featureTopics("momiji", spots).map((t) => featureLink("momiji", t)),
        sakura: featureTopics("sakura", spots).map((t) => featureLink("sakura", t)),
        snow: featureTopics("snow", spots).map((t) => featureLink("snow", t)),
    };
}

// ─────────────────────────────────────────────────────────────
// ホーム: いまの季節の撮影スポット
// ─────────────────────────────────────────────────────────────

/** 月（1〜12）→ 季節（北半球・日本の暦） */
export function seasonOfMonth(month: number): SpotSeason {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
}

/** 日本時間の年と月 */
function jstYearMonth(now: Date): { year: number; month: number } {
    const j = new Date(now.getTime() + 9 * 3600 * 1000);
    return { year: j.getUTCFullYear(), month: j.getUTCMonth() + 1 };
}

/** 決まった並びを作るための小さなハッシュ（FNV-1a） */
function hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

export type HomeSeasonSpot = { slug: string; name: string; region: string; src: string; alt: string; credit: TopicCredit | null };
export type HomeSeasonal = { season: SpotSeason; href: string; total: number; spots: HomeSeasonSpot[] };

/**
 * ホームに並べる「いまの季節の撮影スポット」。**ビルドの時点の月（日本時間）で決める。**
 *
 * - その季節の案内（`seasonalGuide`）を持ち、**代表写真がある**公開済みの行だけ
 * - **南半球の行は外す**（日本の月の季節と逆になる。座標の緯度が負の行）
 * - 並びは「スラッグ＋年月」のハッシュ順＝**同じ月のビルドなら同じ顔ぶれ**、月が変わると入れ替わる
 *   （定期ビルドは週1。ビルドの日付で中身が変わるのはこの節だけ）
 */
export function homeSeasonalSpots(now: Date, spots: readonly Spot[] = SPOTS, limit = 6): HomeSeasonal | null {
    const { year, month } = jstYearMonth(now);
    const season = seasonOfMonth(month);
    const pool = topicSpots(spots).filter((s) => hasSeason(s, season) && !(s.coords && s.coords.lat < 0));
    const withCover = pool
        .map((s) => ({ s, card: toTopicCard(s) }))
        .filter((x) => x.card.cover)
        .sort((a, b) => hash(`${a.s.slug}:${year}-${month}`) - hash(`${b.s.slug}:${year}-${month}`) || a.s.slug.localeCompare(b.s.slug));
    if (withCover.length === 0) return null;
    return {
        season,
        href: ROUTES.SPOT_SEASON(season),
        total: topicSpots(spots).filter((s) => hasSeason(s, season)).length,
        spots: withCover.slice(0, limit).map(({ card }) => ({
            slug: card.slug, name: card.name, region: card.region,
            src: card.cover!.src, alt: card.cover!.alt, credit: card.cover!.credit,
        })),
    };
}

// ─────────────────────────────────────────────────────────────
// サイトマップ（`lib/server/sitemap.ts` から1行で呼ぶ・別の枝と衝突を小さくするため関数を分ける）
// ─────────────────────────────────────────────────────────────

type SitemapEntry = { url: string; lastModified?: string | Date; changeFrequency: "weekly"; priority: number };

/**
 * 切り口の頁のうち**検索に出すもの**（国は `MIN_INDEXABLE_COUNTRY` 件以上・テーマ・季節は全部）。
 * `lastModified` は**載せたスポットの更新日の最大**（ビルドの時刻にしない）
 */
export function spotTopicSitemapEntries(baseUrl: string = siteConfig.url, spots: readonly Spot[] = SPOTS): SitemapEntry[] {
    // 日付が取れない行は lastModified を書かない（ビルドの時刻を「更新日」と申告しない・2026-11-09）
    const entry = (path: string, members: readonly Spot[], priority: number): SitemapEntry => ({
        url: `${baseUrl}${path}`,
        ...(latest(members) ? { lastModified: latest(members) } : {}),
        changeFrequency: "weekly",
        priority,
    });
    return [
        ...countryTopics(spots).filter((c) => c.spots.length >= MIN_INDEXABLE_COUNTRY).map((c) => entry(ROUTES.SPOT_COUNTRY(c.code), c.spots, 0.6)),
        ...themeTopics(spots).map((t) => entry(themePath(t), t.spots, 0.5)),
        ...seasonTopics(spots).map((t) => entry(seasonPath(t), t.spots, t.area ? 0.5 : 0.6)),
        ...cityTopics(spots).map((t) => entry(cityPath(t), t.spots, 0.5)),
        ...seasonThemeTopics(spots).map((t) => entry(seasonThemePath(t), t.spots, 0.5)),
        // 紅葉・桜・雪景色（まとめは季節の全体と同じ 0.6・季節の需要が大きい）
        ...FEATURE_KEYS.flatMap((f) => featureTopics(f, spots).map((t) => entry(featurePath(f, t), t.spots, t.place ? 0.5 : 0.6))),
    ];
}

// ─────────────────────────────────────────────────────────────
// 頁の metadata（4つの route で共用）
// ─────────────────────────────────────────────────────────────

/**
 * 題・説明・canonical・robots・OGP。**県の頁（`/spots/area/<x>`）と同じ形。**
 * 検索に出さない頁（1件の国）は `noindex, follow`（リンクは辿らせる）
 */
export function topicMetadata(view: TopicView | null) {
    if (!view) return { robots: { index: false, follow: true } };
    const title = topicTitle(view);
    const description = topicDescription(view);
    const url = `${siteConfig.url}${view.path}`;
    // 代表写真があれば OGP に出す（先頭のカード＝写真のあるものが先）。**元の大きさ**（`ogImage`）
    const og = view.ogImage;
    const image = og ? (og.src.startsWith("http") ? og.src : `${siteConfig.url}${og.src}`) : undefined;
    return {
        title,
        description,
        alternates: { canonical: url },
        robots: pageRobots(view.indexable),
        openGraph: {
            type: "website" as const, url, siteName: siteConfig.name,
            locale: siteConfig.locale.ja, title, description,
            // 写真が無ければサイトの固定の代表画像（2026-10-31 #432。書かないと og:image が出ない）
            images: [image ? { url: image, ...(og?.width && og?.height ? { width: og.width, height: og.height } : {}), alt: view.heading } : shareOgImage()],
        },
        twitter: spotTwitterMeta(title, description, image),
    };
}

/**
 * **X（Twitter）のカード**（2026-10-22）。子が `twitter` を書かないと、レイアウトの値（新着の投稿写真・サイト名の題）が
 * そのまま残り、og:image と別の1枚・別の題になっていた（県・季節の頁で実測）。og:image と同じ1枚を渡す。
 * 画像が無ければサイトの固定の代表画像（`SHARE_IMAGE`・2026-10-31 #432。og:image の落とし先と同じ）
 */
export function spotTwitterMeta(title: string, description: string, image: string | undefined) {
    return { card: "summary_large_image" as const, title, description, images: [image ?? shareImageUrl()], creator: siteConfig.twitterHandle };
}
