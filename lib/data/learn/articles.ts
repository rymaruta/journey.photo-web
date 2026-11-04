// lib/data/learn/articles.ts
//
// **写真とカメラの教科書（/learn）の記事の台帳**（2026-11-04）。
// 一覧のカード・パンくず・構造化データ・サイトマップが同じ値を読む（題や URL を2か所に書かない）。

import { ROUTES } from "@/lib/routes";

export type LearnArticle = {
    /** 記事の id（実例の写真の選び分けに使う） */
    id: "camera-basics" | "camera-brands" | "composition";
    href: string;
    /** 一覧のカードの眉（日本語） */
    eyebrow: string;
    title: string;
    description: string;
    /** 頁の公開日と最終更新日（構造化データ）。構図ガイドは別の頁なので持たない */
    published?: string;
    modified?: string;
};

/** 教科書の頁の名前（h1・パンくず・構造化データ） */
export const LEARN_TITLE = "写真とカメラの教科書";

export const LEARN_ARTICLES: LearnArticle[] = [
    {
        id: "camera-basics",
        href: ROUTES.LEARN_CAMERA_BASICS,
        eyebrow: "はじめてのカメラ",
        title: "カメラの使い方 完全入門",
        description: "F値・シャッタースピード・ISO感度を「写真がどう変わるか」から理解する。露出補正、ピント、ホワイトバランス、RAW、スマートフォンでの撮り方まで。",
        published: "2026-11-04",
        modified: "2026-11-04",
    },
    {
        id: "camera-brands",
        href: ROUTES.LEARN_CAMERA_BRANDS,
        eyebrow: "カメラ選び",
        title: "カメラメーカーの特徴を比較",
        description: "SONY・Canon・Nikon・FUJIFILM・Leica・Hasselblad・OM SYSTEM・Panasonic・RICOH/PENTAX。マウントとセンサーの大きさ、向く人、気をつけたい点。",
        published: "2026-11-04",
        modified: "2026-11-04",
    },
    {
        id: "composition",
        href: ROUTES.COMPOSITION,
        eyebrow: "構図",
        title: "構図ガイド",
        description: "三分割・日の丸・対角線・シンメトリーなど。ガイド線を自分の写真に重ねて確かめられる。",
    },
];

export function learnArticle(id: LearnArticle["id"]): LearnArticle {
    const a = LEARN_ARTICLES.find((x) => x.id === id);
    if (!a) throw new Error(`教科書の記事が無い: ${id}`);
    return a;
}
