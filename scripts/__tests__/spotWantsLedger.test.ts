import { describe, it, expect } from "vitest";
import LEDGER from "../../api-user/src/data/lightLedger.json";
import { SPOTS } from "../../lib/data/spots";
import { topicSpots } from "../../lib/data/spotTopics";
import { swipeDeck } from "../../lib/data/swipeDeck";

/**
 * みんなの「行きたい」の口（`api-user/src/spotWants.ts`）が受ける撮影スポットの鍵は、台帳の写し
 * （`api-user/src/data/lightLedger.json`）にあるものだけ。**写しが古いと、公開中の撮影スポットの「行きたい」を黙って断る**
 * （2026-11-11 確かめ役の実測: 写し 1,782 件・公開 3,677 件・払う札 400 のうち 168 が写しに無かった）。
 *
 * 写しが追いついているかをここで落とす（`npm test` は本番の反映でも流れる）。落ちたら
 * `npx tsx scripts/gen-light-ledger.ts` で写しを作り直す
 */
const inLedger = new Set((LEDGER as unknown as { spots: [string, ...unknown[]][] }).spots.map((r) => r[0]));

describe("みんなの「行きたい」が受ける撮影スポットの写し", () => {
    it("公開中の撮影スポットが全部写しにある", () => {
        const missing = topicSpots(SPOTS).map((s) => s.slug).filter((slug) => !inLedger.has(slug));
        expect(missing, "写しが古い。npx tsx scripts/gen-light-ledger.ts で作り直す").toEqual([]);
    });

    it("払う画面の札（swipe.json）が全部写しにある", () => {
        const missing = swipeDeck().map((c) => c.slug).filter((slug) => !inLedger.has(slug));
        expect(missing, "写しが古い。npx tsx scripts/gen-light-ledger.ts で作り直す").toEqual([]);
    });
});
