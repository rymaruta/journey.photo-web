import { describe, it, expect } from "vitest";
import raw from "@/content/local-food.json";
import { SPOTS } from "../spots";
import { isPublished } from "../../utils/spotGuide";
import { prefectureBySlug } from "../prefectures";
import { titleWidth } from "../../utils/titleWidth";
import {
    FOOD_AREAS, foodAreas, foodArea, isFoodPublished, isFoodIndexable, foodSpotLinks,
    foodTitle, foodDescription, foodHeading, FOOD_TITLE_MAX, FOOD_DESCRIPTION_MAX, MIN_INDEXABLE_DISHES,
    type FoodArea, type FoodItem,
} from "../localFood";

/**
 * **郷土料理とお土産の台帳**（`content/local-food.json`・2026-11-23 案 B）の決まり。
 * 冒頭の決まりは `lib/data/localFood.ts`。ここは台帳を全部読んで、破れていないかを見る
 */
const items = (a: FoodArea): FoodItem[] => [...a.dishes, ...a.souvenirs];

describe("台帳の決まり", () => {
    it("5 県から始める（北海道・宮城・京都・広島・沖縄）・県の綴りは実在・重複なし", () => {
        const slugs = FOOD_AREAS.map((a) => a.area);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of slugs) expect(prefectureBySlug(s), s).toBeTruthy();
        expect([...slugs].sort()).toEqual(["hiroshima", "hokkaido", "kyoto", "miyagi", "okinawa"]);
    });

    it("出典は品目ごとに農水省「うちの郷土料理」の頁（https）と読んだ日", () => {
        for (const a of FOOD_AREAS) for (const it of items(a)) {
            expect(it.source.url, `${a.area}/${it.id}`).toMatch(/^https:\/\/www\.maff\.go\.jp\/j\/keikaku\/syokubunka\/k_ryouri\/search_menu\/menu\/[a-z0-9_]+\.html$/);
            expect(it.source.title, `${a.area}/${it.id}`).toMatch(/^農林水産省「うちの郷土料理」/);
            expect(it.source.retrievedAt, `${a.area}/${it.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("錨（id）は県の中で重複しない・綴りは英小文字と数字とハイフン", () => {
        for (const a of FOOD_AREAS) {
            const ids = items(a).map((x) => x.id);
            expect(new Set(ids).size, a.area).toBe(ids.length);
            for (const id of ids) expect(id, `${a.area}/${id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }
    });

    it("🔴 撮影スポットは、台帳に公開中で、その県のものだけ（推測で他県や下書きに結ばない）", () => {
        const bySlug = new Map(SPOTS.map((s) => [s.slug, s]));
        for (const a of FOOD_AREAS) {
            const pref = prefectureBySlug(a.area)!.name;
            for (const it of items(a)) for (const slug of it.spots) {
                const s = bySlug.get(slug);
                expect(s, `${a.area}/${it.id}: ${slug} が台帳に無い`).toBeTruthy();
                expect(isPublished(s!), `${a.area}/${it.id}: ${slug} が公開されていない`).toBe(true);
                expect(s!.region?.prefecture, `${a.area}/${it.id}: ${slug}`).toBe(pref);
            }
            // 頁に出るのも同じ数（落ちる綴りが無い）
            for (const it of items(a)) expect(foodSpotLinks(it).length, `${a.area}/${it.id}`).toBe(it.spots.length);
        }
    });

    it("🔴 お店を載せない・写真を使わない（店名・営業・評価・画像の欄を持たない）", () => {
        const banned = /(shop|store|restaurant|rating|price|hours|image|photo|cover)/i;
        for (const a of (raw as { areas: Array<Record<string, unknown>> }).areas) {
            for (const k of Object.keys(a)) expect(k, a.area as string).not.toMatch(banned);
            for (const it of [...(a.dishes as Array<Record<string, unknown>>), ...(a.souvenirs as Array<Record<string, unknown>>)]) {
                for (const k of Object.keys(it)) expect(k, `${a.area}/${it.id}`).not.toMatch(banned);
            }
        }
    });

    it("公開の印: 確かめた日・委任した人（AI の名前は書けない）・何と照らしたか", () => {
        for (const a of FOOD_AREAS.filter((x) => x.status === "published")) {
            expect(isFoodPublished(a), a.area).toBe(true);
            expect(a.aiCheck!.checkedAt, a.area).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(a.aiCheck!.delegatedBy, a.area).not.toMatch(/claude|gpt|ai\b|anthropic|openai/i);
        }
    });

    it("要約・時季・地域は空でない・要約は文で終わる", () => {
        for (const a of FOOD_AREAS) {
            expect(a.intro.trim().length, a.area).toBeGreaterThan(10);
            for (const it of items(a)) {
                expect(it.name.trim(), `${a.area}/${it.id}`).not.toBe("");
                expect(it.where.trim(), `${a.area}/${it.id}`).not.toBe("");
                expect(it.summary, `${a.area}/${it.id}`).toMatch(/。$/);
                if (it.season !== null) expect(it.season.trim(), `${a.area}/${it.id}`).not.toBe("");
            }
        }
    });
});

describe("公開・検索に出す線", () => {
    const base: FoodArea = {
        area: "hokkaido", status: "published",
        aiCheck: { checkedAt: "2026-11-23", delegatedBy: "owner", method: "出典の頁と1文ずつ照らした" },
        intro: "導入文です。", dishes: [], souvenirs: [],
    };
    const dish = (n: number): FoodItem => ({
        id: `d${n}`, name: `料理${n}`, where: "道内全域", season: null, summary: "要約です。", spots: [],
        source: { title: "農林水産省「うちの郷土料理」料理", url: "https://www.maff.go.jp/x.html", retrievedAt: "2026-11-23" },
    });

    it("下書き・確かめた記録の無い行は建てない", () => {
        expect(isFoodPublished({ ...base, status: "review" })).toBe(false);
        expect(isFoodPublished({ ...base, aiCheck: undefined })).toBe(false);
        expect(isFoodPublished({ ...base, aiCheck: { ...base.aiCheck!, delegatedBy: " " } })).toBe(false);
        expect(foodAreas([{ ...base, status: "review" }])).toEqual([]);
        expect(foodArea("hokkaido", [{ ...base, status: "review" }])).toBeUndefined();
    });

    it(`郷土料理が ${MIN_INDEXABLE_DISHES} 品未満なら頁は建てるが検索に出さない`, () => {
        const few = { ...base, dishes: Array.from({ length: MIN_INDEXABLE_DISHES - 1 }, (_, i) => dish(i)) };
        const enough = { ...base, dishes: Array.from({ length: MIN_INDEXABLE_DISHES }, (_, i) => dish(i)) };
        expect(foodAreas([few])).toHaveLength(1);
        expect(isFoodIndexable(few)).toBe(false);
        expect(isFoodIndexable(enough)).toBe(true);
    });
});

describe("題と説明", () => {
    it("題: 「〇〇の郷土料理とお土産｜A、Bほか」・全角33以内に収まる形を上から", () => {
        const d = (name: string) => ({ name }) as FoodItem;
        const s = [d("松前漬")];
        expect(foodTitle("北海道", { dishes: [d("豚丼"), d("いかめし")], souvenirs: s })).toBe("北海道の郷土料理とお土産｜豚丼、いかめしほか");
        expect(foodTitle("北海道", { dishes: [d("あ".repeat(10)), d("い".repeat(10))], souvenirs: s })).toBe(`北海道の郷土料理とお土産｜${"あ".repeat(10)}ほか`);
        expect(foodTitle("北海道", { dishes: [d("あ".repeat(30))], souvenirs: s })).toBe("北海道の郷土料理とお土産");
        expect(foodTitle("北海道", { dishes: [], souvenirs: s })).toBe("北海道の郷土料理とお土産");
    });

    it("🔴 お土産が0品の県は「お土産」と名乗らない（題・見出し・説明）", () => {
        const d = (name: string) => ({ name }) as FoodItem;
        const none = { dishes: [d("さばずし"), d("ばらずし")], souvenirs: [] };
        expect(foodHeading("京都府", none)).toBe("京都府の郷土料理");
        expect(foodTitle("京都府", none)).toBe("京都府の郷土料理｜さばずし、ばらずしほか");
        expect(foodDescription("京都府", none)).not.toContain("お土産");
    });

    it("実データ: 全県の題が33以内か名前なしの形・説明は120字以内で文の終わり", () => {
        for (const a of foodAreas()) {
            const name = prefectureBySlug(a.area)!.name;
            const t = foodTitle(name, a);
            if (t !== foodHeading(name, a)) expect(titleWidth(t), t).toBeLessThanOrEqual(FOOD_TITLE_MAX);
            const desc = foodDescription(name, a);
            expect([...desc].length, desc).toBeLessThanOrEqual(FOOD_DESCRIPTION_MAX);
            expect(desc).toMatch(/。$/);
            expect(desc.startsWith(`${name}の郷土料理${a.dishes.length}品`)).toBe(true);
        }
    });
});
