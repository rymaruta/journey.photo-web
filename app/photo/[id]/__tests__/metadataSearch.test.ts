import { describe, it, expect, vi } from "vitest";

// **写真ページのメタ情報が、実際に打たれる検索語に当たるか。**
//
// 実データ30枚のうち**29枚は題だけ**で、「白鳥と湖」「紅白」「Cafe」のように
// それだけでは検索語に当たらない（撮影地が題に入っているのは1枚）。
// 写真ページは索引に出せるページの約6割なので、ここが当たらないと他は誤差。
//
// ここで固定するのは:
//   - 撮影地を題に添えること（**既に入っていれば足さない**）
//   - 撮影地を説明に添えること（**書かれた説明は消さない**・機材名は出さない・2026-11-09）
//   - 長い説明には足さないこと（切られて括弧が開いたまま終わる）

const photos = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
vi.mock("@/lib/server/photos", () => ({
    loadAllPhotos: async () => photos.current,
    getPhotoById: async (id: string) => photos.current.find((p) => p.id === id) ?? null,
}));

const mod = await import("../page");
const generateMetadata = (mod as { generateMetadata: (a: { params: Promise<{ id: string }> }) => Promise<{ title?: string; description?: string }> }).generateMetadata;

const meta = async (photo: Record<string, unknown>) => {
    photos.current = [photo];
    return generateMetadata({ params: Promise.resolve({ id: String(photo.id) }) });
};

const base = {
    id: "p1", src: "https://cdn/1.jpg", published: true,
    title: { ja: "未完の大聖堂" },
};

describe("題に撮影地を添える", () => {
    it("撮影地があれば題に足す", async () => {
        const m = await meta({ ...base, location: "バルセロナ" });
        expect(m.title).toBe("未完の大聖堂｜バルセロナ");
    });

    // **同じ言葉を二度書かない**（「山中湖の朝｜山中湖」を作らない）
    it("題に既に入っていれば足さない", async () => {
        const m = await meta({ ...base, title: { ja: "山中湖の朝" }, location: "山中湖" });
        expect(m.title).toBe("山中湖の朝");
    });

    it("撮影地が無ければ題のまま", async () => {
        expect((await meta({ ...base })).title).toBe("未完の大聖堂");
    });
});

describe("説明に撮影地を添える（機材名は出さない）", () => {
    it("撮影地を括弧で足す。書かれた説明は消さない。機材名は出さない", async () => {
        const m = await meta({
            ...base, location: "パリ", description: { ja: ["静かな朝でした。"] },
            exif: { camera: "SONY ILCE-7M3" },
        });
        // **書かれた説明は消さない**
        expect(m.description).toContain("静かな朝でした。");
        expect(m.description).toContain("パリ");
        // 2026-11-09: 機材名は検索結果の説明に出さない（スペック表に読める）
        expect(m.description, "機材名が説明に出ている").not.toContain("SONY");
    });

    // **書かれた説明に既に撮影地が入っていたら足さない。**
    // 実データ2枚で「北海道にも春が訪れ…（北海道 / SONY ILCE-7M3）」に
    // なっていた（組み立て文の重複だけ塞いで、こちらは素通りしていた）
    it("説明に撮影地が入っていれば、撮影地は足さない", async () => {
        const m = await meta({
            ...base, location: "北海道",
            description: { ja: ["北海道にも春が訪れ、桜が咲き誇る季節となった。"] },
            exif: { camera: "SONY ILCE-7M3" },
        });
        expect(m.description, "撮影地が二重に出ている").not.toContain("（北海道");
        expect(m.description).toBe("北海道にも春が訪れ、桜が咲き誇る季節となった。");
    });

    // **長い説明には足さない。** 検索結果で切られて、括弧が開いたまま終わる
    it("長い説明には足さない", async () => {
        const long = "あ".repeat(100);
        const m = await meta({ ...base, location: "パリ", description: { ja: [long] }, exif: { camera: "SONY ILCE-7M3" } });
        expect(m.description).toBe(long);
    });

    it("機材も撮影地も無ければ、説明はそのまま", async () => {
        const m = await meta({ ...base, description: { ja: ["朝。"] } });
        expect(m.description).toBe("朝。");
    });

    // 説明が無い写真は、既存の組み立て（場所・年・カテゴリ）。機材は乗せない
    it("説明が無くても、事実だけで組み立てる（機材は乗せない）", async () => {
        const m = await meta({ ...base, location: "パリ", category: "landscape", exif: { camera: "SONY ILCE-7M3" } });
        expect(m.description).toBe("パリで撮影した風景の写真。");
        // **サイトのキャッチコピーを名乗らない**（説明を空にした写真が全部
        // 同じ meta description を持つ形にしない）
        expect(m.description).not.toContain("旅フォトギャラリー");
    });
});

/**
 * **住所の羅列を題・説明に出さない**（2026-11-09・Web 入口ページ監査の案A）。
 * 本番の写真ページの実値（検索の反応がいちばん良い型なので、題が読める形であることが効く）:
 *   題   ひろめ市場, 追手筋, 追手筋一丁目, 廿代町, 高知市, 高知県, 780-8571, 日本 | Journey Photo…
 *   説明 ひろめ市場に来た。…（ひろめ市場, 追手筋, …, 日本 / Apple iPhone 14 Pro）
 */
describe("住所の羅列を題・説明に出さない", () => {
    const HIROME = "ひろめ市場, 追手筋, 追手筋一丁目, 廿代町, 高知市, 高知県, 780-8571, 日本";
    const ADDRESS_PARTS = /780-8571|追手筋|廿代町|日本|Apple|iPhone/;
    const own = { ja: ["ひろめ市場に来た。炎に包まれ、豪快に炙られるカツオの味を楽しんだ。"] };

    it("題がスポット名だけなら「題｜市区町村」", async () => {
        const m = await meta({ ...base, title: { ja: "ひろめ市場" }, location: HIROME, description: own, exif: { camera: "Apple iPhone 14 Pro" } });
        expect(m.title).toBe("ひろめ市場｜高知市");
    });

    it("題が撮影地と関係なければ「題｜名前（市区町村）」", async () => {
        const m = await meta({ ...base, title: { ja: "炙りカツオ" }, location: HIROME });
        expect(m.title).toBe("炙りカツオ｜ひろめ市場（高知市）");
    });

    it("説明は書かれた文のあとに「県市」だけ。郵便番号・町名・機材名を出さない", async () => {
        const m = await meta({ ...base, title: { ja: "ひろめ市場" }, location: HIROME, description: own, exif: { camera: "Apple iPhone 14 Pro" } });
        expect(m.description).toBe("ひろめ市場に来た。炎に包まれ、豪快に炙られるカツオの味を楽しんだ。（高知県高知市）");
    });

    it("説明が無い写真は「名前（市区町村）で撮影した…」", async () => {
        const m = await meta({ ...base, location: HIROME, category: "landscape", exif: { camera: "Apple iPhone 14 Pro" } });
        expect(m.description).toBe("ひろめ市場（高知市）で撮影した風景の写真。");
    });

    it("題・説明のどこにも住所の断片と機材名が出ない", async () => {
        const m = await meta({ ...base, title: { ja: "ひろめ市場" }, location: HIROME, description: own, exif: { camera: "Apple iPhone 14 Pro" } });
        expect(`${m.title} ${m.description}`).not.toMatch(ADDRESS_PARTS);
    });
});

/**
 * **撮影地の方が題を含む回**に、題と撮影地を重ねていた。
 * 実ビルド:「オペラ・ガルニエ｜オペラ・ガルニエ（パリ）」＝サイトで一番長い題。
 * 判定が「題が撮影地を含むか」の片方向だけだった。
 */
describe("題と撮影地が重なるとき", () => {
    it("撮影地の方が題を含むなら、撮影地を出す（重ねない）", async () => {
        const m = await meta({ ...base, title: { ja: "オペラ・ガルニエ" }, location: "オペラ・ガルニエ（パリ）" });
        // 2026-11-09: 括弧の中の地域は市区町村として足す（題＋「｜パリ」）
        expect(m.title).toBe("オペラ・ガルニエ｜パリ");
    });

    // **短い題がたまたま撮影地の一部と一致する回を巻き込まない。**
    // 「海」は「…国営ひたち海浜公園」に含まれるが、撮影地は「海」で
    // 始まっていないので足す側のまま（実データで確認）
    it("題が撮影地の途中に現れるだけなら、今までどおり足す", async () => {
        const m = await meta({ ...base, title: { ja: "海" }, location: "茨城県 ひたちなか市 国営ひたち海浜公園" });
        // 2026-11-09: 撮影地の全文でなく「名前（市区町村）」
        expect(m.title).toBe("海｜国営ひたち海浜公園（ひたちなか市）");
    });

    it("題と撮影地が同じなら、題を残す", async () => {
        const m = await meta({ ...base, title: { ja: "山中湖" }, location: "山中湖" });
        expect(m.title).toBe("山中湖");
    });
});

/**
 * **説明の改行が `<meta name="description">` の属性値に残っていた**
 * （実ビルドで写真ページ5枚 × 3メタ）。`app/users/[id]` は自己紹介に
 * 同じ処理を前からしていた＝片方だけ素通りしていた。
 */
describe("説明は1行に均す", () => {
    it("説明の中の改行を空白にする", async () => {
        const m = await meta({ ...base, description: { ja: ["一行目。\n二行目。"] } });
        expect(m.description, "生の改行が残っている").not.toContain("\n");
        expect(m.description).toContain("一行目。 二行目。");
    });

    it("段落をまたぐ改行も残さない", async () => {
        const m = await meta({ ...base, description: { ja: ["前\n半", "後\n半"] } });
        expect(m.description).not.toContain("\n");
    });
});
