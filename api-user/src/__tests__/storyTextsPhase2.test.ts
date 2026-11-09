import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    sanitizeStoryTexts, isStoryTextItem, hasStoryTextItem, storyTextsCaption, isSafeSpotSlug,
    STORY_TEXTS_MAX, STORY_MENTIONS_MAX, STORY_QUESTION_PROMPT_MAX, STORY_SPOT_LABEL_MAX,
    type StoryText,
} from "../storyText";

/**
 * 第2弾の texts の種類（mention / question / spotLink）の**入力の検査**（札 #505）。
 * 純粋な関数の話。関係（フォロー・ブロック）と通知は `storyAudience.test.ts` の
 * メンションの節で見る。
 */

const U1 = "aaaaaaaa-0000-4000-8000-000000000001";
const U2 = "bbbbbbbb-0000-4000-8000-000000000002";
const U3 = "cccccccc-0000-4000-8000-000000000003";
const U4 = "dddddddd-0000-4000-8000-000000000004";
const pos = { x: 0.5, y: 0.5, size: 0.05 };
const kinds = (r: StoryText[] | undefined) => (r ?? []).map((t) => t.kind ?? "text");

describe("mention", () => {
    it("userId の形だけ見て通す。名前の申告は捨てる（サーバーが引く）", () => {
        const r = sanitizeStoryTexts([{ kind: "mention", userId: U1, name: "Journey 運営", ...pos }]);
        expect(r).toEqual([{ kind: "mention", userId: U1, ...pos }]);
        expect(r![0]).not.toHaveProperty("name");
    });

    it("userId の形が違うものは落とす（空・短い・記号・型違い）", () => {
        for (const userId of ["", "abc", "a/b/c/d/e/f/g/h", "x".repeat(129), 123, null, undefined, { a: 1 }]) {
            expect(sanitizeStoryTexts([{ kind: "mention", userId, ...pos }]), String(userId)).toBeUndefined();
        }
    });

    it(`同じ人は1回、${STORY_MENTIONS_MAX}人まで`, () => {
        const r = sanitizeStoryTexts([U1, U1, U2, U3, U4].map((userId) => ({ kind: "mention", userId, ...pos })));
        expect(r!.map((t) => (t as { userId: string }).userId)).toEqual([U1, U2, U3]);
    });

    it("メンションは文字ではない（caption に混ざらない・ひとことの置き場所を奪わない）", () => {
        const r = sanitizeStoryTexts([{ kind: "mention", userId: U1, ...pos }])!;
        expect(isStoryTextItem(r[0])).toBe(false);
        expect(hasStoryTextItem(r)).toBe(false);
        expect(storyTextsCaption(r)).toBe("");
    });
});

describe("question", () => {
    it("問いを持つ。空は落とす・長さで切る・1つだけ", () => {
        expect(sanitizeStoryTexts([{ kind: "question", prompt: "  おすすめは？ ", ...pos }])).toEqual([{ kind: "question", prompt: "おすすめは？", ...pos }]);
        expect(sanitizeStoryTexts([{ kind: "question", prompt: "   ", ...pos }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ kind: "question", prompt: 5, ...pos }])).toBeUndefined();
        const long = sanitizeStoryTexts([{ kind: "question", prompt: "あ".repeat(500), ...pos }])!;
        expect((long[0] as { prompt: string }).prompt).toHaveLength(STORY_QUESTION_PROMPT_MAX);
        const two = sanitizeStoryTexts([{ kind: "question", prompt: "一つ目", ...pos }, { kind: "question", prompt: "二つ目", ...pos }])!;
        expect(two).toHaveLength(1);
        expect((two[0] as { prompt: string }).prompt).toBe("一つ目");
    });

    it("質問の中に答えの置き場を持たない（texts に answers を入れさせない）", () => {
        const r = sanitizeStoryTexts([{ kind: "question", prompt: "q", answers: [{ text: "x" }], ...pos }])!;
        expect(r[0]).not.toHaveProperty("answers");
    });
});

describe("spotLink: 内部リンクのみ", () => {
    const link = (slug: unknown, label: unknown = "富士山") => sanitizeStoryTexts([{ kind: "spotLink", slug, label, ...pos }]);

    it("スラッグ（日本語も）と札で通る。URL は持たない", () => {
        for (const slug of ["mt-fuji", "富士山", "kyoto-fushimi-inari", "a.b"]) {
            expect(link(slug), slug).toEqual([{ kind: "spotLink", slug, label: "富士山", ...pos }]);
        }
    });

    it("外部 URL・パス・危ない形のスラッグは落とす", () => {
        for (const slug of [
            "https://evil.example/x", "http://evil.example", "//evil.example", "javascript:alert(1)",
            "evil.example/x", "a/b", "..", ".", "", "a b", "a?x=1", "a#b", "a%2Fb", "a@b", "a\\b",
            "<script>", "a'b", "(x)", 123, null, undefined, { a: 1 },
        ]) {
            expect(link(slug), String(slug)).toBeUndefined();
        }
    });

    it("スラッグは 200バイトまで（`savedSpots.ts` と同じ単位）", () => {
        expect(isSafeSpotSlug("a".repeat(200))).toBe(true);
        expect(isSafeSpotSlug("a".repeat(201))).toBe(false);
        expect(isSafeSpotSlug("あ".repeat(66))).toBe(true);   // 198 バイト
        expect(isSafeSpotSlug("あ".repeat(67))).toBe(false);  // 201 バイト
    });

    it("札に URL を入れた偽装は落とす。空の札も落とす。長さで切る", () => {
        for (const label of ["https://evil.example", "http://x.y 見て", "www.evil.example", "evil.com/abc", "javascript:alert(1)", "", "   ", 5, null]) {
            expect(link("mt-fuji", label), String(label)).toBeUndefined();
        }
        const long = link("mt-fuji", "あ".repeat(100))!;
        expect((long[0] as { label: string }).label).toHaveLength(STORY_SPOT_LABEL_MAX);
    });

    it("1つだけ", () => {
        const r = sanitizeStoryTexts([
            { kind: "spotLink", slug: "a", label: "A", ...pos }, { kind: "spotLink", slug: "b", label: "B", ...pos },
        ])!;
        expect(r).toHaveLength(1);
    });
});

describe("全体", () => {
    it(`全体の上限は ${STORY_TEXTS_MAX} のまま・種類を混ぜても守る`, () => {
        const many = [
            { text: "a", ...pos }, { text: "b", ...pos },
            { kind: "mention", userId: U1, ...pos }, { kind: "question", prompt: "q", ...pos }, { kind: "spotLink", slug: "s", label: "S", ...pos },
            { kind: "mention", userId: U2, ...pos }, { text: "c", ...pos },
        ];
        expect(sanitizeStoryTexts(many)).toHaveLength(STORY_TEXTS_MAX);
    });

    it("互換: 知らない種類は落とす（文字に化けさせない）。これまでの種類は変わらない", () => {
        expect(kinds(sanitizeStoryTexts([{ kind: "poll2", x: 1, y: 1, size: 0.1 }, { kind: "stamp", stamp: "heart", ...pos }, { text: "朝", ...pos }]))).toEqual(["stamp", "text"]);
        // 文字・スタンプ・投票の出力は第2弾の前と同じ形（既存のストーリーの保存内容が変わらない）
        expect(sanitizeStoryTexts([{ text: "朝", ...pos, font: "mincho", color: "red", bg: "soft" }]))
            .toEqual([{ text: "朝", ...pos, font: "mincho", color: "red", bg: "soft" }]);
    });

    it("クライアント側の複製（lib/utils/storyText.ts）も同じ種類を持つ", () => {
        const root = join(__dirname, "..", "..", "..");
        const client = readFileSync(join(root, "lib/utils/storyText.ts"), "utf8");
        for (const k of ['"mention"', '"question"', '"spotLink"']) expect(client).toContain(k);
    });
});
