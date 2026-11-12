import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP_PAGES, HELP_TITLE, HELP_DESCRIPTION, CHECKED_APP_VERSION } from "../helpPages";

/**
 * **使い方の頁の台帳**（2026-11-12・札 journey.photo-ios#517）。
 *
 * - 1頁は3行（絵1枚と3行・資料「説明なしで分かるアプリ」）
 * - 言葉の決まり: 禁止語を使わない、画面の文を「・」「·」で区切らない、公式の場所は「観光スポット」（2026-11-12 owner）
 * - 頁の数字は実装の値と同じ（サーバーの決まりはこのリポジトリの `api-user` から読む）
 */
const ALL_TEXT = (p: (typeof HELP_PAGES)[number]) =>
    [p.title, p.cardTitle, p.summary, p.description, p.scope, p.figureLabel, ...p.lines,
        ...(p.folds ?? []).flatMap((f) => [f.title, ...f.items, ...(f.links ?? []).map((l) => l.label)])];

const BANNED = ["撮りどき", "捨てる", "注目スポット", "撮影地ガイド", "撮影地のガイド", "ガイドを見る", "この場所", "このスポット", "綴じる"];

describe("使い方の台帳", () => {
    it("第1弾の4頁（すれちがい乗車券、メッセージ、トランクと硬貨、ブロックと通報）が先頭に、この順で並ぶ", () => {
        expect(HELP_PAGES.slice(0, 4).map((p) => p.slug)).toEqual(["pass", "messages", "trunk", "safety"]);
    });

    it("slug は重ならず、URL に使える形", () => {
        const slugs = HELP_PAGES.map((p) => p.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of slugs) expect(s).toMatch(/^[a-z][a-z-]*$/);
    });

    it("どの頁も3行で、題は検索で探す言葉（「〜の使い方」「〜の見方」「〜のしかた」）", () => {
        for (const p of HELP_PAGES) {
            expect(p.lines, p.slug).toHaveLength(3);
            for (const l of p.lines) expect(l.length, `${p.slug}: ${l}`).toBeLessThanOrEqual(120);
            expect(p.title, p.slug).toMatch(/(の使い方|の見方|のしかた)$/);
        }
    });

    it("説明文（meta description）は検索結果に収まる長さ", () => {
        for (const d of [HELP_DESCRIPTION, ...HELP_PAGES.map((p) => p.description)]) {
            expect(d.length, d).toBeGreaterThanOrEqual(50);
            expect(d.length, d).toBeLessThanOrEqual(160);
        }
    });

    it("禁止語を使わない", () => {
        const bad = HELP_PAGES.flatMap((p) => ALL_TEXT(p).flatMap((t) => BANNED.filter((w) => t.includes(w)).map((w) => `${p.slug}: 「${w}」 ${t}`)));
        expect(bad).toEqual([]);
        expect([HELP_TITLE, HELP_DESCRIPTION].filter((t) => BANNED.some((w) => t.includes(w)))).toEqual([]);
    });

    it("画面の文を「・」「·」で区切らない（2026-11-12 owner の好み）", () => {
        const bad = [HELP_TITLE, HELP_DESCRIPTION, ...HELP_PAGES.flatMap(ALL_TEXT)].filter((t) => /[・·]/.test(t));
        expect(bad).toEqual([]);
    });

    it("公式の場所は「観光スポット」と呼ぶ（「撮影スポット」と書かない・2026-11-12 owner 承認）", () => {
        const bad = HELP_PAGES.flatMap(ALL_TEXT).filter((t) => t.includes("撮影スポット"));
        expect(bad).toEqual([]);
        expect(HELP_PAGES.find((p) => p.slug === "tourist-spots")!.title).toBe("観光スポットの頁の見方");
    });

    it("作らないと決めた頁（第3弾と、今の本番に無い QR）が混ざっていない", () => {
        const slugs = HELP_PAGES.map((p) => p.slug);
        for (const s of ["trip-plans", "visited-map", "badges", "camper", "qr"]) expect(slugs).not.toContain(s);
    });

    it("読んだ版を頁の下に出す（本番の iPhone のアプリの版）", () => {
        expect(CHECKED_APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
});

describe("頁の数字は実装の値と同じ", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const page = (slug: string) => ALL_TEXT(HELP_PAGES.find((p) => p.slug === slug)!).join("\n");

    it("メッセージ: リクエストの間は文字3通まで、通報で運営に届くのは20通まで（api-user/src/dm.ts）", () => {
        const dm = read("api-user/src/dm.ts");
        const requestMax = Number(/export const DM_REQUEST_MAX = (\d+);/.exec(dm)![1]);
        const reportLast = Number(/export const DM_REPORT_LAST = (\d+);/.exec(dm)![1]);
        expect(page("messages")).toContain(`文字${requestMax}通まで`);
        expect(page("messages")).toContain(`（${reportLast}通まで）`);
    });

    it("トランク: 1日3件まで、99枚まで、24時間以内の取り消し、かけら5つ（api-user/src/trunk.ts の決まり）", () => {
        const trunk = read("api-user/src/trunk.ts");
        expect(trunk).toContain("1日3枚まで");
        expect(trunk).toContain("上限 99 枚");
        expect(trunk).toContain("24時間以内の削除・非公開で取り消し");
        expect(trunk).toContain("かけら5つで交換");
        const t = page("trunk");
        expect(t).toContain("1日3件まで");
        expect(t).toContain("99枚まで");
        expect(t).toContain("24時間以内");
        expect(t).toContain("かけらが5つ");
    });
});
