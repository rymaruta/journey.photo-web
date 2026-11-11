import { describe, it, expect } from "vitest";
import { profileTitle, profileWho, safeUsername } from "../profileTitle";

// 2026-11-11 journey.photo-ios#525: プロフィールの題とユーザー名の扱い
describe("プロフィールの題", () => {
    it("ユーザー名があれば 表示名（@ユーザー名）の写真 | Journey Photo", () => {
        expect(profileTitle("丸田 竜平", "ryuhei")).toBe("丸田 竜平（@ryuhei）の写真 | Journey Photo");
    });
    it("ユーザー名が無ければ 表示名の写真 | Journey Photo", () => {
        expect(profileTitle("テスト", undefined)).toBe("テストの写真 | Journey Photo");
        expect(profileWho("テスト", undefined)).toBe("テスト");
    });
});

describe("ユーザー名の検め（サーバーの USERNAME_RE と同じ）", () => {
    it("英小文字・数字・_ の3〜20文字だけ通す", () => {
        expect(safeUsername("ryuhei")).toBe("ryuhei");
        expect(safeUsername("@Ryuhei_01 ")).toBe("ryuhei_01");
        expect(safeUsername("ab")).toBeUndefined();
        expect(safeUsername("a".repeat(21))).toBeUndefined();
        expect(safeUsername("a b")).toBeUndefined();
        expect(safeUsername("<script>")).toBeUndefined();
        expect(safeUsername(undefined)).toBeUndefined();
    });
});
