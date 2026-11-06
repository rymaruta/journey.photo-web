// lib/data/learn/chapters.ts
//
// **教科書の章の一覧**（2026-11-04）。章は `chapters/<slug>.ts` に1つずつ。書き終えた章（`null` でないもの）だけが
// 一覧・サイトマップ・頁になる。順は `number`（既存の3頁は `articles.ts` の番号: 入門 1・構図 6・メーカー 11）。

import type { Chapter } from "./chapterTypes";
import { FOCUS_AND_BLUR } from "./chapters/focus-and-blur";
import { MOTION } from "./chapters/motion";
import { LIGHT_AND_COLOR } from "./chapters/light-and-color";
import { LENSES } from "./chapters/lenses";
import { SCENE_RECIPES } from "./chapters/scene-recipes";
import { RAW_EDITING } from "./chapters/raw-editing";
import { TROUBLESHOOTING } from "./chapters/troubleshooting";
import { GEAR_CARE } from "./chapters/gear-care";
import { GLOSSARY } from "./chapters/glossary";
import { PRACTICE_30DAYS } from "./chapters/practice-30days";
import { AUTUMN_LEAVES } from "./chapters/autumn-leaves";

const ALL: (Chapter | null)[] = [
    FOCUS_AND_BLUR,
    MOTION,
    LIGHT_AND_COLOR,
    LENSES,
    SCENE_RECIPES,
    RAW_EDITING,
    TROUBLESHOOTING,
    GEAR_CARE,
    GLOSSARY,
    PRACTICE_30DAYS,
    AUTUMN_LEAVES,
];

export const CHAPTERS: Chapter[] = ALL.filter((c): c is Chapter => c !== null)
    .sort((a, b) => a.number - b.number);

export function chapterBySlug(slug: string): Chapter | undefined {
    return CHAPTERS.find((c) => c.slug === slug);
}
