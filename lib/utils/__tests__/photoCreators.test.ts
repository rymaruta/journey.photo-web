import { describe, it, expect } from "vitest";
import { photoCreators } from "../photoCreators";

// 2026-11-11 journey.photo-ios#525: 撮影スポットの頁から投稿者のプロフィールへ結ぶ
describe("写真を載せた人", () => {
    it("載せた枚数の多い順、同数なら先に出た順、1人1回", () => {
        const out = photoCreators([
            { userId: "a", displayName: "A" },
            { userId: "b", displayName: "B" },
            { userId: "b", displayName: "B" },
            { userId: "c", displayName: "C" },
        ]);
        expect(out).toEqual([{ id: "b", name: "B" }, { id: "a", name: "A" }, { id: "c", name: "C" }]);
    });

    it("表示名や userId の無い写真は数えない", () => {
        expect(photoCreators([{ userId: "a" }, { displayName: "X" }, { userId: "b", displayName: "  " }])).toEqual([]);
    });

    it("上限で切る", () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ userId: `u${i}`, displayName: `N${i}` }));
        expect(photoCreators(many)).toHaveLength(8);
        expect(photoCreators(many, 3)).toHaveLength(3);
    });
});
