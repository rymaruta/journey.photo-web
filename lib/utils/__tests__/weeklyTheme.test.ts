import { describe, it, expect } from "vitest";
import {
    THEMES_BY_SEASON, SEASONS, THEME_TAGS, weeklyThemeFor, themeOfWeek, weekIndex, weekRange, readThemeTag,
    hasJoinedTheme, themeParticipants, participantsLine,
} from "../weeklyTheme";
import { TAG_CHOICES } from "../tagChoices";
import { tagKey } from "../collections";

/**
 * 今週のお題（iOS の `WeeklyTheme` と同じ割り当て・札 journey.photo-ios#537 案2）。
 * 🔴 **日付と答えは iOS の `WeeklyThemeTests` と同じ。** 日付は見ている端末の暦（ここでは `new Date(年, 月-1, 日, 時)` の土地の時刻）
 */
const at = (iso: string) => new Date(iso);

describe("今週のお題（iOS の WeeklyTheme と同じ）", () => {
    it("アプリと同じ週に同じお題（週は日本の時刻の月曜から・季節はその週の月曜の月）", () => {
        expect(weeklyThemeFor(at("2026-11-11T03:00:00.000Z")).tag).toBe("紅葉");   // 11/9 の週・秋
        expect(weeklyThemeFor(at("2026-11-16T03:00:00.000Z")).tag).toBe("神社");   // 次の週
        expect(weeklyThemeFor(at("2026-12-03T03:00:00.000Z")).tag).toBe("湖");     // 11/30（月）の週＝秋のまま
        const winter = weeklyThemeFor(at("2026-12-07T03:00:00.000Z"));              // 冬
        expect(winter.tag).toBe("夜");
        expect(winter.title.ja).toBe("冬のあかり");
        expect(weeklyThemeFor(at("2027-04-05T03:00:00.000Z")).tag).toBe("朝");      // 春
        expect(weekIndex(at("2026-11-11T03:00:00.000Z"))).toBe(2966);
    });

    it("同じ週なら同じお題。日本の月曜 0 時で替わる", () => {
        const monday = weeklyThemeFor(at("2026-11-08T15:30:00.000Z"));       // 東京 11/9（月）0:30
        expect(weeklyThemeFor(at("2026-11-15T14:30:00.000Z"))).toEqual(monday); // 東京 11/15（日）23:30
        expect(weeklyThemeFor(at("2026-11-08T14:30:00.000Z"))).not.toEqual(monday); // 東京 11/8（日）23:30
    });

    it("🔴 端末の時刻帯が海外でも、日本の週で同じお題・同じ参加の範囲（札 #537 の確かめ役・今日の一問と同じ考え）", () => {
        const saved = process.env.TZ;
        const now = at("2026-11-09T06:30:00.000Z"); // 東京 11/9（月）15:30・ロサンゼルス 11/8（日）22:30
        try {
            process.env.TZ = "Asia/Tokyo";
            const inTokyo = weeklyThemeFor(now);
            const tokyoRange = weekRange(now);
            for (const zone of ["America/Los_Angeles", "Europe/London", "Pacific/Auckland"]) {
                process.env.TZ = zone;
                expect(weeklyThemeFor(now), zone).toEqual(inTokyo);
                expect(weekRange(now), zone).toEqual(tokyoRange);
            }
            expect(inTokyo.tag).toBe("紅葉");
            expect(tokyoRange.start).toBe(Date.parse("2026-11-08T15:00:00.000Z"));
        } finally {
            if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
        }
    });

    it("3 年分、続く週で同じタグにならない（季節の変わり目も）", () => {
        const start = weekIndex(at("2026-01-05T03:00:00.000Z"));
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
    const now = new Date("2026-11-11T03:00:00.000Z");
    const theme = weeklyThemeFor(now); // 紅葉
    // 日本の時刻で y/m/d h:min:s
    const jst = (y: number, m: number, d: number, h: number, min = 0, s = 0) => new Date(Date.UTC(y, m - 1, d, h - 9, min, s)).toISOString();

    it("参加済みは今週そのタグで上げたものがあるか（先週・別のタグ・投稿日の無いものは数えない）", () => {
        expect(hasJoinedTheme(theme, [{ tags: ["紅葉"], createdAt: jst(2026, 11, 9, 0, 30) }], tagKey, now)).toBe(true);
        expect(hasJoinedTheme(theme, [{ tags: ["#autumn-leaves"], createdAt: jst(2026, 11, 10, 9) }], tagKey, now)).toBe(true);
        expect(hasJoinedTheme(theme, [{ tags: ["紅葉"], createdAt: jst(2026, 11, 8, 23, 30) }], tagKey, now)).toBe(false);
        expect(hasJoinedTheme(theme, [{ tags: ["海"], createdAt: jst(2026, 11, 10, 9) }, { tags: ["紅葉"] }], tagKey, now)).toBe(false);
    });

    it("みんなの参加: 今週そのタグで載せた投稿を新しい順に。同じ投稿の写真は 1 つ", () => {
        const photos = [
            { id: "old", tags: ["紅葉"], createdAt: jst(2026, 11, 8, 23, 30), userId: "u1" },
            { id: "mon", tags: ["紅葉"], createdAt: jst(2026, 11, 9, 0, 30), userId: "u2" },
            { id: "sea", tags: ["海"], createdAt: jst(2026, 11, 10, 9), userId: "u3" },
            { id: "g1", tags: ["紅葉"], createdAt: jst(2026, 11, 10, 10), userId: "u4", groupId: "g" },
            { id: "g2", tags: ["紅葉"], createdAt: jst(2026, 11, 10, 10, 0, 1), userId: "u4", groupId: "g" },
            { id: "wed", tags: ["autumn-leaves"], createdAt: jst(2026, 11, 11, 10), userId: "u1" },
        ];
        expect(themeParticipants(theme, photos, tagKey, now).map((p) => p.id)).toEqual(["wed", "g2", "mon"]);
    });

    it("参加の行の文", () => {
        expect(participantsLine(3, false)).toBe("今週 3件の投稿");
        expect(participantsLine(1, true)).toBe("1 post this week");
    });
});
