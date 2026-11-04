// lib/learn/covers.ts
//
// **教科書の一覧のカードの写真**を選ぶ（2026-11-04）。記事どうしで同じ写真を使わない。
// 入門 = F値の小さい写真（ぼけが見える）、メーカー = 機種の分かる写真、構図 = 残りの新しい写真。
// 合う写真が無い記事は写真を持たない（カードは写真の枠ごと出さない）。

import type { Photo } from "@/lib/data/photos";
import type { LearnArticle } from "@/lib/data/learn/articles";
import { exampleRule } from "@/lib/data/learn/cameraBasics";
import { brandOfCamera } from "@/lib/data/learn/cameraBrands";
import { CHAPTERS } from "@/lib/data/learn/chapters";
import { isExampleCandidate, pickExamples, cameraOf } from "./examples";

const stamp = (p: Photo) => String(p.date || p.createdAt || "");

export function coverPhotos(photos: Photo[]): Partial<Record<LearnArticle["id"], Photo>> {
    const used = new Set<string>();
    const take = (list: Photo[]) => {
        const p = list.find((x) => !used.has(x.id));
        if (p) used.add(p.id);
        return p;
    };
    const candidates = photos.filter(isExampleCandidate);
    const newest = [...candidates].sort((a, b) => stamp(b).localeCompare(stamp(a)));
    return {
        "camera-basics": take(pickExamples(candidates, exampleRule("wide-aperture"), 10)),
        "camera-brands": take(newest.filter((p) => !!brandOfCamera(cameraOf(p)))),
        composition: take(newest),
        // 章（書き終えたもの）: 新しい写真から、記事どうしで重ならないように
        ...Object.fromEntries(CHAPTERS.map((c) => [c.slug, take(newest)] as const)),
    };
}
