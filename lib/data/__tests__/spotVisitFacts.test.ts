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

    it("載せるのは公開済みの観光スポットだけ（2 回目から海外も・2026-11-11）", () => {
        const pub = new Set(publishableSpots(SPOTS).map((s) => s.slug));
        const bad = visitFactSlugs().filter((slug) => !pub.has(slug));
        expect(bad).toEqual([]);
    });

    it("1 回目（国内 100 件）と 2 回目（Search Console の順位 8〜20 の頁 100 件）で 200 件", () => {
        expect(visitFactSlugs().length).toBe(200);
    });

    it("題・文に HTML の実体参照（&#x27; &amp; &quot; &raquo; など）を残さない（#559 の確かめ・2026-11-11）", () => {
        const ENTITY = /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/i;
        const bad: string[] = [];
        const walk = (v: unknown, path: string) => {
            if (typeof v === "string") { if (ENTITY.test(v)) bad.push(`${path}: ${v}`); return; }
            if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
            if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
        };
        walk(FILE, "file");
        expect(bad).toEqual([]);
    });

    it("説明（_about）は今の作りどおり（書いていない道具は行ごと出さない。「記載なし」とは言わない）", () => {
        expect((FILE as unknown as { _about: string })._about).not.toContain("記載なし");
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

describe("年の決まった事実の期限（validUntil）", () => {
    const row = { ...SRC, subject: "紅葉", text: "紅葉まつりは2026年11月14日〜29日", validUntil: "2026-11-29" };

    it("期限の日までは出し、過ぎたら落とす（ビルドの日で判定）", () => {
        expect(cleanVisitFacts(sample({ bestSeasons: [row] }), "2026-11-29")!.bestSeasons).toHaveLength(1);
        const after = cleanVisitFacts(sample({ bestSeasons: [row] }), "2026-11-30")!;
        expect(after.bestSeasons).toBeUndefined();
        expect(after.access).toHaveLength(1);
    });

    it("期限が過ぎて何も残らなければ null", () => {
        expect(cleanVisitFacts({ delegatedBy: "rymaruta", readPages: [SRC], bestSeasons: [row] }, "2027-01-01")).toBeNull();
    });

    it("期限の形が崩れていれば拾う", () => {
        const f = sample({ bestSeasons: [{ ...row, validUntil: "11月29日" }] });
        expect(visitFactProblems({ spots: { x: f } }, TODAY).join("\n")).toContain("validUntil");
    });

    it("年の決まった行には期限が付いている（紅葉まつり・ライトアップ・2026年の拝観時間）", () => {
        const dated = ["naritasan", "tanzan-jinja", "kifune-jinja", "ishiyamadera", "kairakuen", "kiyomizudera"];
        for (const slug of dated) {
            const f = FILE.spots[slug];
            const rows = [...(f.bestSeasons ?? []), ...(f.hours ?? [])].filter((r) => /20\d\d年/.test(r.text));
            expect(rows.length, slug).toBeGreaterThan(0);
            for (const r of rows) expect(r.validUntil, `${slug}: ${r.text}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        // 実際のファイルでも、期限を過ぎた日には出ない
        expect(visitFactsFor("kairakuen", FILE, "2027-01-01")).toBeNull();
    });
});

describe("見頃の段には時期の事実だけ", () => {
    it("「無料」「開園」「料金」のような時間・料金の事実を見頃に置かない", () => {
        const bad = Object.entries(FILE.spots).flatMap(([slug, f]) =>
            (f.bestSeasons ?? []).filter((r) => /無料|開園する|円/.test(r.text)).map((r) => `${slug}: ${r.text}`));
        expect(bad).toEqual([]);
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

describe("頁への配線（SpotGuidePage を実際に呼ぶ）", () => {
    type El = { type?: unknown; props?: Record<string, unknown> & { dangerouslySetInnerHTML?: { __html: string }; children?: unknown } };
    const call = async (slug: string) => {
        const { default: SpotGuidePage } = await import("../../../app/components/SpotGuidePage");
        const el = (await SpotGuidePage({ slug })) as El;
        const kids = (el.props?.children as El[]).filter(Boolean);
        const place = kids.filter((c) => c.type === "script")
            .map((c) => JSON.parse(c.props!.dangerouslySetInnerHTML!.__html))
            .find((d) => d["@type"] === "TouristAttraction");
        const client = kids.find((c) => c.type !== "script")!;
        return { place, visit: client.props!.visit as Record<string, unknown> | null };
    };

    it("事実のあるスポットは、出典つきの事実を画面に渡す。読んだ頁の一覧と委任者は渡さない", async () => {
        const { visit } = await call("kinkakuji");
        expect(visit).not.toBeNull();
        expect(visit!.readPages).toBeUndefined();
        expect(visit!.delegatedBy).toBeUndefined();
        expect((visit!.photoRules as { drone?: { status: string } }).drone?.status).toBe("prohibited");
    }, 30_000);

    it("毎日同じ時刻の事実があれば、観光地の構造化データに開いている時間を足す", async () => {
        const { place } = await call("kinkakuji");
        expect(place.openingHoursSpecification?.[0]).toMatchObject({ opens: "09:00", closes: "17:00" });
    }, 30_000);

    it("事実の無いスポットには何も渡さず、開いている時間も足さない", async () => {
        const slug = publishableSpots(SPOTS).find((s) => s.region?.country === "日本" && !visitFactSlugs().includes(s.slug))!.slug;
        const { place, visit } = await call(slug);
        expect(visit).toBeNull();
        expect(place?.openingHoursSpecification).toBeUndefined();
    }, 30_000);
});
