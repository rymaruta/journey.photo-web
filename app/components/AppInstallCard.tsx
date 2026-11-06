"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "../i18n/context";
import { track, type AppStorePlacement } from "../../lib/utils/analytics";

export const APP_STORE_URL = "https://apps.apple.com/jp/app/id6814335283";

/**
 * **iOS アプリのご案内の札**（2026-11-06 owner「アプリのインストール推奨は目立つところに置きたい。
 * デザインも変えられるならこのサイトにあったのにしたい」）。
 *
 * 以前はフッターの一番下の文字リンク1つと、iOS の端末だけに出る小さな白いカードだった。
 * ホーム・記事の終わり・フッターの先頭に、同じ札を置く（`placement` だけが違う・計測も分ける）。
 *
 * 形はこのサイトの札の決まりに合わせる:
 *  - 面は「案内の帯」の色（真鍮 8%・`accent-soft`）に白 8% の縁・角 16（ホームの上段の札と同じ）
 *  - 眉ラベルは真鍮・題は明朝・副文は text-2
 *  - ボタンは「写真の無い画面の主ボタン」＝真鍮の塗り（`accent-fill`）に墨の字（白は 2.81:1 で不可）
 *  - **左揃え。** 電話の幅は「アイコン＋文」の下にボタン（左端をそろえる）、PC の幅は右端にボタン
 *
 * 出さない相手: Android（アプリが無い）。端末は水和のあとで読む（静的な HTML は全員に同じものを出す）。
 * iPhone・iPad・Mac・PC には出す（Mac や PC からでも App Store の頁へ行けて、iPhone に送れる）
 */
export default function AppInstallCard({ placement, className = "" }: { placement: AppStorePlacement; className?: string }) {
    const { locale } = useLocale();
    const en = locale === "en";
    const isAndroid = useSyncExternalStore(
        () => () => {},
        () => /Android/i.test(navigator.userAgent),
        () => false,
    );
    if (isAndroid) return null;

    return (
        <section
            aria-label={en ? "iOS app" : "iOSアプリのご案内"}
            data-testid="app-install-card"
            data-placement={placement}
            className={`rounded-2xl bg-accent-soft ring-1 ring-line p-5 md:p-6 text-left ${className}`}
        >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                <div className="flex items-center gap-4 md:flex-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-aperture.png" alt="" aria-hidden="true" width={56} height={56} loading="lazy" decoding="async"
                         className="h-14 w-14 shrink-0 rounded-xl object-contain" />
                    <div className="min-w-0">
                        <p className="m-0 text-accent" style={{ fontSize: "11px", lineHeight: "16px", letterSpacing: "0.08em" }}>
                            {en ? "iOS APP" : "iOSアプリ"}
                        </p>
                        <p className="m-0 mt-1 font-serif font-bold text-white" style={{ fontSize: "20px", lineHeight: "28px" }}>
                            {en ? "Take it on your trips" : "旅先でも、アプリで。"}
                        </p>
                        <p className="m-0 mt-1 text-text-2" style={{ fontSize: "13px", lineHeight: "20px", lineBreak: "strict", textWrap: "pretty" }}>
                            {en
                                ? "Save places you want to go and browse the photo-spot map."
                                // 文節ごとにまとめて、折り返しが読点の後ろに来るようにする（「地図。」だけが次の行に落ちない）
                                : <><span className="inline-block">行きたい場所の保存と、</span><span className="inline-block">撮影スポットの地図。</span></>}
                        </p>
                    </div>
                </div>
                <a
                    href={APP_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track("app_store_click", { placement })}
                    className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-accent-fill px-6 py-3 font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:w-auto md:shrink-0"
                    style={{ fontSize: "15px", lineHeight: "20px", touchAction: "manipulation" }}
                >
                    {en ? "Get it on the App Store" : "App Storeで入手"}
                </a>
            </div>
        </section>
    );
}
