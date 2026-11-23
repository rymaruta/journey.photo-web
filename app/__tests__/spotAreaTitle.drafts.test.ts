import { describe, it, expect, vi } from "vitest";
import type { Spot } from "../../lib/data/spots";

/**
 * 🔴 **下書きを建てる設定（`BUILD_DRAFT_SPOTS = true`）に戻しても、県の頁の題と説明に下書きの名所を載せない。**
 * 題の「N選」は公開済みの件数（`publishedCount`）なので、添える名前も同じ線で取る（2026-11-23・#701 のレビュー）。
 * いまの設定では下書きが手前（`visibleSpots`）で落ちるので、ここで設定を切り替えて見る
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));
vi.mock("../../lib/utils/spotGuide", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../lib/utils/spotGuide")>();
    return {
        ...real,
        visibleSpots: (spots: Parameters<typeof real.visibleSpots>[0]) => real.visibleSpots(spots, { includeDrafts: true }),
    };
});

function spot(slug: string, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${slug.padEnd(12, "0").slice(0, 12)}`,
        slug,
        name: slug,
        summary: "あ".repeat(40),
        region: { country: "日本", prefecture: "香川県" },
        coords: { lat: 34, lng: 134 },
        highlights: ["見どころ"],
        officialWebsiteUrl: "https://example.example/",
        status: "published",
        verifiedBy: "運営",
        verifiedAt: "2026-09-25",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        ...over,
    };
}

describe("県の頁の題（下書きを建てる設定）", () => {
    it("下書きの名所を題と説明に載せない（台帳の先頭が下書きでも）", async () => {
        ledger.spots = [
            spot("draftplace", { status: "review", verifiedBy: undefined, verifiedAt: undefined, draftedAt: "2026-09-24" }),
            spot("a"), spot("b"),
        ];
        const { spotAreas, visibleSpotsInArea } = await import("../../lib/data/spotLink");
        const area = spotAreas().find((x) => x.name === "香川県")!;
        // 前提: この設定では下書きが県の行に見えている（いなければ試験が何も見ていない）
        expect(visibleSpotsInArea(area.slug).map((s) => s.slug)).toContain("draftplace");
        const { generateMetadata } = await import("../spots/area/[area]/page");
        const m = await generateMetadata({ params: Promise.resolve({ area: area.slug }) });
        expect(m.title).toEqual({ absolute: "香川県の観光スポット2選｜a、b" });
        expect(String(m.description)).not.toContain("draftplace");
        expect(String(m.description).startsWith("香川県の観光スポット2か所。a、b。ほかに下書き1件。")).toBe(true);
    }, 30_000); // 頁のモジュールを読み込むので、全体で並べて流すと5秒を超える（単独では約1秒）
});
