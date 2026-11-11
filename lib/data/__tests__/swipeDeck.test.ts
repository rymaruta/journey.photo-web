import { describe, it, expect } from "vitest";
import { swipeDeck, SWIPE_DECK_SIZE } from "../swipeDeck";
import { SPOTS } from "../spots";
import { topicSpots, topicCardCover } from "../spotTopics";

// 撮影スポットを払う画面の札の山（`/app/data/swipe.json`・2026-11-11）
describe("swipeDeck", () => {
    const deck = swipeDeck();

    it("数百件・公開済みで写真のあるものだけ・重ならない", () => {
        expect(deck.length).toBe(Math.min(SWIPE_DECK_SIZE, topicSpots(SPOTS).filter((s) => topicCardCover(s)).length));
        expect(deck.length).toBeGreaterThan(100);
        const published = new Set(topicSpots(SPOTS).map((s) => s.slug));
        for (const c of deck) {
            expect(published.has(c.slug), c.slug).toBe(true);
            expect(c.src, c.slug).toBeTruthy();
        }
        expect(new Set(deck.map((c) => c.slug)).size).toBe(deck.length);
    });

    it("写真の出典は撮影スポットの頁と同じ決まり（topicCardCover の出典そのまま）", () => {
        const bySlug = new Map(SPOTS.map((s) => [s.slug, s]));
        for (const c of deck.slice(0, 50)) {
            expect(c.credit, c.slug).toEqual(topicCardCover(bySlug.get(c.slug)!)!.credit);
        }
        // CC BY・CC BY-SA の写真は作者とライセンスを持つ
        expect(deck.some((c) => c.credit?.license?.startsWith("CC BY"))).toBe(true);
    });

    it("小さい（静的な置き場で費用ほぼ0・画面が1回だけ読む）", () => {
        expect(JSON.stringify(deck).length).toBeLessThan(250_000);
    });

    it("並びはビルドの日で変わらない", () => {
        expect(swipeDeck().map((c) => c.slug)).toEqual(deck.map((c) => c.slug));
    });
});
