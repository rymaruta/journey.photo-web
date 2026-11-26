import { describe, it, expect } from "vitest";
import TERMS from "../data/blockedTerms.json";
import {
    containsBlockedText, anyBlockedText, normalize, rejectBlockedText, BLOCKED_TERM_COUNTS,
    CONTENT_REJECTED_CODE,
} from "../contentFilter";

/**
 * 投稿の前の言葉の判定（App Store の審査 1.2・`contentFilter.ts`）。
 *
 * 縛ること:
 *  1. 一覧の語は全部当たる（一覧に足した語が、正規化のせいで当たらなくなっていないか）
 *  2. 全角・半角・大文字・カタカナとひらがな・間の空白や記号・見えない字の違いでは逃げられない
 *  3. **ふつうの文（地名・食べ物・日常の言い回し）では当たらない**
 *  4. 当たったら 400 `content_rejected`
 */

describe("normalize", () => {
    it("全角英数を半角に、大文字を小文字に、カタカナをひらがなにそろえる", () => {
        expect(normalize("ＦＵＣＫ")).toBe("fuck");
        expect(normalize("キチガイ")).toBe("きちがい");
        expect(normalize("ｷﾁｶﾞｲ")).toBe("きちがい");
    });
    it("見えない字を落とす", () => {
        expect(normalize("死​ね")).toBe("死ね");
    });
});

describe("一覧の語は全部当たる", () => {
    it.each(TERMS.ja as string[])("ja: %s", (w) => {
        expect(containsBlockedText(w)).toBe(true);
        expect(containsBlockedText(`きれいな写真だけど${w}って思った`)).toBe(true);
    });
    it.each(TERMS.en as string[])("en: %s", (w) => {
        expect(containsBlockedText(w)).toBe(true);
        expect(containsBlockedText(`Nice photo but ${w}.`)).toBe(true);
    });
    it("語数", () => {
        expect(BLOCKED_TERM_COUNTS.ja).toBeGreaterThanOrEqual(50);
        expect(BLOCKED_TERM_COUNTS.en).toBeGreaterThanOrEqual(50);
    });
});

describe("書き方を変えても当たる", () => {
    it.each([
        "死ね", "死 ね", "死・ね", "死　ね", "死​ね",
        "ｷﾁｶﾞｲ", "きちがい", "キチガイ",
        "ＦＵＣＫ ＹＯＵ", "Fuck", "F*U*C*K? no: fuck!!", "fuckkkk", "f u c k は当たらないが fucking は当たる",
        "a$$hole", "b1tch", "sh1t head nigg4",
        "go kill yourself", "I'll kill you", "KYS",
        "ぶっ殺すぞ", "ころすぞ", "パパ活しませんか",
    ])("%s", (s) => {
        expect(containsBlockedText(s)).toBe(true);
    });
});

describe("ふつうの文では当たらない（誤検出）", () => {
    it.each([
        // 地名
        "京都の清水寺", "渋谷のスクランブル交差点", "北海道の死海みたいな湖", "那須の殺生石", "大阪の新世界",
        "Scunthorpe", "Essex and Middlesex", "Penistone station", "Cumbria", "Nigeria", "the Niger River", "Bangkok",
        "Sussex Downs", "Dickens' London", "Hancock Park", "Matsushima bay",
        // 食べ物
        "ホモ牛乳", "お釜で炊いたご飯", "釜めし", "おかまめし", "シナモンロール", "苦〜い抹茶", "にがーいコーヒー",
        "cocktail bar", "shitake mushrooms", "spicy ramen", "a raccoon in the park", "grape juice",
        // 日常の言い回し
        "わたしね、この景色が好き", "おかしな人だね", "まちがいじゃないよ", "たろうくんに会った", "田中氏ね、この写真は",
        "パチンコ屋の前で", "ぱちんこ", "グレイプバインのライブ", "ディスプレイプロ", "プレイプレイス", "行き違いになった",
        "ゆきちがいで会えなかった", "ちょんまげ", "チョンマゲ", "土人形の工房", "池沼のほとりで", "ヒューマンコメディ",
        "ロマンコースの夜景", "必殺技", "不死身の桜", "消しゴム", "死ぬほど美味しい", "死んだように眠った",
        "classic car", "assistant", "pass the class", "Japan travel", "Japanese garden", "cockpit view", "therapist",
        "food porn", "rape blossom fields", "kill time in the cafe", "this view will kill you",
        "4k 60fps", "f/2.8 1/250s ISO100", "",
    ])("%s", (s) => {
        expect(containsBlockedText(s)).toBe(false);
    });
});

describe("anyBlockedText は入れ子の値を見る", () => {
    it("配列・言語ごとのオブジェクト・文字列でない値", () => {
        expect(anyBlockedText(["京都", "紅葉"], { ja: "夕日", en: "sunset" }, 3, null, undefined)).toBe(false);
        expect(anyBlockedText(["京都", "死ね"])).toBe(true);
        expect(anyBlockedText({ ja: "夕日", en: "fuck" })).toBe(true);
        expect(anyBlockedText([{ text: "ok" }, { question: "どっち？", options: ["a", "kys"] }])).toBe(true);
    });
});

describe("rejectBlockedText", () => {
    it("当たったら 400 content_rejected、当たらなければ null", () => {
        const r = rejectBlockedText("死ね");
        expect(r?.statusCode).toBe(400);
        expect(JSON.parse(r!.body)).toMatchObject({ code: CONTENT_REJECTED_CODE });
        expect(typeof JSON.parse(r!.body).error).toBe("string");
        expect(rejectBlockedText("きれいな夕日")).toBeNull();
    });
});
