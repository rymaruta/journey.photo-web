import { describe, it, expect } from "vitest";
import { inlineSegments, inlineHrefs, stripInlineLinks } from "../inlineLinks";
import { CHAPTERS } from "@/lib/data/learn/chapters";
import { LESSONS, FIELD_GUIDES } from "@/lib/data/learn/cameraBasics";
import { SPOTS } from "@/lib/data/spots";
import { visibleSpots, isPublished } from "@/lib/utils/spotGuide";
import { spotTopicSitemapEntries } from "@/lib/data/spotTopics";
import { lightCalendar } from "@/lib/utils/lightCalendar";

/**
 * **教科書の本文の中の、撮影スポットへのリンク**（2026-11-11・札 rymaruta/journey.photo-ios#527）。
 * 以前は 14 頁から撮影スポットの頁へのリンクが 0 だった。
 */

/** 記事ごとの本文の文字列（リンクを置ける所: 段落・箇条・コツ・手順。第1章は本文と撮影の手引き） */
function articleTexts(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const c of CHAPTERS) {
        m.set(c.slug, c.sections.flatMap((s) => s.blocks).flatMap((b) => {
            if (b.t === "p" || b.t === "callout") return [b.text];
            if (b.t === "list") return b.items;
            if (b.t === "steps") return b.items.map((x) => x.text);
            return [];
        }));
    }
    m.set("camera-basics", [...LESSONS.flatMap((l) => l.body), ...FIELD_GUIDES.flatMap((g) => g.items)]);
    return m;
}

describe("本文のリンクの書き方（inlineSegments）", () => {
    it("[文字](/道) をリンクに分け、ほかは文字のまま", () => {
        expect(inlineSegments("前の文。[袋田の滝](/spots/fukuroda-falls)や[滝](/spots/season/autumn/theme/waterfalls)。"))
            .toEqual(["前の文。", { label: "袋田の滝", href: "/spots/fukuroda-falls" }, "や", { label: "滝", href: "/spots/season/autumn/theme/waterfalls" }, "。"]);
        expect(inlineSegments("リンクの無い文")).toEqual(["リンクの無い文"]);
        expect(stripInlineLinks("[袋田の滝](/spots/fukuroda-falls)の頁")).toBe("袋田の滝の頁");
    });

    it("🔴 サイトの外への道は拾わない（本文に外のリンクを紛れ込ませない）", () => {
        expect(inlineHrefs("[外](https://example.com)と[中](/spots)")).toEqual(["/spots"]);
        expect(inlineSegments("[外](https://example.com)")).toEqual(["[外](https://example.com)"]);
        // `//`（プロトコル相対）と `/\`（ブラウザは `//` と読む）も外。文字のまま残す
        expect(inlineSegments("[a](//evil.com)")).toEqual(["[a](//evil.com)"]);
        expect(inlineSegments("[a](/\\evil.com)")).toEqual(["[a](/\\evil.com)"]);
        expect(inlineHrefs("[a](//evil.com)と[b](/\\evil.com)と[c](/spots)")).toEqual(["/spots"]);
    });
});

describe("教科書から撮影スポットへのリンク", () => {
    const texts = articleTexts();
    const spotSlugs = new Set(visibleSpots(SPOTS).filter(isPublished).map((s) => s.slug));
    const topicPaths = new Set(spotTopicSitemapEntries("").map((e) => e.url));

    it("張った先は全部、在る頁（公開済みのスポット・作られる切り口の頁・一覧）", () => {
        const all = [...texts.values()].flat().flatMap(inlineHrefs);
        expect(all.length).toBeGreaterThan(30);
        for (const href of all) {
            const slug = /^\/spots\/([^/]+)$/.exec(href)?.[1];
            const ok = href === "/spots" || topicPaths.has(href) || (slug !== undefined && spotSlugs.has(slug));
            expect(ok, href).toBe(true);
        }
    });

    it("書き損じが無い（リンクの印を外した文に「](」や「[」が残らない）", () => {
        for (const [slug, list] of texts) for (const t of list) {
            const plain = stripInlineLinks(t);
            expect(plain, slug).not.toMatch(/\]\(|\[[^\]]*\]\(/);
        }
    });

    /**
     * 記事ごとの本数。章の内容に合う所にだけ張る（関係の薄いリンクは張らない）。
     * 3 本に満たない記事と、その理由（2026-11-11 判断）:
     *   - raw-editing（現像）・glossary（用語集）: 場所に結びつく文が無い（画面の操作と言葉の説明）
     *   - practice-30days（30日の練習）: 出かける先の1文だけ。日ごとのお題は表の中
     */
    const FEWER: Record<string, number> = { "raw-editing": 0, glossary: 0, "practice-30days": 1 };
    it("各記事 3〜6 本（上の例外を除く）・同じ記事で同じ先へ2回張らない", () => {
        for (const [slug, list] of texts) {
            const hrefs = list.flatMap(inlineHrefs);
            if (slug in FEWER) expect(hrefs.length, slug).toBe(FEWER[slug]);
            else {
                expect(hrefs.length, slug).toBeGreaterThanOrEqual(3);
                expect(hrefs.length, slug).toBeLessThanOrEqual(6);
            }
            expect(new Set(hrefs).size, slug).toBe(hrefs.length);
        }
    });

    /**
     * 🔴 **本文で言っていることが、張った先の頁に書いてあること**（台帳が変わったら気づけるように）。
     * 「〇〇の頁でも〜の撮り方を案内しています」「〜の名所」と書いた所は、その頁の撮り方・時間帯・紹介文に在る語で確かめる
     */
    // 主張ごとに、かなめの語を2つずつ（1語だけだと、別の意味でその語が出てくる文でも通ってしまう）
    const CLAIMS: Record<string, RegExp[]> = {
        "fukuroda-falls": [/三脚/, /長秒露光/], "oirase-keiryu": [/ND/, /三脚/], "shibuya-scramble": [/1\/4秒/, /人が流れ/],
        "monet-no-ike": [/偏光/, /反射/], makino: [/ぼか/, /花/], tsugaike: [/ぼか/, /望遠/], ryusendo: [/ホワイトバランス/, /照明/],
        "shimonada-station": [/水平線/, /傾き/], byodoin: [/水平線/, /水面/], "arakurayama-sengen-park": [/望遠/, /塔/],
        "farm-tomita": [/望遠/, /花畑/], inasayama: [/夜景/, /展望台/], "mt-hakodate": [/夜景/, /見下ろす/],
        "shikoku-karst": [/星/, /三脚/], jododaira: [/星空/, /星空が濃い/], chichibugahama: [/日の入り|日が沈んだ/, /水面/],
        "takeda-castle-ruins": [/川霧/, /雲海/], "bitchu-matsuyama-castle": [/雲海/, /明け方|朝/], "lake-mashu": [/晴れ/, /湖面/],
        akanko: [/結露/, /寒さ/], "hida-daishonyudo": [/曇/, /温度差/], "ikuno-ginzan": [/曇/, /温度差/],
        kamikatsu: [/手前から奥/, /畦/], "oigawa-sl": [/列車|鐵道/, /SL|蒸気機関車/], "choshi-dentetsu": [/電車|鉄道/, /沿線/],
        "kegon-falls": [/滝/, /落差/],
    };
    it("本文で言ったことは、張った先のスポットの頁の文に在る", () => {
        const linked = new Set([...texts.values()].flat().flatMap(inlineHrefs).flatMap((h) => /^\/spots\/([^/]+)$/.exec(h)?.[1] ?? []).filter((x) => spotSlugs.has(x)));
        for (const slug of linked) {
            const s = SPOTS.find((x) => x.slug === slug)!;
            const said = CLAIMS[slug];
            expect(said, `${slug} の確かめ方を CLAIMS に足す`).toBeDefined();
            const words = [s.summary, s.description, ...(s.compositionTips ?? []), ...(s.timeOfDayGuide ?? []).map((g) => g.text), ...(s.seasonalGuide ?? []).map((g) => g.text)].join(" ");
            expect(said.length, slug).toBeGreaterThanOrEqual(2);
            for (const re of said) expect(words, `${slug} ${re}`).toMatch(re);
        }
        // 「月ごとの日の出・日の入りとゴールデンアワーの表があります（たとえば父母ヶ浜）」の表が本当に出る
        const c = SPOTS.find((x) => x.slug === "chichibugahama")!;
        expect(lightCalendar(c.coords, c.region?.country, c.timeZone)).not.toBeNull();
    });
});
