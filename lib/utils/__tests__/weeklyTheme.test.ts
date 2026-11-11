import { describe, it, expect } from "vitest";
import {
    THEMES_BY_SEASON, SEASONS, THEME_TAGS, weeklyThemeFor, themeOfWeek, weekIndex, readThemeTag,
    hasJoinedTheme, themeParticipants, participantsLine,
} from "../weeklyTheme";
import { TAG_CHOICES } from "../tagChoices";
import { tagKey } from "../collections";

/**
 * 今週のお題（iOS の `WeeklyTheme` と同じ割り当て・札 journey.photo-ios#537 案2）。
 * 🔴 **日付と答えは iOS の `WeeklyThemeTests` と同じ。** 日付は見ている端末の暦（ここでは `new Date(年, 月-1, 日, 時)` の土地の時刻）
 */
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe("今週のお題（iOS の WeeklyTheme と同じ）", () => {
    it("アプリと同じ週に同じお題（週は月曜から・季節はその週の月曜の月）", () => {
        expect(weeklyThemeFor(local(2026, 11, 11)).tag).toBe("紅葉");   // 11/9 の週・秋
        expect(weeklyThemeFor(local(2026, 11, 16)).tag).toBe("神社");   // 次の週
        expect(weeklyThemeFor(local(2026, 12, 3)).tag).toBe("湖");      // 11/30（月）の週＝秋のまま
        const winter = weeklyThemeFor(local(2026, 12, 7));              // 冬
        expect(winter.tag).toBe("夜");
        expect(winter.title.ja).toBe("冬のあかり");
        expect(weeklyThemeFor(local(2027, 4, 5)).tag).toBe("朝");       // 春
        expect(weekIndex(local(2026, 11, 11))).toBe(2966);
    });

    it("同じ週なら同じお題。月曜の 0 時（土地）で替わる", () => {
        const monday = weeklyThemeFor(local(2026, 11, 9, 0, 30));
        expect(weeklyThemeFor(local(2026, 11, 15, 23, 30))).toEqual(monday);
        expect(weeklyThemeFor(local(2026, 11, 8, 23, 30))).not.toEqual(monday);
    });

    it("3 年分、続く週で同じタグにならない（季節の変わり目も）", () => {
        const start = weekIndex(local(2026, 1, 5));
        for (let w = start; w < start + 52 * 3; w += 1) {
            expect(themeOfWeek(w).tag, `週 ${w}`).not.toBe(themeOfWeek(w + 1).tag);
        }
    });

    it("一覧は iOS と同じ。タグは決まった選択肢の中・隣り合う季節で同じタグを使わない", () => {
        expect(SEASONS.map((s) => THEMES_BY_SEASON[s].map((t) => t.tag))).toEqual([
            ["桜", "花", "朝", "公園", "川"],
            ["海", "空", "夜", "雨", "山"],
            ["夕焼け", "紅葉", "神社", "森", "湖"],
            ["雪", "冬", "夜", "山"],
        ]);
        for (const t of THEME_TAGS) expect(TAG_CHOICES).toContain(t);
        SEASONS.forEach((s, i) => {
            const next = SEASONS[(i + 1) % SEASONS.length];
            const a = new Set(THEMES_BY_SEASON[s].map((t) => t.tag));
            expect(THEMES_BY_SEASON[next].filter((t) => a.has(t.tag))).toEqual([]);
        });
        for (const t of SEASONS.flatMap((s) => THEMES_BY_SEASON[s])) {
            expect(`${t.title.ja}${t.prompt.ja}`).not.toContain("撮りどき");
        }
    });

    it("投稿画面の `?tag=` はお題のタグだけ通す（先週のお題のリンクも受ける）", () => {
        expect(readThemeTag("紅葉")).toBe("紅葉");
        expect(readThemeTag("雪")).toBe("雪");
        expect(readThemeTag("春")).toBeNull();           // 選択肢にはあるがお題ではない
        expect(readThemeTag("<script>")).toBeNull();
        expect(readThemeTag("")).toBeNull();
        expect(readThemeTag(null)).toBeNull();
    });
});

describe("参加（iOS の WeeklyTheme.hasJoined・participants と同じ）", () => {
    const now = local(2026, 11, 11, 12);
    const theme = weeklyThemeFor(now); // 紅葉
    const at = (y: number, m: number, d: number, h: number, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).toISOString();

    it("参加済みは今週そのタグで上げたものがあるか（先週・別のタグ・投稿日の無いものは数えない）", () => {
        expect(hasJoinedTheme(theme, [{ tags: ["紅葉"], createdAt: at(2026, 11, 9, 0, 30) }], tagKey, now)).toBe(true);
        expect(hasJoinedTheme(theme, [{ tags: ["#autumn-leaves"], createdAt: at(2026, 11, 10, 9) }], tagKey, now)).toBe(true);
        expect(hasJoinedTheme(theme, [{ tags: ["紅葉"], createdAt: at(2026, 11, 8, 23, 30) }], tagKey, now)).toBe(false);
        expect(hasJoinedTheme(theme, [{ tags: ["海"], createdAt: at(2026, 11, 10, 9) }, { tags: ["紅葉"] }], tagKey, now)).toBe(false);
    });

    it("みんなの参加: 今週そのタグで載せた投稿を新しい順に。同じ投稿の写真は 1 つ", () => {
        const photos = [
            { id: "old", tags: ["紅葉"], createdAt: at(2026, 11, 8, 23, 30), userId: "u1" },
            { id: "mon", tags: ["紅葉"], createdAt: at(2026, 11, 9, 0, 30), userId: "u2" },
            { id: "sea", tags: ["海"], createdAt: at(2026, 11, 10, 9), userId: "u3" },
            { id: "g1", tags: ["紅葉"], createdAt: at(2026, 11, 10, 10), userId: "u4", groupId: "g" },
            { id: "g2", tags: ["紅葉"], createdAt: at(2026, 11, 10, 10, 0, 1), userId: "u4", groupId: "g" },
            { id: "wed", tags: ["autumn-leaves"], createdAt: at(2026, 11, 11, 10), userId: "u1" },
        ];
        expect(themeParticipants(theme, photos, tagKey, now).map((p) => p.id)).toEqual(["wed", "g2", "mon"]);
    });

    it("参加の行の文", () => {
        expect(participantsLine(3, false)).toBe("今週 3件の投稿");
        expect(participantsLine(1, true)).toBe("1 post this week");
    });
});
