"use client";

import React from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

/**
 * **県（地域）の札**（名前＋件数・`/spots/area/<slug>` へ）。`/spots` の県の一覧と、検索窓の
 * 「地域の一覧を見る」の近道が同じ見た目になるよう、1つにした（2026-11-09）。
 *
 * ## 2026-11-09 判断（owner「見づらい」・本番 390px を実測）
 *
 * 以前は小さな丸いチップ（高さ 34・字 13・地 白7%・縁 白8%・件数 12 の白60%）が折り返して並ぶだけで、
 * 黒地との差が小さく、県の名前と件数の区別も付きにくかった。**グリッドの札**にした:
 * 高さ 48（押せる範囲 44 以上）・名前 15 semibold の白（札の地の上で 17.38:1・実測）・件数 13 の `text-2`（同 8.76:1・実測）を右に寄せる・
 * 地 `surface-3`・縁は白14%（`line-strong`）。名前と件数が縦にそろうので、地方の中を目で追える。
 * 列は `auto-fill`（最小 112）: 390px で 3 列・360px で 2〜3 列・PC で自然に増える（「神奈川県 63」が切れない幅）。
 * 色は既存の部品の色だけ（新しい色は足していない）。
 */
export const AREA_TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 m-0 p-0";

export default function SpotAreaChip({ slug, label, count }: { slug: string; label: string; count: number }) {
    return (
        <Link href={ROUTES.SPOT_AREA(slug)} prefetch={false}
              className="flex items-center justify-between gap-2 rounded-xl bg-surface-3 ring-1 ring-inset ring-line-strong px-3 text-white hover:bg-white/10 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
              style={{ minHeight: "48px" }}>
            <span className="min-w-0 truncate font-semibold" style={{ fontSize: "15px", lineHeight: "20px" }}>{label}</span>
            <span className="shrink-0 tabular-nums text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>{count}</span>
        </Link>
    );
}
