// 郷土料理とお土産の頁（`/food/<県>`・2026-11-23・案 B の試作）のデータ。
//
// owner の声（2026-11-10）「旅のお供、美味しいお店や郷土料理、お土産のページとかも欲しいね」。
// 案 B（県ごとの「郷土料理とお土産」頁を、まず 5 県）を 2026-11-23 に承認。決まりは:
//   - **お店（店名・営業・評価）は載せない。** 品目だけ。会社の商品名も推さない
//   - 品目と事実の元は農林水産省「うちの郷土料理」。**文は自前で要約**し、品目ごとに出典の頁を張る
//     （公共データ利用規約 1.0。出典と「編集・加工した旨」を頁に書く。国が作ったように見せない）
//   - **写真は使わない**（農水省の頁の写真は提供元の権利が付くものがある）
//   - 撮影スポットとは、**出典が書く伝承地域の市町村にある公開スポット**だけを結ぶ。「近く」と推測で結ばない
//   - 費用 0 円・DB の変更なし。中身は `content/local-food.json`（人が書く棚・撮影スポットの台帳と同じ置き場）
//
// 公開の印は撮影スポットの台帳と同じ考え方: `status: "published"` と、確かめた記録（`aiCheck`）。
// AI が出典と1文ずつ照らした行は `aiCheck`（`delegatedBy` は委任した人。AI の名前は書けない）。

import raw from "@/content/local-food.json";
import { SPOTS, type Spot } from "./spots";
import { visibleSpots, isPublished } from "../utils/spotGuide";
import { prefectureBySlug } from "./prefectures";
import { titleWidth } from "../utils/titleWidth";

export type FoodSource = {
    /** 出典の頁の題（例: 農林水産省「うちの郷土料理」いかめし） */
    title: string;
    /** 出典の頁（https） */
    url: string;
    /** 読んだ日（YYYY-MM-DD） */
    retrievedAt: string;
};

export type FoodItem = {
    /** 頁の中の錨（英小文字・数字・ハイフン） */
    id: string;
    name: string;
    /** 出典が書く主な伝承地域（短くしたもの。地名を足さない） */
    where: string;
    /** 出典が書く時季・機会。書いていなければ null */
    season: string | null;
    /** 自前の要約（出典の事実だけ） */
    summary: string;
    /** 伝承地域の市町村にある撮影スポットの slug（公開のものだけが頁に出る） */
    spots: string[];
    source: FoodSource;
};

export type FoodAiCheck = {
    checkedAt: string;
    /** 委任した人（AI の名前は書けない） */
    delegatedBy: string;
    /** 何と照らしたか（1文） */
    method: string;
};

export type FoodArea = {
    /** 県の綴り（`PREFECTURES` の slug） */
    area: string;
    status: "published" | "review";
    aiCheck?: FoodAiCheck;
    /** 頁の導入文 */
    intro: string;
    dishes: FoodItem[];
    souvenirs: FoodItem[];
};

type FoodFile = { areas: FoodArea[] };

/** 台帳の全件（下書きを含む） */
export const FOOD_AREAS: readonly FoodArea[] = (raw as FoodFile).areas;

/** 検索に出す線: 郷土料理が 6 品以上（薄い頁を出さない） */
export const MIN_INDEXABLE_DISHES = 6;

/** 頁を建てるか（公開の印が揃っている行だけ） */
export function isFoodPublished(a: FoodArea): boolean {
    if (a.status !== "published") return false;
    const c = a.aiCheck;
    return Boolean(c?.checkedAt?.trim() && c.delegatedBy?.trim() && c.method?.trim());
}

/** 建てる県（公開済みだけ） */
export function foodAreas(areas: readonly FoodArea[] = FOOD_AREAS): FoodArea[] {
    return areas.filter(isFoodPublished);
}

export function foodArea(slug: string, areas: readonly FoodArea[] = FOOD_AREAS): FoodArea | undefined {
    return foodAreas(areas).find((a) => a.area === slug);
}

/** 検索に出すか */
export function isFoodIndexable(a: FoodArea): boolean {
    return isFoodPublished(a) && a.dishes.length >= MIN_INDEXABLE_DISHES;
}

export function foodPrefecture(a: Pick<FoodArea, "area">) {
    return prefectureBySlug(a.area);
}

/** 頁に出す撮影スポット（公開中のものだけ・台帳に無い綴りは落とす） */
export type FoodSpotLink = { slug: string; name: string };
export function foodSpotLinks(item: Pick<FoodItem, "spots">, spots: readonly Spot[] = SPOTS): FoodSpotLink[] {
    const bySlug = new Map(visibleSpots(spots).filter(isPublished).map((s) => [s.slug, s]));
    return item.spots.flatMap((slug) => {
        const s = bySlug.get(slug);
        return s ? [{ slug: s.slug, name: s.name }] : [];
    });
}

/**
 * 頁の見出し。**お土産が0品の県は「〇〇の郷土料理」**（出典に「土産」「名産品」と書いた品が無い県・京都府）。
 * 「お土産」と名乗って中身が無い頁にしない
 */
export function foodHeading(prefName: string, a: Pick<FoodArea, "souvenirs">): string {
    return a.souvenirs.length > 0 ? `${prefName}の郷土料理とお土産` : `${prefName}の郷土料理`;
}

/** 題の上限（全角換算）。撮影スポット・テーマの頁と同じ 33 */
export const FOOD_TITLE_MAX = 33;

/**
 * 題（サイト名の template を外した完全な形）。検索で打たれる「〇〇 郷土料理」「〇〇 お土産」を頭に置き、
 * 収まれば料理の名前を2つ添える:
 *   北海道の郷土料理とお土産｜豚丼、いかめしほか → …｜豚丼ほか → 北海道の郷土料理とお土産
 */
export function foodTitle(prefName: string, a: Pick<FoodArea, "dishes" | "souvenirs">): string {
    const head = foodHeading(prefName, a);
    const [x, y] = a.dishes.map((d) => d.name);
    const cands = [
        ...(x && y ? [`${head}｜${x}、${y}ほか`] : []),
        ...(x ? [`${head}｜${x}ほか`] : []),
    ];
    return cands.find((t) => titleWidth(t) <= FOOD_TITLE_MAX) ?? head;
}

/** 説明の長さの目安（字）。撮影スポットの頁と同じ 120 */
export const FOOD_DESCRIPTION_MAX = 120;

/**
 * 説明。品数と先頭の名前、出典の言い方。文の途中で切らない（収まらない文は入れない）
 */
export function foodDescription(prefName: string, a: Pick<FoodArea, "dishes" | "souvenirs">): string {
    const names = a.dishes.slice(0, 3).map((d) => d.name).join("、");
    const count = a.souvenirs.length > 0 ? `郷土料理${a.dishes.length}品とお土産${a.souvenirs.length}品` : `郷土料理${a.dishes.length}品`;
    const lead = `${prefName}の${count}。${names}${a.dishes.length > 3 ? "など" : ""}。`;
    const parts = [
        "伝承地域の観光スポットにもつないでいます。",
        "農林水産省「うちの郷土料理」をもとに要約しました。",
    ];
    let out = lead;
    for (const p of parts) if ([...out].length + [...p].length <= FOOD_DESCRIPTION_MAX) out += p;
    return out;
}
