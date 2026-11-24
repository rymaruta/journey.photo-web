"use client";

import { useEffect } from "react";
import Script from "next/script";
import { siteConfig } from "../../lib/utils/seo";
import { gaInitSnippet } from "../../lib/utils/analytics";
import { recordLanding } from "../../lib/utils/landingType";

/**
 * アクセス解析タグ。設定されている時だけ出力する（未設定なら null＝完全に無害）。
 * 優先: Plausible（Cookieless）→ GA4。値はすべて公開情報。
 */
export default function Analytics() {
    const { gaId, plausibleDomain } = siteConfig;

    // そのセッションで最初に着地した頁の種類を控える（`landing_type`・2026-11-04）。
    // GA4 のタグが出る環境だけ。語1つだけを `sessionStorage` に書く（Cookie ではない）
    useEffect(() => {
        if (gaId && !plausibleDomain) recordLanding();
    }, [gaId, plausibleDomain]);

    if (plausibleDomain) {
        return (
            <Script
                defer
                data-domain={plausibleDomain}
                src="https://plausible.io/js/script.js"
                strategy="afterInteractive"
            />
        );
    }

    // **GA4 は `lazyOnload`（2026-10-28）。** `afterInteractive` の外部スクリプトは
    // Next が `<head>` に `<link rel="preload" as="script">` を出すので、gtag.js
    // （本番の ID で gzip 約 175KB）が**最初の描画・代表写真と同じ時期に**回線を
    // 取り合っていた（PageSpeed Insights・スマホで指摘）。`lazyOnload` は先読みを出さず、
    // ページの `load` のあと手が空いたときに読む。
    // 代償: `load` より前に離れた人のページビューは数えられない（測り方が変わる）
    if (gaId) {
        return (
            <>
                <Script
                    src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
                    strategy="lazyOnload"
                />
                {/* 初期化の行は、読み込み前に積んだイベント（行きたい・登録）も送る
                    （`lib/utils/analytics.ts` の `track`・2026-10-31 #432） */}
                <Script id="ga4-init" strategy="lazyOnload">
                    {gaInitSnippet(gaId)}
                </Script>
            </>
        );
    }

    return null;
}
