import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    featureTopics, featureView, seasonTopics, seasonView, topicMetadata, topicTitle,
    FEATURE_KEYS, FEATURES, THEME_TITLE_MAX, THEME_DESCRIPTION_MAX, TOPIC_OG_MIN_WIDTH, MIN_TOPIC_SPOTS, hasSeasonKeyword,
    type TopicView,
} from "../spotTopics";
import { siteConfig, HOME_TITLE, HOME_DESCRIPTION } from "../../utils/seo";
import { titleWidth } from "../../utils/titleWidth";

/**
 * **検索から人を呼ぶための題・説明・OGP**（2026-11-18・札 rymaruta/journey.photo-ios#432 の続き）。
 *
 * owner「アプリや WEB が全然認知されていない」。GSC（10-31 時点の過去28日）で表示 1.21万・クリック 191（約1.6%）。
 * 本番の題は「紅葉の観光スポット36選 | Journey Photo 旅フォトギャラリー」で、
 *   - 日本の人が打つ語（「紅葉 見頃」「京都 紅葉 名所」「桜 名所」）が無かった（紅葉の頁に「見頃」が0回）
 *   - 「36選」は並べた数で、全体（170か所）より小さく見えた
 *   - 後ろ 17 字がサイト名で、検索結果で切れていた
 * 一覧の頁の og:image は Wikimedia Commons への直リンクだった。
 */

const featureViews = FEATURE_KEYS.flatMap((k) => featureTopics(k).map((t) => ({ key: k, t, v: featureView(k, t.place?.slug ?? null)! })));
const seasonViews = seasonTopics().map((t) => ({ t, v: seasonView(t.season, t.area)! }));
const all: TopicView[] = [...featureViews.map((x) => x.v), ...seasonViews.map((x) => x.v)];
const desc = (v: TopicView) => topicMetadata(v).description as string;

describe("季節・紅葉・桜・雪景色の頁の題", () => {
    it("前提: 頁がある（まとめ・地方・県・季節）", () => {
        expect(featureViews.length).toBeGreaterThan(FEATURE_KEYS.length * 3);
        expect(seasonViews.length).toBeGreaterThan(4);
    });

    it("🔴 全角換算 33 以内・サイト名を付けない完全な形（absolute）・禁止の語が無い", () => {
        for (const v of all) {
            const t = topicTitle(v);
            expect(titleWidth(t), `${v.path}: ${t}`).toBeLessThanOrEqual(THEME_TITLE_MAX);
            expect(topicMetadata(v).title, v.path).toEqual({ absolute: t });
            // 撮りどき（owner 2026-10-22）・撮影スポット（2026-11-12 から観光スポット）・中黒の区切り（2026-11-12）
            expect(t, v.path).not.toMatch(/Journey Photo|旅フォトギャラリー|撮りどき|撮影スポット|注目スポット|撮影地ガイド|·/);
        }
    });

    it("🔴 紅葉・桜・雪景色の題は「名所」、まとめの題は「見頃」と全体の数（並べた36ではない）", () => {
        for (const { key, t, v } of featureViews) {
            const title = topicTitle(v);
            expect(title, v.path).toContain(t.place ? FEATURES[key].titleNoun : "名所");
            if (!t.place) {
                expect(title, v.path).toContain(`${t.spots.length}か所`);
                if (key !== "snow") expect(title, v.path).toContain("見頃");
            }
        }
        // 「京都 紅葉 名所」「関西 紅葉」の形
        expect(topicTitle(featureView("momiji", "kyoto")!)).toMatch(/^京都府の紅葉の名所\d+選｜/);
        expect(topicTitle(featureView("momiji", "kinki")!)).toMatch(/^関西の紅葉の名所\d+選/);
        expect(topicTitle(featureView("momiji", null)!)).toMatch(/^紅葉の見頃に行きたい名所\d+か所｜全国の観光スポット$/);
        expect(topicTitle(featureView("sakura", null)!)).toMatch(/^桜の見頃に行きたい名所\d+か所/);
    });

    it("🔴 季節の題は全体の数と、その季節の名所の数（紅葉・桜・雪景色。少ない頁は名所の名前）", () => {
        for (const { t, v } of seasonViews) {
            const title = topicTitle(v);
            expect(title, v.path).toMatch(new RegExp(`の観光スポット${v.cards.length >= t.spots.length ? `${v.cards.length}選` : `${t.spots.length}か所`}(｜|$)`));
            const k = t.spots.filter((s) => hasSeasonKeyword(s, t.season)).length;
            const noun = t.season === "autumn" ? "紅葉の名所" : t.season === "spring" ? "桜の名所" : t.season === "winter" ? "雪景色の名所" : null;
            if (noun && k >= MIN_TOPIC_SPOTS && titleWidth(title) <= THEME_TITLE_MAX) expect(title, v.path).toContain(`${noun}${k}か所も`);
            if (k < MIN_TOPIC_SPOTS) expect(title, v.path).not.toMatch(/名所\d+か所も/);
        }
        expect(topicTitle(seasonView("autumn", null)!)).toMatch(/^秋の観光スポット\d+か所｜紅葉の名所\d+か所も$/);
    });
});

describe("季節・紅葉・桜・雪景色の頁の説明と本文", () => {
    it("🔴 説明は 120 字以内・文の途中で切らない・数えた数と合う", () => {
        for (const v of all) {
            const d = desc(v);
            expect([...d].length, `${v.path}: ${d}`).toBeLessThanOrEqual(THEME_DESCRIPTION_MAX);
            expect(d.endsWith("。"), `${v.path}: ${d}`).toBe(true);
            expect(d, v.path).not.toMatch(/撮りどき|撮影スポット|·/);
        }
        for (const { t, v } of featureViews) expect(desc(v), v.path).toContain(`の名所${t.spots.length}か所。`);
        for (const { t, v } of seasonViews) expect(desc(v), v.path).toContain(`の観光スポット${t.spots.length}か所。`);
    });

    it("🔴 「見頃」が紅葉・桜の説明と、紅葉・桜・雪景色・秋の本文（導入文）に入る", () => {
        for (const { key, v } of featureViews) {
            if (key !== "snow") expect(desc(v), v.path).toContain("見頃");
            expect(v.intro, v.path).toContain("見頃");
        }
        expect(seasonView("autumn", null)!.intro).toContain("紅葉の見頃");
        expect(desc(seasonView("autumn", null)!)).toContain("紅葉の見頃");
    });

    it("🔴 見頃の日付・月・旬を作らない（台帳は春夏秋冬の4つだけ）", () => {
        for (const v of all) {
            for (const text of [topicTitle(v), desc(v), v.intro]) {
                expect(text, v.path).not.toMatch(/\d+月|[一二三四五六七八九十]+月|上旬|中旬|下旬|例年|ピーク/);
            }
        }
    });
});

describe("一覧の頁の og:image は自前の画像", () => {
    it("🔴 季節・紅葉・桜・雪景色の頁は、サイトに置いた代表写真（Commons への直リンクにしない）", () => {
        for (const v of all) {
            const og = topicMetadata(v).openGraph!.images![0] as { url: string; width?: number };
            expect(og.url.startsWith(`${siteConfig.url}/`), `${v.path}: ${og.url}`).toBe(true);
            expect(og.url, v.path).not.toMatch(/wikimedia\.org|wikipedia\.org/);
            if (og.url.includes("/images/spots/")) expect(og.width, v.path).toBeGreaterThanOrEqual(TOPIC_OG_MIN_WIDTH);
        }
        // 写真のある頁ばかり（サイトの代表画像に落ちる頁が大半なら組み方が効いていない）
        expect(all.filter((v) => (topicMetadata(v).openGraph!.images![0] as { url: string }).url.includes("/images/spots/")).length).toBe(all.length);
    });
});

describe("トップとサイト名の部分", () => {
    it("🔴 トップの題に「観光スポット」・サイト名は Journey Photo のまま・33 以内", () => {
        expect(HOME_TITLE.startsWith("Journey Photo | ")).toBe(true);
        expect(HOME_TITLE).toContain("観光スポット");
        expect(titleWidth(HOME_TITLE)).toBeLessThanOrEqual(THEME_TITLE_MAX);
        expect(HOME_DESCRIPTION.startsWith(siteConfig.description)).toBe(true);
        expect(HOME_DESCRIPTION).toContain("観光スポット");
        expect([...HOME_DESCRIPTION].length).toBeLessThanOrEqual(120);
    });

    it("🔴 トップの metadata が HOME_TITLE を absolute で使う（og・X のカードも同じ）", async () => {
        const { generateMetadata } = await import("../../../app/page");
        const m = await generateMetadata();
        expect(m.title).toEqual({ absolute: HOME_TITLE });
        expect(m.description).toBe(HOME_DESCRIPTION);
        expect((m.openGraph as { title?: string }).title).toBe(HOME_TITLE);
        expect((m.twitter as { title?: string }).title).toBe(HOME_TITLE);
    });

    it("🔴 ほかの頁の題の後ろは「 | Journey Photo」だけ（17 字の「Journey Photo 旅フォトギャラリー」で切れていた）", () => {
        const layout = fs.readFileSync(path.join(__dirname, "../../../app/layout.tsx"), "utf8");
        expect(layout).toContain("template: `%s | Journey Photo`,");
        expect(layout).not.toMatch(/template: `%s \| Journey Photo 旅フォトギャラリー`/);
    });
});
