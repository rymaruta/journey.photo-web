"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "../i18n/context";
import { track } from "../../lib/utils/analytics";
import { canInstallAppUA } from "../../lib/utils/appBanner";
import { APP_STORE_URL } from "./AppInstallCard";

/**
 * アプリを入れられる iPhone か（iPhone で iOS 17 以上）。**描いたあとで読む**（静的な HTML と最初の描画は false）。
 * ヘッダーはこれで「アプリ」を出し、並びを詰める（`HeaderNav`）
 */
export function useAppIPhone(): boolean {
    return useSyncExternalStore(
        () => () => {},
        () => canInstallAppUA(navigator.userAgent),
        () => false,
    );
}

/**
 * **ヘッダーの右の「アプリ」**（2026-11-20 owner 判断・札 journey.photo-ios#666）。
 *
 * iPhone なら Safari にも常に出す。上の帯（`AppTopBanner`）や Apple の帯を × で閉じた後も、ここからいつでも App Store へ行ける。
 * 押す回数: 帯を閉じた後 今 フッターの札まで送って1回 → 案 1回（ヘッダーは頁の上に貼り付いている）。
 *
 * 形: 黒いヘッダーの上なので**真鍮の字**（板 05「デザインの箇所は白より真鍮」）。字 13・太字、当たりは 44×44 以上。
 * 線の枠は付けない——電話の幅（375〜402）で枠の分だけロゴ「Journey Photo」が切れる（実測は `HeaderNav` の注記）。
 * iPad・PC・Android と、アプリの入らない iOS 17 未満には出さない（PC にはフッターの札がある）
 */
export default function HeaderAppLink() {
    const { locale } = useLocale();
    const en = locale === "en";
    if (!useAppIPhone()) return null;

    return (
        <a
            href={APP_STORE_URL}
            data-testid="header-app"
            onClick={() => track("app_store_click", { placement: "header" })}
            // 見えている字（アプリ）を読み上げの名前の頭に入れる（WCAG 2.5.3）
            aria-label={en ? "App on the App Store" : "アプリをApp Storeで入手"}
            className="inline-flex shrink-0 items-center justify-center rounded-full px-1 font-semibold text-accent whitespace-nowrap transition-colors hover:text-accent-strong active:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ minHeight: 44, minWidth: 44, fontSize: "13px", lineHeight: "18px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
        >
            <span aria-hidden="true">{en ? "App" : "アプリ"}</span>
        </a>
    );
}
