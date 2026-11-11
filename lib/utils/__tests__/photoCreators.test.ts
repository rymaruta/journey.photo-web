import { describe, it, expect, vi } from "vitest";

// 既定の除外はビルド時の profiles.json（`isSearchHidden`）。ここでは「hid」だけ隠した人にする
vi.mock("@/lib/utils/searchHidden", () => ({ isSearchHidden: (id: string) => id === "hid" }));

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

    // #526・確かめ役 2026-11-11: noindex の人の名前つきリンクを、索引される撮影スポットの頁に張らない
    it("検索エンジンに表示しないを選んだ人は並べない（既定で profiles.json を見る）", () => {
        const out = photoCreators([
            { userId: "hid", displayName: "隠した人" },
            { userId: "hid", displayName: "隠した人" },
            { userId: "a", displayName: "A" },
        ]);
        expect(out).toEqual([{ id: "a", name: "A" }]);
    });

    it("除外の判定は差し替えられる", () => {
        expect(photoCreators([{ userId: "a", displayName: "A" }, { userId: "b", displayName: "B" }], 8, (id) => id === "a"))
            .toEqual([{ id: "b", name: "B" }]);
    });
});
