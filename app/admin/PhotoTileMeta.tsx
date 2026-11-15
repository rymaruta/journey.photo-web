import React from "react";

/**
 * 管理画面のタイルの下の一行（撮影地と分類）。
 *
 * **2026-11-15 判断（owner 承認「たのむ」）: 中黒「 · 」で区切らない。**
 * 前は `[location, category].join(" · ")` の一続きの字だった。owner の好み
 * （2026-11-12「・」「·」で区切らない）どおり、字の色と余白で分ける:
 * 撮影地は明るい字、分類は muted の字（白 50%、黒の上 5.28:1、本文の 4.5:1 に届く最小の段）、間は 6px（`gap-1.5`）。
 * 字の大きさはどちらも 12px（本文の最小）。撮影地が長いときは撮影地を先に省く。
 */
export default function PhotoTileMeta({ location, category }: { location?: string; category?: string }) {
    if (!location && !category) return null;
    return (
        <p className="flex min-w-0 items-baseline gap-1.5 text-[12px] leading-snug" data-testid="admin-photo-meta">
            {location && <span className="min-w-0 truncate text-white/80">{location}</span>}
            {category && <span className="shrink-0 max-w-[60%] truncate text-white/50">{category}</span>}
        </p>
    );
}
