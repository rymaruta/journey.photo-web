import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../spots";
import { SPOTS } from "../spots";
import { SPOT_IMAGES, spotCoverImage, type SpotImage } from "../spotImages";
import { hasSpotRowThumb, spotThumbSrc } from "../spotThumbs";
import { handPickedNearby, nearbySpotsForPhoto, sameAreaSpots } from "../spotSeo";
import { spotPins } from "../spotLink";
import { visibleSpots, isPublished } from "../../utils/spotGuide";
import { spotRowThumbPath } from "../../utils/spotThumbPath";

/**
 * **撮影スポットの一覧の行の丸い印に写真を出す条件**（2026-11-04）。
 * 判定は詳細頁の代表写真と同じ（`spotCoverImage`）。ここは「その判定をそのまま使っている」ことと、
 * 小さい版のファイルが在り名前が slug と同じときだけ真になることを見張る。
 */
const ledger = rawLedger as unknown as Spot[];
const base = ledger.find((s) => s.slug === "himeji-castle")!;

const IMAGE: SpotImage = {
    wikidata: "Q1", file: "File:X.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg",
    author: "Someone", license: "CC BY-SA 4.0",
    method: "wikidata-P18", fetchedAt: "2026-09-26", reviewedBy: null,
    local: { src: "/images/spots/himeji-castle.jpg", width: 960, height: 640 },
};
const images = (image: Partial<SpotImage> = {}) => ({ [base.slug]: { ...IMAGE, ...image } });
const present = () => true;
const absent = () => false;

describe("hasSpotRowThumb（出してよい条件）", () => {
    it("公開済み・AI 照合で写真も照らした・座標のずれ無し・小さい版が在る → 真", () => {
        expect(hasSpotRowThumb(base, images(), present)).toBe(true);
    });

    it("小さい版のファイルが無ければ偽（404 を配らない）", () => {
        expect(hasSpotRowThumb(base, images(), absent)).toBe(false);
    });

    it("写真の座標がずれている（coordsMismatch）なら偽", () => {
        expect(hasSpotRowThumb(base, images({ coordsMismatch: true }), present)).toBe(false);
    });

    it("AI 照合で写真を照らしていない（imageChecked が真でない）なら偽", () => {
        const spot = { ...base, aiCheck: { ...base.aiCheck!, imageChecked: false } } as Spot;
        expect(hasSpotRowThumb(spot, images(), present)).toBe(false);
    });

    it("下書きは偽", () => {
        const draft = { ...base, status: "review", aiCheck: undefined, verifiedBy: undefined } as Spot;
        expect(hasSpotRowThumb(draft, images(), present)).toBe(false);
    });

    it("CC BY 系で作者の欄が名前でない（Own work など）なら偽", () => {
        expect(hasSpotRowThumb(base, images({ author: "Own work" }), present)).toBe(false);
    });

    it("使えないライセンス（NC）なら偽", () => {
        expect(hasSpotRowThumb(base, images({ license: "CC BY-NC 4.0" }), present)).toBe(false);
    });

    it("サイトに置いた縮小版（local）が無ければ偽（外へのホットリンクをしない）", () => {
        expect(hasSpotRowThumb(base, images({ local: undefined }), present)).toBe(false);
    });

    it("小さい版の名前が slug と同じでなければ偽（クライアントが slug で場所を組むため）", () => {
        expect(hasSpotRowThumb(base, images({ local: { src: "/images/spots/other-name.jpg", width: 960, height: 640 } }), present)).toBe(false);
    });

    it("写真の記録が無ければ偽", () => {
        expect(hasSpotRowThumb(base, {}, present)).toBe(false);
    });
});

describe("一覧の行・ピンに付く印（本物の台帳）", () => {
    const vis = visibleSpots(SPOTS);
    const published = vis.filter(isPublished);

    it("印が付くのは、詳細頁の代表写真があり、小さい版のファイルが public/ に在る行だけ", () => {
        const pins = spotPins();
        for (const p of pins) {
            const spot = vis.find((s) => s.slug === p.slug)!;
            const cover = spotCoverImage(spot, SPOT_IMAGES);
            if (p.thumb) {
                expect(cover, `${p.slug}: 詳細頁に代表写真が無いのに印が付いている`).toBeDefined();
                expect(spotThumbSrc(cover!.src)).toBe(spotRowThumbPath(p.slug));
                expect(fs.existsSync(path.join(process.cwd(), "public", spotRowThumbPath(p.slug))), `${p.slug}: 小さい版が無い`).toBe(true);
            } else {
                expect("thumb" in p, `${p.slug}: 偽のときは鍵ごと無い`).toBe(false);
            }
        }
    });

    it("印が付く行は、詳細頁に出る出典（作者・ライセンス・出典のリンク）を全部持つ", () => {
        const withThumb = spotPins().filter((p) => p.thumb);
        expect(withThumb.length).toBeGreaterThan(1000);
        for (const p of withThumb) {
            const cover = spotCoverImage(vis.find((s) => s.slug === p.slug)!, SPOT_IMAGES)!;
            expect(cover.credit, p.slug).toBeTruthy();
            expect(cover.licenseLabel, p.slug).toBeTruthy();
            expect(cover.sourceUrl, p.slug).toBeTruthy();
        }
    });

    it("同じ県・近く・写真ページの近くの行も、同じ判定で印を付ける", () => {
        const withThumb = published.find((s) => hasSpotRowThumb(s))!;
        const rowsOf = [
            ...sameAreaSpots(withThumb), ...handPickedNearby(withThumb),
            ...nearbySpotsForPhoto({ coords: withThumb.coords }),
        ];
        expect(rowsOf.length).toBeGreaterThan(0);
        for (const r of rowsOf) {
            const spot = vis.find((s) => s.slug === r.slug)!;
            expect(Boolean(r.thumb), r.slug).toBe(hasSpotRowThumb(spot));
            if (!r.thumb) expect("thumb" in r, r.slug).toBe(false);
        }
        // 印の付く行が実際に在る（判定が常に偽で素通りしていない）
        expect(nearbySpotsForPhoto({ coords: withThumb.coords }).some((r) => r.thumb)).toBe(true);
    });
});
