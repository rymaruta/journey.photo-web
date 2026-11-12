import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 行きたい場所の地図（iOS `SavedSpotsMapView`）。マイページの「地図で見る」の行き先。
 *
 * 見るのは3つ: **保存したものだけを地図に渡す**（全スポットを渡さない）・
 * 「まだ」「失敗」「地図に出せるものが無い」を混ぜない・未ログインはログインへ。
 */
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));
vi.mock("../../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
const photosState = vi.hoisted(() => ({ photos: [] as Photo[], loaded: true, failed: false }));
vi.mock("../../../../lib/hooks/usePhotos", () => ({ usePhotos: () => photosState }));
const saved = vi.hoisted(() => ({ slugs: [] as string[], pending: false, failed: false, retry: vi.fn() }));
vi.mock("../../../../lib/hooks/useSavedSpots", () => ({ useSavedSpots: () => saved }));

// 地図本体（Leaflet）は jsdom で描けない。渡された値だけ見る
const mapProps = vi.hoisted(() => ({ last: null as null | { spots: { slug: string }[]; photos: { id: string }[] } }));
vi.mock("../../../components/PhotoMap", () => ({
    default: (p: { spots: { slug: string }[]; photos: { id: string }[] }) => { mapProps.last = p; return <div data-testid="photo-map" />; },
    photosWithCoords: (ps: Photo[]) => ps.filter((p) => (p as unknown as { lat?: number }).lat !== undefined).map((p) => ({ ...p, coords: { lat: 1, lng: 1 } })),
}));
vi.mock("../../../map/MapPhotoSheet", () => ({ default: () => null }));
vi.mock("../../../map/MapSpotSheet", () => ({ default: () => null }));

const Client = (await import("../SavedSpotsMapClient")).default;

const pin = (slug: string) => ({ slug, name: slug, region: "", lat: 1, lng: 1, cover: null, stage: "published" });

beforeEach(() => {
    auth.isAuthenticated = true;
    auth.loading = false;
    photosState.photos = [];
    photosState.loaded = true;
    saved.slugs = [];
    saved.pending = false;
    saved.failed = false;
    mapProps.last = null;
});

describe("行きたい場所の地図", () => {
    it("保存した観光スポットのピンだけを地図に渡す", () => {
        saved.slugs = ["SPOT-a"];
        render(<Client spots={[pin("a"), pin("b")] as never} />);
        expect(screen.getByTestId("photo-map")).toBeTruthy();
        expect(mapProps.last?.spots.map((s) => s.slug)).toEqual(["a"]);
        expect(screen.getByRole("heading", { level: 1 }).className).toContain("font-serif");
        expect(screen.getByTestId("saved-map-count").textContent).toContain("観光スポット 1か所");
    });

    it("読み込み中は地図も「ありません」も出さない", () => {
        saved.pending = true;
        render(<Client spots={[pin("a")] as never} />);
        expect(screen.queryByTestId("photo-map")).toBeNull();
        expect(screen.getByRole("status").textContent).toContain("読み込み中");
        expect(screen.queryByText("地図に出せる場所がありません")).toBeNull();
    });

    it("失敗は失敗として出し、再試行を置く（0件と言わない）", () => {
        saved.failed = true;
        render(<Client spots={[pin("a")] as never} />);
        expect(screen.getByText("保存した場所を読み込めませんでした。")).toBeTruthy();
        expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
        expect(screen.queryByText("地図に出せる場所がありません")).toBeNull();
    });

    it("座標のあるものが1つも無ければ、その旨と一覧への戻りを出す", () => {
        saved.slugs = ["SPOT-zzz"];
        render(<Client spots={[pin("a")] as never} />);
        expect(screen.queryByTestId("photo-map")).toBeNull();
        expect(screen.getByText("地図に出せる場所がありません")).toBeTruthy();
        expect(screen.getAllByRole("link", { name: /一覧にもどる/ })[0].getAttribute("href")).toBe("/saved-spots");
    });

    it("未ログインはログインへ（戻り先つき）", () => {
        auth.isAuthenticated = false;
        render(<Client spots={[pin("a")] as never} />);
        const link = screen.getByRole("link", { name: "ログイン" });
        expect(link.getAttribute("href")).toContain("/login");
        expect(link.getAttribute("href")).toContain(encodeURIComponent("/saved-spots"));
    });
});
