"use client";

import React from "react";

/** 流れているときの下の線（白 8%・`--color-line`）と、上に留まったときの線（白 12%）。iOS `ProfileTabStyle.lineOpacity` */
export const TAB_LINE_FLOWING = "var(--color-line)";
export const TAB_LINE_STUCK = "rgb(255 255 255 / 0.12)";

/**
 * **下へ送っても見えている上端（共通の見出しの下）に留まる札の行**（iOS のホームの `pinnedFeedRow`・#417 ⑧）。
 *
 * iOS は「見出しの下に留まる」「留まっている間は地を黒 100%・下の線を白 12% に濃くする」（`ProfileTabBar` の `stuck`）。
 * Web は `position: sticky` で留め、留まったかどうかは**行のすぐ上の目印**が見出しの下端より上へ抜けたかで見る
 * （`IntersectionObserver` は見出しの高さ＝`--header-h` を余白に渡せないので、送りのたびに位置で比べる。
 * 値が変わったときだけ描き直す）。
 *
 * - 地はいつも画面の黒（`bg-bg`）。流れている間も黒地の上なので見た目は変わらず、留まったときに下の写真を隠す
 * - スマホは本文の左右の余白（16）まで地と線を伸ばす（iOS の札の行は画面の端から端まで線を引く）。
 *   写真の並び（`HomeMosaic`）も端から端までなので、余白から写真が覗かない
 * - 見出しより下・写真の重ね（撮影地・いいねの丸）より上に描く（`z-30`。見出しは `z-50`）
 */
export default function StickyTabRow({ children, className = "", testId = "home-feed-row", resetKey }: {
    children: React.ReactNode;
    className?: string;
    testId?: string;
    /**
     * 選んでいるタブ。**変わったとき行が留まっていたら、行を見えている上端へ戻す**＝新しい一覧は頭から
     * （iOS の `GalleryView` の `.onChange(of: model.feed)`・`ProfileTabScroll.scrollsToRow`）。
     * 留まっていなければ（まだ送っていない）そのまま。
     *
     * 2026-11-04 の実測（390×844・新着を 2500 送ってから、0件の「フォロー中」へ）: 頁の高さが 12087 → 1481 に縮み、
     * 送りの位置が 637 に詰められ、空の知らせ（頁の 389 から）が留まった行の裏（上）へ隠れて、行の下は何も無い黒だった。
     * 送りの位置をそのまま残すと、長い一覧どうしでも新しい一覧の途中（2500）から見せることになる
     */
    resetKey?: string;
}) {
    const rowRef = React.useRef<HTMLDivElement>(null);
    const markRef = React.useRef<HTMLDivElement>(null);
    const [stuck, setStuck] = React.useState(false);
    // 替えた瞬間に見る「留まっていたか」（最後に測った値。描き直しの前の値）
    const stuckRef = React.useRef(false);
    const lastKeyRef = React.useRef(resetKey);

    // 中身が入れ替わったのと同じ描画の直後（絵を出す前）に戻す——縮んだ頁で詰められた位置を一瞬も見せない
    React.useLayoutEffect(() => {
        if (lastKeyRef.current === resetKey) return;
        lastKeyRef.current = resetKey;
        const row = rowRef.current;
        const mark = markRef.current;
        if (!row || !mark || !stuckRef.current) return;
        const top = parseFloat(window.getComputedStyle(row).top) || 0;
        window.scrollTo(0, mark.getBoundingClientRect().top + window.scrollY - top);
    }, [resetKey]);

    React.useEffect(() => {
        const row = rowRef.current;
        const mark = markRef.current;
        if (!row || !mark) return;
        let frame = 0;
        const measure = () => {
            frame = 0;
            // 留まる位置（`top: var(--header-h)` を px に解いた値）。見出しを出さない頁の形でも 0 になるだけ
            const top = parseFloat(window.getComputedStyle(row).top) || 0;
            const next = mark.getBoundingClientRect().top < top - 0.5;
            stuckRef.current = next;
            setStuck((prev) => (prev === next ? prev : next));
        };
        const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
        measure();
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        return () => {
            window.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, []);

    return (
        <>
            {/* 行の元の位置の目印（高さ 0）。これが見出しの下端より上へ抜けたら「留まった」 */}
            <div ref={markRef} aria-hidden="true" data-testid={`${testId}-mark`} style={{ height: 0 }} />
            <div
                ref={rowRef}
                data-testid={testId}
                data-stuck={stuck ? "true" : "false"}
                className={`sticky top-[var(--header-h)] z-30 bg-bg -mx-4 px-4 sm:mx-0 sm:px-0 border-b ${className}`}
                style={{ borderBottomColor: stuck ? TAB_LINE_STUCK : TAB_LINE_FLOWING }}
            >
                {children}
            </div>
        </>
    );
}
