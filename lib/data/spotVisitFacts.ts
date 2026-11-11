// lib/data/spotVisitFacts.ts
//
// 撮影スポットの「行く前に知りたい事実」を、事実のファイル（`content/spot-visit-facts.json`）から引く。
// **サーバー側だけで読む**（ファイルが大きい）。型と純関数は `spotVisitFactsCore.ts`。

import raw from "@/content/spot-visit-facts.json";
import { cleanVisitFacts, type FactsFile, type SpotVisitFacts } from "./spotVisitFactsCore";

export * from "./spotVisitFactsCore";

const FILE = raw as FactsFile;

/** そのスポットの事実（出典の揃った行だけ）。無ければ `null` */
export function visitFactsFor(slug: string, file: FactsFile = FILE, today?: string): SpotVisitFacts | null {
    const f = Object.prototype.hasOwnProperty.call(file.spots, slug) ? file.spots[slug] : null;
    return cleanVisitFacts(f, today);
}

/** 事実のファイルにあるスラッグ（試験と集計用） */
export function visitFactSlugs(file: FactsFile = FILE): string[] {
    return Object.keys(file.spots);
}
