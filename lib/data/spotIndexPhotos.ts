// lib/data/spotIndexPhotos.ts
//
// **撮影スポットの入口（`/spots`）の写真の札に要る形**（2026-11-10・札 rymaruta/journey.photo-ios#516 の案A）。
//
// 🔴 **サーバー側だけで呼ぶ**（台帳 `SPOTS` を読む）。画面（`"use client"`）へは解いた結果だけを props で渡す
// ——渡したぶんは HTML に埋まり、訪問のたびに落ちる（`lib/data/spotLink.ts` の冒頭の実測）。
// だから1枚の札に渡すのは**写真の場所・代替文・出典の鍵**だけ。出典の中身は頁の下の一覧（`credits`）に1回だけ載せる。

import { SPOTS, type Spot } from "./spots";
import { isPublished } from "../utils/spotGuide";
import { OVERSEAS_SLUG } from "./prefectures";
import { ROUTES } from "../routes";
import { spotAreas, visibleSpotsInArea } from "./spotLink";
import { countryTopics, countryEn, homeSeasonalSpots, topicCardCover, type TopicCredit, type HomeSeasonal } from "./spotTopics";

/**
 * 札の写真。`creditKey` は頁の下の「写真の出典」の項目の鍵（＝写っているスポットのスラッグ）。
 * 表示の条件（CC BY 系）が無い写真は鍵ごと無い
 */
export type PhotoTile = { src: string; alt: string; creditKey?: string };

/** 「写真の出典」の1項目。**どの写真か**をスポットの名前で言う（札の写真と対応が分かるように） */
export type PhotoCreditEntry = { key: string; name: string; credit: TopicCredit };

/** 海外の国の札（`/spots/area/overseas/<国>` へ） */
export type CountryTile = { code: string; name: string; nameEn: string; href: string; count: number; cover: PhotoTile | null };

/** いまの季節の棚の1件 */
export type SeasonShelfSpot = { slug: string; name: string; region: string; cover: PhotoTile };

export type SpotIndexPhotos = {
    /** 県のスラッグ → 代表写真（写真のある県だけ。無い県は「名前だけの札」） */
    areaCovers: Record<string, PhotoTile>;
    /** 件数の多い国（`COUNTRY_TILES` か国まで） */
    countries: CountryTile[];
    /** 海外の国・地域の数（「すべての国・地域（N）」） */
    countryTotal: number;
    /** いまの季節の棚（ホームと同じ選び方＝`homeSeasonalSpots`） */
    seasonal: (Omit<HomeSeasonal, "spots"> & { spots: SeasonShelfSpot[] }) | null;
    /** 頁の下の「写真の出典」（頁に出る順・同じ写真は1回） */
    credits: PhotoCreditEntry[];
};

/** 写真の札にする国の数（2026-11-10 案A: 11 か国＋「すべての国・地域」の札で、3 列でも 6 列でも行が埋まる） */
export const COUNTRY_TILES = 11;
/** いまの季節の棚の件数（2026-11-10 判断: 電話で横に 2.5 枚見える棚を 8 枚。ホームの 6 より 1 画面ぶん多く） */
export const SEASON_SHELF = 8;

/**
 * 県・国の代表写真に選ぶ1件。**県の頁の並び（台帳の順）で、公開済みかつ写真のあるもの**を先に
 * （`topSpotsByArea` と同じ順位の付け方）。写真が1枚も無ければ `null`
 */
function representative(spots: readonly Spot[]): { spot: Spot; cover: NonNullable<ReturnType<typeof topicCardCover>> } | null {
    let fallback: { spot: Spot; cover: NonNullable<ReturnType<typeof topicCardCover>> } | null = null;
    for (const s of spots) {
        const cover = topicCardCover(s);
        if (!cover) continue;
        if (isPublished(s)) return { spot: s, cover };
        fallback ??= { spot: s, cover };
    }
    return fallback;
}

export function spotIndexPhotos(now: Date = new Date(), spots: readonly Spot[] = SPOTS): SpotIndexPhotos {
    const credits: PhotoCreditEntry[] = [];
    const seen = new Set<string>();
    /** 札の写真を作り、出典があれば一覧に足す（同じスポットの写真は1回だけ） */
    const tile = (slug: string, name: string, cover: { src: string; alt: string; credit: TopicCredit | null }): PhotoTile => {
        if (!cover.credit) return { src: cover.src, alt: cover.alt };
        if (!seen.has(slug)) {
            seen.add(slug);
            credits.push({ key: slug, name, credit: cover.credit });
        }
        return { src: cover.src, alt: cover.alt, creditKey: slug };
    };

    const home = homeSeasonalSpots(now, spots, SEASON_SHELF);
    const seasonal = home && {
        season: home.season, href: home.href, total: home.total,
        spots: home.spots.map((s) => ({
            slug: s.slug, name: s.name, region: s.region,
            cover: tile(s.slug, s.name, { src: s.src, alt: s.alt, credit: s.credit }),
        })),
    };

    const areaCovers: Record<string, PhotoTile> = {};
    for (const a of spotAreas()) {
        if (a.slug === OVERSEAS_SLUG) continue;
        const r = representative(visibleSpotsInArea(a.slug));
        if (!r) continue;
        areaCovers[a.slug] = tile(r.spot.slug, r.spot.name, r.cover);
    }

    const all = countryTopics(spots);
    const countries: CountryTile[] = all.slice(0, COUNTRY_TILES).map((c) => {
        const r = representative(c.spots);
        return {
            code: c.code, name: c.name, nameEn: countryEn(c.code), href: ROUTES.SPOT_COUNTRY(c.code), count: c.spots.length,
            cover: r ? tile(r.spot.slug, r.spot.name, r.cover) : null,
        };
    });

    return { areaCovers, countries, countryTotal: all.length, seasonal, credits };
}
