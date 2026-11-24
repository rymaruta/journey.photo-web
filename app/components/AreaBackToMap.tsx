"use client";

// app/components/AreaBackToMap.tsx
//
// **ホームの日本地図から来たときだけ出る「地図に戻る」リンク**（2026-11-09 owner「地図で県に行って戻ったら、また地図に戻る」）。
// ブラウザの戻るでも地図へ帰る（`HomeJapanMap` の `#pref=…` と `mapReturn.ts`）が、頁の中の導線から戻りたい人のため。
//
// 🔴 **サーバーの HTML には何も出さない**（検索から来た人・直接開いた人に出さない・クロールの本文にも載せない）。
// 地図から進んだ直後だけ（`sessionStorage` の覚えの県が、この頁の県と同じとき）、マウントのあとに出る。
// 行き先は `/#pref=<県>`。ホームがその県の一覧を開き、覚えた位置へ寄せる。
// パンくずの「ホーム」は今のまま（先頭へ行く・SEO のリンク）。

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { readMapReturn } from "@/lib/utils/mapReturn";
import { prefHash } from "@/lib/utils/japanMap";

export default function AreaBackToMap({ slug, name }: { slug: string; name: string }) {
    // サーバー（と水和の最初の描画）は false＝何も出さない。ブラウザでだけ覚えを読む
    const show = useSyncExternalStore(() => () => {}, () => readMapReturn()?.pref === slug, () => false);
    if (!show) return null;
    return (
        <div className="mx-auto w-full max-w-5xl lg:max-w-6xl px-4 sm:px-6 md:px-8 pt-3" data-testid="area-back-to-map">
            <Link href={`/${prefHash(slug)}`} prefetch={false} className="inline-flex items-center min-h-[44px] text-[13px] text-text-2 underline underline-offset-4 hover:text-white">
                ‹ ホームの地図に戻る（{name}）
            </Link>
        </div>
    );
}
