import React from "react";

/**
 * 一覧の頁の見出しの型（iOS `FavoritesView.header`・`AlbumsView.header`）。
 *
 * 眉ラベル（真鍮・黒地の上）→ 明朝の題（26・iOS の `JPFont.screenTitle`）→ 何の一覧かの一行（13・text-2）。
 * いいね・保存・行きたい場所・アルバムの4頁が同じ型を使う。頁ごとに太字ゴシックの題へ割れていた
 * （2026-11-04 判断: 棚卸し 0-2）。
 *
 * 眉は飾り（読み上げに出さない）。題は h1 で、同じ頁の中にもう一度同じ語の見出しを置かない
 * （マイページの札の中は `embedded` で見出しごと省く）。
 */
export default function ListPageHeader({ eyebrow, title, description, titleId, testId = "list-page-header", children }: {
    /** 眉（真鍮）。件数が入るなら呼ぶ側で「LIKED · 12枚」のように組んで渡す */
    eyebrow?: string;
    title: string;
    description?: React.ReactNode;
    /** 題の id（`#site-title` を頼る箇所用） */
    titleId?: string;
    testId?: string;
    children?: React.ReactNode;
}) {
    return (
        <header className="flex flex-col gap-1.5 mb-4 sm:mb-6" data-testid={testId}>
            {eyebrow && <p aria-hidden="true" className="m-0 eyebrow text-accent">{eyebrow}</p>}
            <h1 id={titleId} className="m-0 font-serif font-bold text-white" style={{ fontSize: "26px", lineHeight: 1.25 }}>
                {title}
            </h1>
            {description && (
                <p className="m-0 mt-0.5 text-text-2" style={{ fontSize: "13px", lineHeight: 1.6 }}>{description}</p>
            )}
            {children}
        </header>
    );
}
