"use client";

// app/components/SpotThumbMark.tsx
//
// **撮影スポットの一覧の行の、左の丸い印**（iOS の `PhotoMapView.spotRow`・2026-11-04）。
//
//     写真あり  写真の丸 40・真鍮の縁 2（iOS: `SpotThumbImage` を円で切り、`JPStroke.emphasis`＝2 の縁）。
//               **地は暗い面（`bg-surface-2`）**——以前は真鍮の塗りで、遅延読み込みの写真がまだ来ていない間
//               （画面の外・全画面の写真）は「写真の代わりの金色の丸」に見えた（2026-11-09・Web 入口ページ監査。
//               本番の「近くの撮影スポット」の実画面で確認）。読み込めば写真が丸ごと覆うので、読み込んだ後の見た目は同じ
//     写真なし  呼ぶ側が渡す印（地図の一覧は真鍮の丸にカメラ・近くの撮影スポットはピンの印）
//
// 写真は同梱の小さい版（短い辺 240px・`spotRowThumbPath`）。**遅延読み込み**（`loading="lazy"`・`decoding="async"`）で、
// 寸法（width／height 40）を予約するので行の高さは動かない。読み込みに失敗したら印に戻す
// （空の枠・壊れた画像のアイコンを出さない）。alt は空——行の文字が名前を言う。
// 権利の判断（出してよい写真か）はサーバー側で済んでいる（`hasSpotRowThumb`）。ここは渡された `src` を描くだけ。

import React, { useState } from "react";

/** 丸の直径（iOS の `SpotMapMarker.photoSize` と同じ 40） */
export const SPOT_MARK_PX = 40;

export default function SpotThumbMark({ src, fallback }: { src?: string; fallback: React.ReactNode }) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    if (!src || failedSrc === src) return <>{fallback}</>;
    return (
        <span className="flex-shrink-0 block overflow-hidden rounded-full bg-surface-2 ring-2 ring-inset ring-accent"
              style={{ width: SPOT_MARK_PX, height: SPOT_MARK_PX }} data-testid="spot-thumb-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt=""
                width={SPOT_MARK_PX}
                height={SPOT_MARK_PX}
                loading="lazy"
                decoding="async"
                onError={() => setFailedSrc(src)}
                className="w-full h-full object-cover rounded-full"
                style={{ padding: "2px" }}
            />
        </span>
    );
}
