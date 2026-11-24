"use client";

import { useEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../i18n/context";
import { track } from "../../lib/utils/analytics";
import { readTopBannerClosed, shouldShowAppTopBanner, writeTopBannerClosed } from "../../lib/utils/appBanner";
import { APP_STORE_URL } from "./AppInstallCard";

/** 帯の高さ（px）。Apple の帯に近い 60 */
export const APP_TOP_BANNER_HEIGHT = 60;
/** 見えている帯の高さ（px）を入れる CSS の変数。帯が無いときは置かない（使う側は `var(--app-banner-h, 0px)`） */
export const APP_BANNER_H_VAR = "--app-banner-h";

/**
 * **頁のいちばん上のアプリの帯**（2026-11-20 owner 判断・札 journey.photo-ios#666）。
 * owner「iOSのはできるだけ目立つ位置におきたい。よくある方式にしたい」。
 *
 * iPhone の Safari は Apple の帯（Smart App Banner）が出るので、ここは **Apple の帯が出ない iPhone のブラウザだけ**
 * （Chrome・Firefox・Edge、LINE・Instagram・Facebook・X の中のブラウザなど）。判定は `lib/utils/appBanner.ts`。
 *
 * 形は Apple の帯にそろえる（左から ×・アイコン・名前と一言・「入手」）:
 *  - 地は「案内の帯」（真鍮 8%・`accent-soft`）。ヘッダーの黒と分かれる
 *  - 「入手」は写真の無い面の主ボタン＝真鍮の塗り（`accent-fill`）に墨の字。見た目 36・当たり 44（板の行の中の小ボタン）
 *  - × は 44×44。星の数・評価・ダウンロード数のような、確かめられない数は出さない
 *
 * 出し方:
 *  - **端末は描いたあとで読む**（静的な HTML は全員に同じもの＝最初は何も描かない）。場所を最初から空けない
 *  - 出るときは高さ 0 → 60 で上から滑り込む。動きを減らす設定では動かさない（`motion-reduce`）
 *  - 頁の流れの上に置く（ヘッダーの上・固定しない）。下へ送るとヘッダーだけが上に貼り付く
 *  - × はその訪問の間だけ覚える（sessionStorage・2026-11-20 owner「また見にきた時出した方がいいかな」）
 */
export default function AppTopBanner() {
    const { locale } = useLocale();
    const en = locale === "en";
    const [show, setShow] = useState(false);
    const [entered, setEntered] = useState(false);

    useEffect(() => {
        let session: Storage | undefined;
        try { session = window.sessionStorage; } catch { session = undefined; }
        const standalone =
            (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
            window.matchMedia?.("(display-mode: standalone)").matches === true;
        const visible = shouldShowAppTopBanner({
            userAgent: navigator.userAgent,
            standalone,
            closed: readTopBannerClosed(session),
            maxTouchPoints: navigator.maxTouchPoints ?? 0,
        });
        // マウント時に一度だけ端末を読んで出すかを決める（静的な HTML と食い違わないよう、描いたあとで）
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (visible) setShow(true);
    }, []);

    // 高さ 0 で一度描いてから広げる（そのまま 60 で描くと動きが出ない）
    useEffect(() => {
        if (!show) return;
        const id = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(id);
    }, [show]);

    // **見えている帯の高さを `--app-banner-h` で渡す。** メニューとお知らせの板は `top: var(--header-h)` で固定して
    // 開くので、帯が見えている間はその分ヘッダーが下にあり、板がヘッダー（☰ の閉じる）に重なる。送った分だけ減り、
    // 帯が画面の外に出たら 0（ヘッダーは上に貼り付いている）。開いている間は送りを止めるので値は動かない
    const ref = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (!show) return;
        const root = document.documentElement;
        const update = () => {
            const bottom = ref.current?.getBoundingClientRect().bottom ?? 0;
            root.style.setProperty(APP_BANNER_H_VAR, `${Math.max(0, Math.round(bottom))}px`);
        };
        update();
        const el = ref.current;
        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
        el?.addEventListener("transitionend", update);
        return () => {
            window.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
            el?.removeEventListener("transitionend", update);
            root.style.removeProperty(APP_BANNER_H_VAR);
        };
    }, [show, entered]);

    if (!show) return null;

    const close = () => {
        try { writeTopBannerClosed(window.sessionStorage); } catch { /* 読めない環境は閉じるだけ */ }
        setShow(false);
    };

    return (
        <aside
            ref={ref}
            aria-label={en ? "iPhone app" : "iPhoneアプリのご案内"}
            data-testid="app-top-banner"
            className="overflow-hidden bg-accent-soft transition-[height] duration-300 ease-out motion-reduce:transition-none"
            style={{
                height: entered ? APP_TOP_BANNER_HEIGHT : 0,
                // ヘッダーと同じく、横向きでは地を画面の端まで伸ばす（本文は左右の安全領域を空けている）
                marginLeft: "calc(-1 * env(safe-area-inset-left, 0px))",
                marginRight: "calc(-1 * env(safe-area-inset-right, 0px))",
                paddingLeft: "env(safe-area-inset-left, 0px)",
                paddingRight: "env(safe-area-inset-right, 0px)",
            }}
        >
            <div
                className="mx-auto flex max-w-5xl items-center gap-2 pl-1 pr-4 transition-transform duration-300 ease-out motion-reduce:transition-none"
                style={{ height: APP_TOP_BANNER_HEIGHT, transform: entered ? "translateY(0)" : "translateY(-100%)" }}
            >
                <button
                    type="button"
                    onClick={close}
                    aria-label={en ? "Close" : "閉じる"}
                    data-testid="app-top-banner-close"
                    className="inline-flex shrink-0 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    style={{ width: 44, height: 44, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                    <XMarkIcon aria-hidden="true" style={{ width: 16, height: 16, strokeWidth: 2 }} />
                </button>
                {/* アプリのアイコン（ホーム画面のアイコンと同じ絵）。装飾なので読み上げには渡さない */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon-192.png?v=aperture" alt="" aria-hidden="true" width={40} height={40} decoding="async"
                     className="h-10 w-10 shrink-0 rounded-lg ring-1 ring-line" />
                <div className="ml-1 min-w-0 flex-1">
                    <p className="m-0 truncate font-semibold text-white" style={{ fontSize: "15px", lineHeight: "20px" }}>
                        Journey Photo
                    </p>
                    <p className="m-0 truncate text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }}>
                        {en ? "Take it on your trips" : "旅先でも、アプリで。"}
                    </p>
                </div>
                <a
                    href={APP_STORE_URL}
                    data-testid="app-top-banner-get"
                    onClick={() => track("app_store_click", { placement: "top_banner" })}
                    aria-label={en ? "Get it on the App Store" : "App Storeで入手"}
                    // 見た目 36・当たりは上下 4 ずつ広げて 44（ヘッダーの「登録」と同じ形）
                    className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-accent-fill px-4 font-semibold text-ink transition-opacity before:absolute before:inset-x-0 before:-inset-y-[4px] before:content-[''] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    style={{ minHeight: 36, minWidth: 64, fontSize: "13px", lineHeight: "18px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                    <span aria-hidden="true">{en ? "Get" : "入手"}</span>
                </a>
            </div>
        </aside>
    );
}
