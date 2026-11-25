import { describe, it, expect, vi, afterEach } from "vitest";
import { buildImageSitemap } from "../sitemap-images.xml/route";
import type { Photo } from "@/lib/data/photos";

/**
 * 画像サイトマップ（`/sitemap-images.xml`）。
 *
 * **「テストが1本も無かった」は誤りだった**（レビューが指摘・確認した）。
 * `app/__tests__/robots.test.ts:90` が前からこのルートを import していて、
 * 制御文字・タブ改行の保持・記号のエスケープを見ている。ここはそこに
 * 無かった契約（**言語**・**切り詰め**・**組み立て**）を足す。
 *
 * ここで固定するのは:
 *   - **載せるのは image:loc だけ**（2026-11-25）。Google が文書から外した
 *     `image:caption`・`image:title` を出さない（以前は題と説明を入れていた）
 *   - 1文字で XML 全体が壊れないこと（`feed.xml` と同じ型）
 */
const photo = (over: Partial<Photo> = {}): Photo => ({
    id: "p1", src: "https://cdn/1.jpg", published: true,
    title: { ja: "白鳥と湖", en: "Swans on the Lake" },
    description: { ja: ["餌を探していた。"], en: ["They were searching for food."] },
    ...over,
} as unknown as Photo);

const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const failed = (doc: Document) => doc.querySelector("parsererror") !== null;

describe("画像サイトマップは image:loc だけ（2026-11-25）", () => {
    it("🔴 写真の題と説明があっても、image:title と image:caption を出さない", () => {
        const xml = buildImageSitemap([photo({ location: "パリ, フランス" } as Partial<Photo>)]);
        expect(xml).toContain("<image:loc>");
        expect(xml).not.toContain("image:title");
        expect(xml).not.toContain("image:caption");
        expect(xml).not.toContain("白鳥と湖");
        expect(xml).not.toContain("餌を探していた");
    });

    it("🔴 観光スポットの作例も image:loc だけ", () => {
        const xml = buildImageSitemap([], [{ loc: "https://journey-photo.com/spots/x", images: [{ src: "https://upload.wikimedia.org/a.jpg" }] }]);
        expect(xml).toContain("<image:loc>https://upload.wikimedia.org/a.jpg</image:loc>");
        expect(xml).not.toMatch(/image:(title|caption|geo_location|license)/);
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe("画像サイトマップの形", () => {
    it("XML として読める", () => {
        expect(failed(parse(buildImageSitemap([photo()])))).toBe(false);
    });

    // サイトマップは制御文字1つで**丸ごと** parse error になる（その1件だけ
    // でなく全件の `<image:loc>` が読めなくなる）。台帳が一度踏んだ型。
    // 2026-11-25 から題と説明は出さないので、残る文字の入り口は画像の URL と頁の id
    it("制御文字が1つ混ざっても壊れない（画像の URL にも頁の id にも）", () => {
        const bad = `壊${String.fromCharCode(11)}す`;
        const doc = parse(buildImageSitemap([
            photo({ id: `p${bad}`, src: `https://cdn/${bad}.jpg` } as Partial<Photo>),
            photo({ id: "p2" }),
        ]));
        expect(failed(doc), "1件の制御文字で XML 全体が読めなくなっている").toBe(false);
        expect(doc.querySelectorAll("url").length).toBe(2);
    });

    // **画像のURLはサイトのドメインに揃える**（`publicImageUrl`）。
    // 同じ配信の別名で2つに割れていた（実測 30件中11件が CloudFront の
    // 既定ドメイン）。このファイルが一番重視している処理なのに、
    // 変異で外しても誰も落ちなかった（レビュー指摘）。
    //
    // **揃える先は環境変数から決まる**（`NEXT_PUBLIC_CLOUDFRONT_URL` を
    // モジュール読み込み時に1回読む）ので、`publicImageUrl.test.ts` と
    // 同じく読み直してから確かめる
    it("画像のURLはサイトのドメインに揃える", async () => {
        vi.resetModules();
        vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", "https://d1s3dwwzgxf5ni.cloudfront.net");
        vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journey-photo.com");
        const build = (await import("../sitemap-images.xml/route")).buildImageSitemap;
        const xml = build([photo({ src: "https://d1s3dwwzgxf5ni.cloudfront.net/uploads/a.jpg" })]);
        expect(xml).toContain("<image:loc>");
        expect(xml, "CloudFront の既定ドメインのまま出ている").not.toContain("cloudfront.net");
        expect(xml).toContain("journey-photo.com/uploads/a.jpg");
    });

    it("写真が0枚でも壊れない", () => {
        const xml = buildImageSitemap([]);
        expect(failed(parse(xml))).toBe(false);
        expect(parse(xml).querySelectorAll("url").length).toBe(0);
    });

    it("写真ごとに1件・リンクは写真ページ", () => {
        const xml = buildImageSitemap([photo({ id: "abc" }), photo({ id: "def" })]);
        expect(parse(xml).querySelectorAll("url").length).toBe(2);
        expect(xml).toContain("/photo/abc");
    });

    // **空行も出さない。**（`filter(Boolean)` を外す変異で空行が増えた・レビューが実証した穴）
    it("空の要素も空行も出さない", () => {
        const xml = buildImageSitemap([photo({ title: undefined, description: undefined } as Partial<Photo>)]);
        expect(xml.split("\n").filter((l) => l.trim() === ""), "空行が出ている").toEqual([]);
    });
});

// **1投稿に複数枚**（owner のモックの「1/10」）。ページ数は減るが
// **画像の数は減らさない**——owner に「ページ数は減っても画像の数は
// 減らない」と言って始めた分なので、ここが約束の実体
describe("2枚目以降（extraImages）も画像サイトマップに載せる", () => {
    const photo = {
        id: "p1", src: "https://cdn.test/uploads/u1/a.jpg",
        title: "白波の夏",
        extraImages: [
            { src: "https://cdn.test/uploads/u1/b.jpg" },
            { src: "https://cdn.test/uploads/u1/c.jpg" },
        ],
    };

    it("🔴 1つの <url> に、表紙と2枚目以降を全部並べる", () => {
        const xml = buildImageSitemap([photo]);
        // `<url>` は1つ（写真ページは1ページ）
        expect(xml.match(/<url>/g), "URL の数が増えている").toHaveLength(1);
        // 画像は3枚
        expect(xml.match(/<image:image>/g), "2枚目以降が載っていない").toHaveLength(3);
        for (const f of ["a.jpg", "b.jpg", "c.jpg"]) expect(xml).toContain(f);
    });

    it("extraImages が無い写真は今までどおり1枚", () => {
        const xml = buildImageSitemap([{ id: "p1", src: "https://cdn.test/uploads/u1/a.jpg" }]);
        expect(xml.match(/<image:image>/g)).toHaveLength(1);
    });

    it("壊れた要素は飛ばす（落ちない・空の <image:loc> を出さない）", () => {
        const xml = buildImageSitemap([{
            ...photo,
            // @ts-expect-error 壊れた値を通す（本番のデータは何でもありうる）
            extraImages: [null, {}, { src: 5 }, { src: "" }, { src: "https://cdn.test/uploads/u1/b.jpg" }],
        }]);
        expect(xml.match(/<image:image>/g)).toHaveLength(2);
        expect(xml).not.toContain("<image:loc></image:loc>");
    });

    it("XML として読める（1枚のときと同じく壊さない）", () => {
        const doc = new DOMParser().parseFromString(buildImageSitemap([photo]), "application/xml");
        expect(doc.querySelector("parsererror"), "XML が壊れている").toBeNull();
    });
});

describe("撮影地ページの画像（2026-10-11）", () => {
    // 撮影地の台帳（約1,400件）ごと読み込むので、初めての読み込みは重い。全部の試験を並べて流した回で既定の 5 秒を
    // 越えて落ちた（2026-11-12 実測: 5986ms で「Test timed out in 5000ms」・単独では通る）。待ちの上限だけを広げる
    it("代表写真と作例を、撮影地ページの <url> に載せる（ライセンスの欄は書かない）", { timeout: 30_000 }, async () => {
        const { spotImageEntries } = await import("../sitemap-images.xml/route");
        const entries = spotImageEntries();
        expect(entries.length).toBeGreaterThan(0);
        const xml = buildImageSitemap([], entries);
        const doc = parse(xml);
        expect(failed(doc)).toBe(false);
        expect(xml).toContain("<loc>https://journey-photo.com/spots/");
        expect(xml).not.toContain("image:license");
        // 代表写真はサイトに置いた縮小版、作例は Commons の URL
        expect(xml).toMatch(/<image:loc>https:\/\/journey-photo\.com\/images\/spots\/[a-z0-9-]+\.jpg<\/image:loc>/);
        expect(xml).toContain("<image:loc>https://upload.wikimedia.org/");
    });

    it("1つの <url> に 1,000 枚まで（Google の画像サイトマップの決まり）", async () => {
        const { MAX_IMAGES_PER_URL } = await import("../sitemap-images.xml/route");
        expect(MAX_IMAGES_PER_URL).toBe(1000);
        const many = Array.from({ length: 1005 }, (_, i) => ({ src: `https://journey-photo.com/i/${i}.jpg` }));
        const xml = buildImageSitemap([], [{ loc: "https://journey-photo.com/spots/x", images: many }]);
        expect(xml.match(/<image:image>/g)?.length).toBe(1000);
    });
});
