"use client";

import React from "react";
import { useSearchParams } from "next/navigation";

/**
 * 私的なリンクの合図（`/j?t=`・`/qr?t=`）を受け取り、**開いたらすぐ URL から外す**
 * （2026-11-12 確かめ役の指摘・札 journey.photo-ios#545）。
 *
 * 合図は推測できないことだけが守り。URL に残すと、GA4 の頁の記録・履歴・画面の共有に合図が載る。
 * - 合図は最初の描画で読んで state に持つ。Next は `history.replaceState` を `useSearchParams` に映すので、
 *   外したあとに読み直すと空になる（state に持たないと「使えません」になる）
 * - 外すのは `history.replaceState`（履歴を積まない・Next の `history.state` は引き継ぐ。`SpotGuideClient` と同じ）
 */
export function usePrivateLinkToken(param = "t"): string {
    const first = useSearchParams().get(param) ?? "";
    const [token] = React.useState(first);

    React.useEffect(() => {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (!url.searchParams.has(param)) return;
        url.searchParams.delete(param);
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }, [param]);

    return token;
}
