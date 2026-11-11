// lib/data/swipeDeck.ts（サーバー専用）
//
// **撮影スポットを払う画面（`/swipe`）の札の山**を、ビルドのときに小さな JSON へ書き出す
// （`/app/data/swipe.json`・2026-11-11 owner の要望「撮影スポットを払う」の①・設計は案の資料の第7章）。
//
// - アプリの索引（`/app/data/spot-feed/index.json`・約 1.4MB で写真の URL を持たない）は読まない。
//   公開済みで**代表写真のある**撮影スポットを、決まった順で `SWIPE_DECK_SIZE` 件だけ選ぶ
// - 1件は 名前・地域・写真・代替文・出典。**写真はサムネ（240px）ではなくサイトに置いた元の大きさ**——札は画面いっぱいに
//   出すので、サムネでは粗く見えた（2026-11-11 Playwright の画面写真）。出典の決まりは撮影スポットの頁と同じ
//   （`topicCardCover`：CC BY・CC BY-SA は作者とライセンス、運営の写真で表記の求めが無いときだけ出さない）
// - 静的な置き場のファイル（Lambda も DB も通らない）なので、費用はほぼ増えない
// - 並びは「スラッグのハッシュ」順＝ビルドの日で変わらない。画面が開くたびに混ぜる
//
// 🔴 台帳を値で読む。**`"use client"` から import しない**。

import { SPOTS, type Spot } from "./spots";
import { topicSpots, toTopicCard } from "./spotTopics";
import { spotCoverImage } from "./spotImages";
import type { SwipeCard } from "../utils/spotSwipe";

/** 書き出す件数（数百件・gzip で数十 KB） */
export const SWIPE_DECK_SIZE = 400;

/** 決まった並びを作るための小さなハッシュ（FNV-1a・`spotTopics.ts` と同じ） */
function hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

export function swipeDeck(spots: readonly Spot[] = SPOTS, size: number = SWIPE_DECK_SIZE): SwipeCard[] {
    return topicSpots(spots)
        .map((s) => ({ c: toTopicCard(s), full: spotCoverImage(s)?.src }))
        .filter(({ c, full }) => c.cover && full)
        .sort((a, b) => hash(a.c.slug) - hash(b.c.slug) || a.c.slug.localeCompare(b.c.slug))
        .slice(0, size)
        .map(({ c, full }) => ({
            slug: c.slug,
            name: c.name,
            region: c.region,
            src: full!,
            alt: c.cover!.alt,
            credit: c.cover!.credit,
        }));
}
