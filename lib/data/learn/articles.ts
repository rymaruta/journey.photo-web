// lib/data/learn/articles.ts
//
// **写真とカメラの教科書（/learn）の記事の台帳**（2026-11-04）。
// 一覧のカード・パンくず・構造化データ・サイトマップが同じ値を読む（題や URL を2か所に書かない）。

import { ROUTES } from "@/lib/routes";
import { CHAPTERS } from "./chapters";

export type LearnArticle = {
    /** 記事の id（実例の写真の選び分けに使う） */
    id: string;
    /** 教科書の中の順（既存の3頁: 入門 1・構図 6・メーカー 11。章は `Chapter.number`） */
    number: number;
    href: string;
    /** 一覧のカードの眉（日本語） */
    eyebrow: string;
    title: string;
    description: string;
    /** 読む時間の目安（分）と難しさ（章だけ。既存の3頁は持たない） */
    minutes?: number;
    level?: string;
    /** 頁の公開日と最終更新日（構造化データ）。構図ガイドは別の頁なので持たない */
    published?: string;
    modified?: string;
};

/** 教科書の頁の名前（h1・パンくず・構造化データ） */
export const LEARN_TITLE = "写真とカメラの教科書";

const BASE_ARTICLES: LearnArticle[] = [
    {
        id: "camera-basics",
        number: 1,
        href: ROUTES.LEARN_CAMERA_BASICS,
        eyebrow: "第1章 はじめてのカメラ",
        title: "カメラの使い方 完全入門",
        description: "F値・シャッタースピード・ISO感度を「写真がどう変わるか」から理解する。露出補正、ピント、ホワイトバランス、RAW、スマートフォンでの撮り方まで。",
        published: "2026-11-04",
        modified: "2026-11-04",
    },
    {
        id: "camera-brands",
        number: 11,
        href: ROUTES.LEARN_CAMERA_BRANDS,
        eyebrow: "第11章 カメラ選び",
        title: "カメラメーカーの特徴を比較",
        description: "SONY・Canon・Nikon・FUJIFILM・Leica・Hasselblad・OM SYSTEM・Panasonic・RICOH/PENTAX。マウントとセンサーの大きさ、向く人、気をつけたい点。",
        published: "2026-11-04",
        modified: "2026-11-04",
    },
    {
        id: "composition",
        number: 6,
        href: ROUTES.COMPOSITION,
        eyebrow: "第6章 構図",
        title: "構図ガイド",
        description: "三分割・日の丸・対角線・シンメトリーなど。ガイド線を自分の写真に重ねて確かめられる。",
    },
];

/** 台帳（既存の3頁＋書き終えた章）。`number` の順 */
export const LEARN_ARTICLES: LearnArticle[] = [
    ...BASE_ARTICLES,
    ...CHAPTERS.map((c): LearnArticle => ({
        id: c.slug,
        number: c.number,
        href: `/learn/${c.slug}`,
        eyebrow: c.eyebrow,
        title: c.title,
        description: c.description,
        minutes: c.minutes,
        level: c.level,
        published: c.published,
        modified: c.modified,
    })),
].sort((a, b) => a.number - b.number);

export function learnArticle(id: LearnArticle["id"]): LearnArticle {
    const a = LEARN_ARTICLES.find((x) => x.id === id);
    if (!a) throw new Error(`教科書の記事が無い: ${id}`);
    return a;
}
