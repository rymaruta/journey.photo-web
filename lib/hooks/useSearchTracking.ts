import { useEffect, useRef } from "react";
import { track } from "../utils/analytics";

/** 打ち終えたとみなす間（ミリ秒）。1文字ごとには数えない */
export const SEARCH_SETTLE_MS = 1500;
/** これより短い語は数えない（1文字の途中経過） */
export const SEARCH_MIN_LENGTH = 2;

/**
 * サイト内検索（写真をさがす）の GA4 `search`（2026-11-04）。
 *
 * - 打ち終えて `SEARCH_SETTLE_MS` 経ってから**1回**。同じ語は続けて数えない
 * - **語そのものは送らない**（`search_term_length` と `result_count` だけ。owner の判断待ち）
 * - 結果の件数は、打ち終えた時点の最新の値（直前の値で数えない）
 * - ユーザー検索（`/users/search`）は対象外（この hook を使っていない）
 * - `event` を `spots_search` にすると、撮影スポット一覧（`/spots`）の検索窓の数え方になる（同じ規則・別のイベント名・2026-11-09）
 */
export function useSearchTracking(query: string, resultCount: number, event: "search" | "spots_search" = "search"): void {
    const countRef = useRef(resultCount);
    const lastSent = useRef("");
    useEffect(() => { countRef.current = resultCount; }, [resultCount]);
    useEffect(() => {
        const term = query.trim();
        if (term.length < SEARCH_MIN_LENGTH || term === lastSent.current) return;
        const t = setTimeout(() => {
            lastSent.current = term;
            track(event, { search_term_length: term.length, result_count: countRef.current });
        }, SEARCH_SETTLE_MS);
        return () => clearTimeout(t);
    }, [query, event]);
}
