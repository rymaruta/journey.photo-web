// lib/learn/covers.ts
//
// **教科書の一覧のカードの写真**を選ぶ（2026-11-04）。記事どうしで同じ写真を使わない。
// 入門 = F値の小さい写真（ぼけが見える・スマホは外す）、メーカー = 機種の分かるカメラの写真、
// 構図 = 残りの新しいカメラの写真。**どの表紙もスマートフォンの写真を避ける**（2026-11-04・確かめ役の指摘:
// F値の小さい実例の先頭が iPhone の f/1.8・7mm の風景で、ぼけない写真が「ぼけ」の記事の顔になっていた）。
// 合う写真が無い記事は写真を持たない（カードは写真の枠ごと出さない）。

import type { Photo } from "@/lib/data/photos";
import type { LearnArticle } from "@/lib/data/learn/articles";
import { exampleRule, isSmartphone } from "@/lib/data/learn/cameraBasics";
import { brandOfCamera } from "@/lib/data/learn/cameraBrands";
import { isExampleCandidate, pickExamples, cameraOf } from "./examples";

const stamp = (p: Photo) => String(p.date || p.createdAt || "");

export function coverPhotos(photos: Photo[]): Partial<Record<LearnArticle["id"], Photo>> {
    const used = new Set<string>();
    const take = (list: Photo[]) => {
        const p = list.find((x) => !used.has(x.id));
        if (p) used.add(p.id);
        return p;
    };
    const candidates = photos.filter((p) => isExampleCandidate(p) && !isSmartphone(cameraOf(p)));
    const newest = [...candidates].sort((a, b) => stamp(b).localeCompare(stamp(a)));
    return {
        "camera-basics": take(pickExamples(candidates, exampleRule("wide-aperture"), 10)),
        "camera-brands": take(newest.filter((p) => !!brandOfCamera(cameraOf(p)))),
        composition: take(newest),
    };
}
