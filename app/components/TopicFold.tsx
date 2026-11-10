import type { ReactNode } from "react";

// app/components/TopicFold.tsx
//
// 撮影スポットの入口（`/spots`）と県の頁の、文字の札（季節×種類・市区町村・テーマ）を畳む段（2026-11-10・
// 札 rymaruta/journey.photo-ios#516 の案A）。`<details>` なので閉じていても中のリンクは HTML に全部ある。
// サーバーでもクライアントでも描ける（状態を持たない）

/**
 * **開け閉めの段の1つ**（2026-11-10・案A）。閉じていても中のリンクは HTML に全部ある（検索の入口・URL は変えない）。
 * 行は 52（板の「一行の行」）・題 15 の白・件数 13 の `text-2`・右の › は開くと下を向く
 */
export default function TopicFold({ id, title, count, children }: { id: string; title: ReactNode; count: number; children: ReactNode }) {
    return (
        <details id={id} className="group border-b border-line" data-testid="spots-topic-fold">
            <summary className="flex items-center justify-between gap-3 min-h-[52px] cursor-pointer list-none [&::-webkit-details-marker]:hidden text-white hover:bg-white/5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent rounded"
                     style={{ fontSize: "15px", lineHeight: "20px" }}>
                <span className="min-w-0">
                    {title}
                    <span className="ml-2 tabular-nums text-text-2" style={{ fontSize: "13px" }}>{count}</span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-text-2 transition-transform group-open:rotate-90 motion-reduce:transition-none" style={{ fontSize: "17px" }}>›</span>
            </summary>
            <div className="pt-1 pb-4">{children}</div>
        </details>
    );
}

