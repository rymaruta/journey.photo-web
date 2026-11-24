import { describe, it, expect, vi } from "vitest";

/**
 * **台帳に県庁所在地の市のスポットが無い県は、県内のスポットの重心にする**（頁にその旨を書く）。
 * 台帳を差し替えて確かめる（実台帳は47県すべてが県庁所在地の市で出せるので、この分岐は実データでは通らない）。
 * 近くのスポットが3件に満たない県は、県内のスポットを近い順に足す。
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("@/lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));
// 公開の門（人の確認・出典）はここでは見ない。座標と地域だけの行を「見える」ものとして通す
vi.mock("@/lib/utils/spotGuide", () => ({ visibleSpots: (s: unknown[]) => s }));

const mk = (slug: string, prefecture: string, city: string, lat: number, lng: number, extra: object = {}) => ({
    spotId: `sp_${slug}`, slug, name: slug, region: { country: "日本", prefecture, city }, coords: { lat, lng }, ...extra,
});

ledger.spots = [
    // 北海道: 札幌市中央区（政令市の区。「札幌市」で始まる）が2件 → 県庁所在地の市のスポット
    mk("sapporo-a", "北海道", "札幌市中央区", 43.06, 141.34),
    mk("sapporo-b", "北海道", "札幌市北区", 43.10, 141.36),
    mk("hakodate", "北海道", "函館市", 41.77, 140.73),
    // 青森県: 青森市のスポットが無い → 県内の重心
    mk("hirosaki", "青森県", "弘前市", 40.60, 140.46),
    mk("hachinohe", "青森県", "八戸市", 40.51, 141.49),
    // 海外・座標なし・県が引けない行は母集合に入らない
    mk("paris", "Île-de-France", "パリ", 48.85, 2.35, { region: { country: "フランス", prefecture: "Île-de-France", city: "パリ" } }),
    { ...mk("nocoords", "青森県", "青森市", 0, 0), coords: undefined },
    mk("kind", "北海道", "札幌市中央区", 43.05, 141.35, { category: "公園" }),
];

const { todayPlace, nearbyForPlace, nearbyIndexRows } = await import("@/lib/data/todayPlaces");

describe("座標の出どころ", () => {
    it("県庁所在地の市（政令市は区まで）のスポットの平均", () => {
        const p = todayPlace("hokkaido")!;
        expect(p.basis).toBe("capital-spots");
        expect(p.sampleCount).toBe(3);   // 札幌市中央区×2・札幌市北区（函館は入らない）
        expect(p.coords.lat).toBeCloseTo((43.06 + 43.10 + 43.05) / 3, 3);
        expect(p.coords.lng).toBeCloseTo((141.34 + 141.36 + 141.35) / 3, 3);
    });

    it("該当が無い県は県内のスポットの重心", () => {
        const p = todayPlace("aomori")!;
        expect(p.basis).toBe("prefecture-centroid");
        expect(p.sampleCount).toBe(2);   // 座標の無い「青森市」の行は数えない
        expect(p.coords.lat).toBeCloseTo(40.555, 3);
        expect(p.coords.lng).toBeCloseTo(140.975, 3);
    });

    it("スポットが1件も無い県は場所を作らない（作り話の座標を出さない）", () => {
        expect(todayPlace("okinawa")).toBeNull();
    });
});

describe("近くのスポット", () => {
    it("30km 以内が3件以上なら、それだけを近い順に", () => {
        const near = nearbyForPlace(todayPlace("hokkaido")!);
        expect(near.withinRadius).toBe(3);
        expect(near.filledFromPrefecture).toBe(false);
        expect(near.items.map((i) => i.slug)).not.toContain("hakodate");
        expect(near.items.map((i) => i.km)).toEqual([...near.items.map((i) => i.km)].sort((a, b) => a - b));
    });

    it("3件に満たない県は、県内のスポットを近い順に足す（県外は足さない）", () => {
        const near = nearbyForPlace(todayPlace("aomori")!);
        expect(near.filledFromPrefecture).toBe(true);
        expect(near.withinRadius).toBe(0);
        expect(near.items.map((i) => i.slug).sort()).toEqual(["hachinohe", "hirosaki"]);
    });
});

describe("索引の行", () => {
    it("国内で座標のある行だけ。[slug, 名前, 緯度, 経度, 種類, 県スラッグ]・緯度経度は小数3桁以内", () => {
        const rows = nearbyIndexRows();
        expect(rows.map((r) => r[0])).toEqual(["sapporo-a", "sapporo-b", "hakodate", "hirosaki", "hachinohe", "kind"]);
        const kind = rows.find((r) => r[0] === "kind")!;
        expect(kind).toEqual(["kind", "kind", 43.05, 141.35, "公園", "hokkaido"]);
        const sapporo = rows.find((r) => r[0] === "sapporo-a")!;
        expect(sapporo[4]).toBe("");
    });
});
