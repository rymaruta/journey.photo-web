"use client";

import { useEffect, useSyncExternalStore } from "react";
import { APP_STORE_PAGE_URL as APP_STORE_URL } from "../../lib/utils/seo";
import { TILE_OFF } from "./SaveSpotButton";

/**
 * **「アプリで保存」**（2026-11-18・札 rymaruta/journey.photo-ios#545 の段2「Web に来た人をアプリへつなぐ」）。
 *
 * 観光スポットの頁を iPhone で見ている人だけに出す。押すと、アプリが入っていればアプリのその観光スポットの画面、
 * 入っていなければ App Store の頁。
 *
 * ## しくみ（2026-11-18 判断）
 *
 *  - iOS は `/.well-known/apple-app-site-association`（`public/` にある）に書いた道のリンクを、アプリで開く
 *  - 🔴 **同じドメインの中のリンクは、Safari がアプリで開かない**（Apple の決まり: 今見ているサイトと同じドメインへの
 *    リンクは、利用者がそのまま Safari で見たいと見なす）。だから **もう一方のホスト**へリンクする
 *    （journey-photo.com を見ていれば www.journey-photo.com、www を見ていれば journey-photo.com）。
 *    どちらも同じ CloudFront から同じ頁と同じ AASA が出る（2026-11-18 に curl で確かめた）
 *  - アプリが入っていない人には、そのリンクがそのまま Safari で開く。頁は `?app=save` を見て App Store へ移す
 *    （`useAppFallback`）。`location.replace` なので、戻ると元の頁
 *  - 本番のホストでないとき（staging・手元）は、もう一方のホストが無いので App Store へ直に
 *
 * 押す回数（アプリの人が Web からこの観光スポットを「行きたい」に入れるまで）:
 * 今 4回以上（スマートバナーの「開く」→ アプリのホーム → 探して開く → 行きたい）→ 案 2回（これ → 行きたい）
 *
 * 形はスポットの行動の札（`TILE_OFF`・白 7% の地に白い字・角 12）を、印と字を横に並べた1行（高さ 48）にしたもの。真鍮は使わない
 * （主ボタンは「行きたい」。こちらは添え）
 */
export const APP_PARAM = "app";
export const APP_PARAM_SAVE = "save";

const PROD_HOSTS: Record<string, string> = {
    "journey-photo.com": "www.journey-photo.com",
    "www.journey-photo.com": "journey-photo.com",
};

/** 押した先。もう一方の本番のホストの同じ頁に `?app=save`。本番でなければ App Store */
export function appOpenHref(host: string, slug: string): string {
    const other = PROD_HOSTS[host];
    if (!other) return APP_STORE_URL;
    return `https://${other}/spots/${encodeURIComponent(slug)}?${APP_PARAM}=${APP_PARAM_SAVE}`;
}

/** iPhone（と iPod）か。アプリは iPhone 用（iPad・Mac・Android には出さない＝「スマホで見ている人」） */
export function isIPhone(ua: string): boolean {
    return /iPhone|iPod/.test(ua);
}

/**
 * アプリが入っていなくて、`?app=save` のリンクが Safari で開いたとき、App Store へ移す。
 * iPhone でなければ移さず、印だけ URL から消す（共有などで渡った人を App Store へ飛ばさない）
 */
export function useAppFallback() {
    useEffect(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.get(APP_PARAM) !== APP_PARAM_SAVE) return;
        if (isIPhone(navigator.userAgent)) {
            window.location.replace(APP_STORE_URL);
            return;
        }
        url.searchParams.delete(APP_PARAM);
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }, []);
}

export default function OpenInAppButton({ slug, isJa }: { slug: string; isJa: boolean }) {
    useAppFallback();
    // 端末とホストは水和のあとで読む（静的な HTML は全員に同じものを出す＝出すまで何も描かない）
    const href = useSyncExternalStore(
        () => () => {},
        () => (isIPhone(navigator.userAgent) ? appOpenHref(window.location.hostname, slug) : ""),
        () => "",
    );
    if (!href) return null;

    return (
        <a
            href={href}
            data-testid="open-in-app"
            className={`mt-2.5 flex w-full max-w-xl items-center justify-center gap-2 rounded-xl px-3 font-semibold ${TILE_OFF} focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent active:scale-95 transition`}
            style={{ minHeight: 48, touchAction: "manipulation" }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-aperture.png" alt="" aria-hidden="true" width={20} height={20} className="h-5 w-5 shrink-0 rounded-[5px] object-contain" />
            <span className="whitespace-nowrap text-[15px] leading-5">{isJa ? "アプリで保存" : "Save in the app"}</span>
        </a>
    );
}
