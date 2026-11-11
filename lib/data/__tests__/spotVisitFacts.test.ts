import { describe, it, expect } from "vitest";
import raw from "@/content/spot-visit-facts.json";
import { SPOTS } from "@/lib/data/spots";
import { publishableSpots } from "@/lib/utils/spotGuide";
import {
    cleanVisitFacts, visitFactProblems, visitFactsFor, visitFactsStructuredData, visitFactSlugs,
    type FactsFile, type SpotVisitFacts,
} from "@/lib/data/spotVisitFacts";

/**
 * 撮影スポットの「行く前に知りたい事実」（札 rymaruta/journey.photo-ios#527 の案 2・2026-11-11）。
 * 🔴 **出典（https の URL・題・読んだ日）の無い事実は、ファイルに在るだけで落ちる。**
 */
const FILE = raw as FactsFile;
const TODAY = new Date().toISOString().slice(0, 10);
const SRC = { url: "https://example.lg.jp/kanko/access.html", title: "アクセス｜例の寺", readAt: "2026-11-11" };

const sample = (over: Partial<SpotVisitFacts> = {}): SpotVisitFacts => ({
    delegatedBy: "rymaruta",
    readPages: [SRC],
    access: [{ ...SRC, mode: "train", text: "例の駅から歩いて5分" }],
    ...over,
});

describe("事実のファイル（content/spot-visit-facts.json）", () => {
    it("問題が1つも無い（出典の無い行・公式でない頁・読んだ頁に無い URL・未来の日付）", () => {
        expect(visitFactProblems(FILE, TODAY)).toEqual([]);
    });

    it("載せるのは公開済みの国内の撮影スポットだけ", () => {
        const pub = new Map(publishableSpots(SPOTS).map((s) => [s.slug, s]));
        const bad = visitFactSlugs().filter((slug) => pub.get(slug)?.region?.country !== "日本");
        expect(bad).toEqual([]);
    });

    it("1 回目は 100 件", () => {
        expect(visitFactSlugs().length).toBe(100);
    });

    it("画面の文に「撮りどき」を使わない（CLAUDE.md の言葉の好み）", () => {
        expect(JSON.stringify(FILE.spots)).not.toContain("撮りどき");
    });
});

describe("出典の無い事実を拒む（visitFactProblems）", () => {
    const file = (f: SpotVisitFacts): FactsFile => ({ spots: { x: f } });

    it("URL の無い行を拾う", () => {
        const f = sample({ access: [{ ...SRC, url: "", mode: "train", text: "駅から5分" }] });
        expect(visitFactProblems(file(f), TODAY).join("\n")).toContain("出典");
    });

    it("読んだ日の無い行を拾う", () => {
        const f = sample({ fees: [{ url: SRC.url, title: SRC.title, readAt: "", text: "大人500円" }] });
        expect(visitFactProblems(file(f), TODAY).join("\n")).toContain("出典");
    });

    it("https でない URL を拾う", () => {
        const f = sample({ hours: [{ ...SRC, url: "http://example.lg.jp/", text: "9時から" }] });
        expect(visitFactProblems(file(f), TODAY).join("\n")).toContain("出典");
    });

    it("読んだ頁の一覧に無い URL を拾う", () => {
        const f = sample({ hours: [{ ...SRC, url: "https://example.lg.jp/other.html", text: "9時から" }] });
        expect(visitFactProblems(file(f), TODAY).join("\n")).toContain("readPages に無い頁");
    });

    it("公式でない頁（まとめ・百科事典）からの事実を拾う", () => {
        const wiki = { ...SRC, url: "https://ja.wikipedia.org/wiki/x" };
        const f = sample({ readPages: [SRC, wiki], fees: [{ ...wiki, text: "大人500円" }] });
        expect(visitFactProblems(file(f), TODAY).join("\n")).toContain("公式でない頁");
    });

    it("未来の日付と、AI の名前の委任者を拾う", () => {
        const f = sample({ delegatedBy: "claude", fees: [{ ...SRC, readAt: "2999-01-01", text: "大人500円" }] });
        const p = visitFactProblems(file(f), TODAY).join("\n");
        expect(p).toContain("未来");
        expect(p).toContain("delegatedBy");
    });

    it("可否の無い撮影の決まりを拾う", () => {
        const f = sample({ photoRules: { drone: { ...SRC, text: "飛ばせません" } as never } });
        expect(visitFactProblems(file(f), TODAY).join("\n")).toContain("可否が無い");
    });

    it("出典の揃った行だけなら問題なし", () => {
        expect(visitFactProblems(file(sample()), TODAY)).toEqual([]);
    });
});

describe("読み込み（cleanVisitFacts・visitFactsFor）", () => {
    it("出典の欠けた行は落とす。何も残らなければ null（＝頁に段を出さない）", () => {
        const f = sample({ access: [{ ...SRC, readAt: "", mode: "train", text: "駅から5分" }] });
        expect(cleanVisitFacts(f)).toBeNull();
    });

    it("出典の揃った行は残し、欠けた行だけ落とす", () => {
        const f = sample({
            fees: [{ ...SRC, text: "大人500円" }, { ...SRC, url: "", text: "子ども200円" }],
        });
        const c = cleanVisitFacts(f)!;
        expect(c.fees!.map((x) => x.text)).toEqual(["大人500円"]);
        expect(c.access).toHaveLength(1);
    });

    it("可否の無い道具の行は落とす（記載なしとして扱う）", () => {
        const f = sample({ photoRules: { tripod: { ...SRC, text: "不明" } as never } });
        expect(cleanVisitFacts(f)!.photoRules).toBeUndefined();
    });

    it("ファイルに無いスポットは null", () => {
        expect(visitFactsFor("no-such-spot")).toBeNull();
    });
});

describe("構造化データ（openingHoursSpecification）", () => {
    it("毎日同じ時刻の行が1つだけのときに出す", () => {
        const f = sample({ hours: [{ ...SRC, text: "8時30分から17時", opens: "08:30", closes: "17:00" }] });
        expect(visitFactsStructuredData(f)).toEqual({
            openingHoursSpecification: [{
                "@type": "OpeningHoursSpecification",
                dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `https://schema.org/${d}`),
                opens: "08:30",
                closes: "17:00",
            }],
        });
    });

    it("季節で変わる（行が2つ以上・時刻の無い行）ときは出さない", () => {
        expect(visitFactsStructuredData(sample({ hours: [
            { ...SRC, text: "3〜10月は7時から18時", opens: "07:00", closes: "18:00" },
            { ...SRC, text: "11〜2月は8時から17時", opens: "08:00", closes: "17:00" },
        ] }))).toEqual({});
        expect(visitFactsStructuredData(sample({ hours: [{ ...SRC, text: "季節で変わる" }] }))).toEqual({});
        expect(visitFactsStructuredData(null)).toEqual({});
    });
});
