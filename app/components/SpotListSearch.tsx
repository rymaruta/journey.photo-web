"use client";

import React from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { SEARCH_FIELD, SEARCH_FIELD_STYLE, SEARCH_ICON, SEARCH_ICON_STYLE } from "./fieldStyles";
import SpotRows, { type SpotRow } from "./SpotRows";
import SpotAreaChip, { AREA_TILE_GRID } from "./SpotAreaChip";
import { useSpotSearchIndex } from "@/lib/hooks/useSpotSearchIndex";
import { useUrlSearch } from "@/lib/hooks/useUrlSearch";
import { useSearchTracking } from "@/lib/hooks/useSearchTracking";
import { searchSpotList, matchSpotAreas, type SpotAreaLike } from "@/lib/utils/spotListSearch";
import { spotRowThumbPath } from "@/lib/utils/spotThumbPath";
import { withNextHistoryState } from "@/lib/utils/historyState";
import { isImeKey } from "@/lib/utils/ime";
import type { SpotSearchRow } from "@/lib/utils/spots";

/**
 * **撮影スポット一覧（`/spots`）の検索窓**（2026-11-09 owner「撮影スポットを探す一覧に検索窓がほしい」）。
 * 検索の規則は `lib/utils/spotListSearch.ts`（iOS もこの規則に合わせる・`docs/spot-list-search.md`）。
 *
 * ## 2026-11-09 判断
 *
 * - **索引は新しく作らない。** 「さがす」・地図と同じ名前だけの索引（`/app/data/spot-search.json`・約130KB）を
 *   `useSpotSearchIndex` で**語が入ったときに1回だけ**取る。探さない人には1バイトも増えない（新しい API・費用なし）
 * - **静的HTMLの県の一覧は消さない。** 検索の表示はクライアントだけで、`children`（県の一覧と切り口の節）は
 *   最初から HTML に在る。結果があるあいだだけ `hidden` にする（DOM には残る）
 * - **入力は `?q=` に残す**（`history.replaceState`・履歴は積まない）。スポットを開いて戻ると復元され、URL を共有できる。
 *   `useSearchParams` は静的書き出しで一覧の静的HTMLを空にするので使わない（`useUrlSearch`）。
 *   書くのは 250ms の間を置く（Safari は `replaceState` を 30秒に100回までしか許さない）。結果のリンクを押す直前に流す
 * - **変換中（IME の確定前）は絞らない。** `compositionend` で絞る。確定の Enter はキーボードを閉じるだけ
 * - **語は外へ送らない**（`spots_search`＝長さと件数だけ）
 * - 0件のときは県の一覧を残し、そこから探せるようにする
 */

/** 最初に出す件数と、「さらに表示」で足す件数 */
export const SPOT_LIST_PAGE = 30;
/** URL へ書くまでの間（ミリ秒） */
const URL_WRITE_MS = 250;

/** 索引の1行 → 一覧の行。丸い印は、索引の写真が小さい版（`spotRowThumbPath`）のときだけ（大きい写真は読まない） */
function toRow(r: SpotSearchRow): SpotRow {
    return {
        slug: r.s, name: r.n, region: r.g,
        ...(r.image?.src === spotRowThumbPath(r.s) ? { thumb: true as const } : {}),
    };
}

/** URL の `?q=` を書き換える（履歴は積まない。Next の内部の state は持ち越す） */
function writeQueryToUrl(q: string): void {
    try {
        const url = new URL(window.location.href);
        if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
        const next = url.pathname + url.search + url.hash;
        if (next === window.location.pathname + window.location.search + window.location.hash) return;
        window.history.replaceState(withNextHistoryState({}), "", next);
    } catch {
        // URL に残せなくても、検索そのものは動く
    }
}

export default function SpotListSearch({ areas, isJa, children }: {
    areas: Array<SpotAreaLike>;
    isJa: boolean;
    /** 県の一覧と切り口の節（サーバーで描いた静的HTML）。検索結果があるあいだだけ隠す */
    children: React.ReactNode;
}) {
    const urlQ = new URLSearchParams(useUrlSearch()).get("q") ?? "";
    /** 入力欄に見えている文字 */
    const [draft, setDraft] = React.useState("");
    /** 絞り込みに使う語（変換中は動かさない） */
    const [applied, setApplied] = React.useState("");
    const composingRef = React.useRef(false);
    /** 最後に URL へ書いた（または URL から受けた）値。これと違う `?q=` は外から変わったもの */
    const syncedRef = React.useRef("");
    const inputRef = React.useRef<HTMLInputElement>(null);

    // URL → 入力欄（最初の読み込み・戻る・ほかの導線で `?q=` が変わったとき）
    React.useEffect(() => {
        if (urlQ === syncedRef.current) return;
        syncedRef.current = urlQ;
        setDraft(urlQ);
        setApplied(urlQ);
    }, [urlQ]);

    // 入力欄 → URL（間を置いて書く）。流す関数は結果のリンクを押す直前にも呼ぶ
    const appliedRef = React.useRef(applied);
    React.useEffect(() => { appliedRef.current = applied; }, [applied]);
    const flushUrl = React.useCallback(() => {
        const q = appliedRef.current.trim();
        if (q === syncedRef.current) return;
        syncedRef.current = q;
        writeQueryToUrl(q);
    }, []);
    React.useEffect(() => {
        const t = setTimeout(flushUrl, URL_WRITE_MS);
        return () => clearTimeout(t);
    }, [applied, flushUrl]);

    const q = applied.trim();
    const { rows, pending } = useSpotSearchIndex(q);
    const hits = React.useMemo(() => (q && rows ? searchSpotList(rows, q) : []), [rows, q]);
    const areaHits = React.useMemo(() => (q ? matchSpotAreas(areas, q) : []), [areas, q]);
    // 索引が届く前の 0 を「0件」として数えない
    useSearchTracking(rows ? q : "", hits.length, "spots_search");

    /** 開いた件数。**語が変わったら自然に戻る**（effect で戻さない） */
    const [more, setMore] = React.useState<{ q: string; n: number }>({ q: "", n: SPOT_LIST_PAGE });
    const shownCount = more.q === q ? more.n : SPOT_LIST_PAGE;
    const shown = hits.slice(0, shownCount);

    const failed = !!q && !rows && !pending;
    const searching = !!q;
    const hasHits = hits.length > 0;
    const empty = searching && !!rows && !hasHits;
    const label = isJa ? "撮影スポットを検索" : "Search photo spots";

    return (
        <>
            <form role="search" aria-label={label} className="mb-6" data-testid="spots-search"
                  onSubmit={(e) => { e.preventDefault(); inputRef.current?.blur(); }}>
                <div className="relative max-w-2xl">
                    <label htmlFor="spots-search-input" className="sr-only">{label}</label>
                    <MagnifyingGlassIcon aria-hidden="true" className={SEARCH_ICON} style={SEARCH_ICON_STYLE} />
                    <input
                        ref={inputRef}
                        id="spots-search-input"
                        name="q"
                        type="search"
                        value={draft}
                        data-testid="spots-search-input"
                        onChange={(e) => {
                            setDraft(e.target.value);
                            if (!composingRef.current) setApplied(e.target.value);
                        }}
                        onCompositionStart={() => { composingRef.current = true; }}
                        onCompositionEnd={(e) => {
                            composingRef.current = false;
                            setApplied(e.currentTarget.value);
                        }}
                        onKeyDown={(e) => {
                            // 確定キー（iPhone では「検索」）でキーボードを閉じる。結果は打つたびに出ている。変換の確定の Enter は除く
                            if (e.key === "Enter" && !isImeKey(e.nativeEvent)) { e.preventDefault(); e.currentTarget.blur(); }
                        }}
                        enterKeyHint="search"
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder={isJa ? "スポット名・県・エリア" : "Spot, prefecture or area"}
                        className={SEARCH_FIELD}
                        style={SEARCH_FIELD_STYLE}
                    />
                    {draft && (
                        <button type="button" data-testid="spots-search-clear"
                                aria-label={isJa ? "検索をクリア" : "Clear search"}
                                onClick={() => {
                                    composingRef.current = false;
                                    setDraft(""); setApplied("");
                                    inputRef.current?.focus();
                                }}
                                className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-full text-text-3 hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                                style={{ width: "44px", height: "44px", touchAction: "manipulation" }}>
                            <XMarkIcon aria-hidden="true" className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </form>

            {searching && (
                // 結果のリンクを押す直前に、いまの語を URL へ流す（押したあとの `pushState` に上書きされない・戻ると復元される）
                <div data-testid="spots-search-results" className="mb-7" onClickCapture={flushUrl}>
                    <p role="status" aria-live="polite" className="m-0 mb-3 text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}
                       data-testid="spots-search-status">
                        {failed
                            ? (isJa ? "検索の準備ができませんでした。通信を確かめて、もう一度入力してください。" : "Couldn't load the search data. Check your connection and try typing again.")
                            : !rows
                                ? (isJa ? "さがしています…" : "Searching…")
                                : empty
                                    ? (isJa ? `「${q}」の撮影スポットは見つかりません。` : `No photo spots found for "${q}".`)
                                    : (isJa ? `公開中の撮影スポットのうち ${hits.length}件が当たりました。` : `${hits.length} of the published photo spots matched.`)}
                    </p>

                    {areaHits.length > 0 && (
                        <div className="mb-4" data-testid="spots-search-areas">
                            <p className="m-0 mb-2 text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }}>
                                {isJa ? "地域の一覧を見る" : "Browse by area"}
                            </p>
                            <ul className={AREA_TILE_GRID} style={{ listStyle: "none" }}>
                                {areaHits.map((a) => (
                                    <li key={a.slug}><SpotAreaChip slug={a.slug} label={isJa ? a.name : a.nameEn} count={a.count} /></li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {hasHits && <SpotRows rows={shown.map(toRow)} isJa={isJa} />}
                    {hits.length > shownCount && (
                        <button type="button" data-testid="spots-search-more"
                                onClick={() => setMore({ q, n: shownCount + SPOT_LIST_PAGE })}
                                className="mt-3 rounded-full px-4 text-white/80 ring-1 ring-line hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                style={{ minHeight: "44px", fontSize: "13px" }}>
                            {isJa ? `さらに表示（残り${hits.length - shownCount}件）` : `Show more (${hits.length - shownCount} left)`}
                        </button>
                    )}
                    {empty && (
                        <p className="m-0 mt-2 text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>
                            {isJa ? "県名・市区町村名・ひらがなでもお試しください。下の地域の一覧からも探せます。" : "Try a prefecture, a city or the reading in kana. You can also browse the areas below."}
                        </p>
                    )}
                </div>
            )}

            {/* 静的HTMLの一覧。**消さずに隠す**（クローラー向けのリンクを HTML に残す）。結果があるあいだだけ隠す */}
            <div hidden={searching && hasHits} data-testid="spots-default-list" className="[&_h2]:scroll-mt-20">
                {children}
            </div>
        </>
    );
}
