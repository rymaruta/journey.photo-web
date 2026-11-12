import { describe, it, expect, beforeEach } from "vitest";
import {
    addSwipeSeen, addSwipeWant, buildSwipeDeck, handOffSwipeWants, parseSwipeDeck, readSwipeSeen, readSwipeWants,
    removeSwipeWant, showsSwipePause, shuffleDeck, SWIPE_SEEN_MAX, SWIPE_WANT_MAX, SWIPE_WANTS_KEY, type SwipeCard,
} from "../spotSwipe";

// 撮影スポットを払う（`/swipe`・2026-11-11）。iOS の `SpotSwipe` と同じ規則・端末の控えは撮影スポットの鍵だけ
const card = (slug: string): SwipeCard => ({ slug, name: `[${slug}]`, region: "", src: `/images/spots/${slug}.jpg`, alt: slug, credit: null });

beforeEach(() => {
    window.localStorage.clear();
});

describe("挟む札（iOS の SpotSwipe.showsPause と同じ）", () => {
    it("「行きたい」が1つ以上で5枚目から・続けたら10枚あと", () => {
        expect(showsSwipePause(4, 1, null)).toBe(false);
        expect(showsSwipePause(5, 1, null)).toBe(true);
        expect(showsSwipePause(5, 0, null)).toBe(false);
        expect(showsSwipePause(14, 2, 5)).toBe(false);
        expect(showsSwipePause(15, 2, 5)).toBe(true);
    });
});

describe("札の山", () => {
    it("形の合わない行と重なりを落とす", () => {
        const deck = parseSwipeDeck([
            { slug: "a", name: "A", src: "/a.jpg", region: "北海道", alt: "", credit: { author: "X", license: "CC BY 4.0", evil: "<x>" } },
            { slug: "a", name: "A2", src: "/a2.jpg" },
            { slug: "", name: "B", src: "/b.jpg" },
            { slug: "c", name: "C" },
            null, "x",
        ]);
        expect(deck.map((c) => c.slug)).toEqual(["a"]);
        expect(deck[0].alt).toBe("A");
        expect(deck[0].credit).toEqual({ author: "X", license: "CC BY 4.0" });
        expect(parseSwipeDeck({})).toEqual([]);
    });

    it("「行きたい」と見た札を除く・全部見たら最初から", () => {
        const cards = ["a", "b", "c"].map(card);
        const fixed = () => 0;
        const r1 = buildSwipeDeck(cards, new Set(["SPOT-a"]), new Set(["SPOT-b"]), fixed);
        expect(r1.deck.map((c) => c.slug)).toEqual(["c"]);
        expect(r1.restarted).toBe(false);
        const r2 = buildSwipeDeck(cards, new Set(["SPOT-a"]), new Set(["SPOT-b", "SPOT-c"]), fixed);
        expect(r2.deck.map((c) => c.slug).sort()).toEqual(["b", "c"]);
        expect(r2.restarted).toBe(true);
    });

    it("混ぜても札は減らない", () => {
        const items = Array.from({ length: 20 }, (_, i) => i);
        expect(shuffleDeck(items).sort((a, b) => a - b)).toEqual(items);
    });
});

describe("端末の控え（観光スポットの鍵だけ・最大40）", () => {
    it("足す・外す・上限で止める（黙って古いものを消さない）", () => {
        for (let i = 0; i < SWIPE_WANT_MAX; i++) expect(addSwipeWant(`s${i}`)).toBe(true);
        expect(addSwipeWant("over")).toBe(false);
        expect(readSwipeWants()).toHaveLength(SWIPE_WANT_MAX);
        expect(readSwipeWants()[0]).toBe("SPOT-s0");
        expect(addSwipeWant("s3"), "もう入っているものは足せた扱い").toBe(true);
        removeSwipeWant("SPOT-s0");
        expect(readSwipeWants()).not.toContain("SPOT-s0");
    });

    it("観光スポットの鍵でない値・壊れた値は読まない", () => {
        window.localStorage.setItem(SWIPE_WANTS_KEY, JSON.stringify(["SPOT-a", "パリ", 3, "SPOT-", "SPOT-a"]));
        expect(readSwipeWants()).toEqual(["SPOT-a"]);
        window.localStorage.setItem(SWIPE_WANTS_KEY, "{not json");
        expect(readSwipeWants()).toEqual([]);
    });

    it("見た札は新しい順に上限まで", () => {
        for (let i = 0; i < SWIPE_SEEN_MAX + 3; i++) addSwipeSeen(`s${i}`);
        const seen = readSwipeSeen();
        expect(seen).toHaveLength(SWIPE_SEEN_MAX);
        expect(seen).not.toContain("SPOT-s0");
    });

    it("保存が投げても止まらない", () => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error("QuotaExceeded"); };
        try {
            expect(() => addSwipeWant("a")).not.toThrow();
            expect(() => addSwipeSeen("a")).not.toThrow();
        } finally {
            Storage.prototype.setItem = orig;
        }
    });
});

describe("ログインのあとに移す", () => {
    it("送れた鍵から消す・失敗したら残りは次の回", async () => {
        addSwipeWant("a");
        addSwipeWant("b");
        addSwipeWant("c");
        const sent: string[] = [];
        const result = await handOffSwipeWants(async (key) => {
            sent.push(key);
            return key !== "SPOT-b";
        });
        expect(sent).toEqual(["SPOT-a", "SPOT-b"]);
        expect(result).toEqual({ moved: 1, left: 2 });
        expect(readSwipeWants()).toEqual(["SPOT-b", "SPOT-c"]);
        const again = await handOffSwipeWants(async () => true);
        expect(again).toEqual({ moved: 2, left: 0 });
        expect(window.localStorage.getItem(SWIPE_WANTS_KEY), "送り終えたら消す").toBeNull();
    });
});
