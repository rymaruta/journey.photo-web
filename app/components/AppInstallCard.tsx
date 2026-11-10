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
export default function AppInstallCard({ placement, className = "", compact = false }: {
    placement: AppStorePlacement;
    className?: string;
    /**
     * **スマホで小さくする**（2026-11-09 owner 承認・9人のレビュー: ホームの最初の画面でこの札が約190px を占め、
     * 価値の一文より先に出ていた）。電話の幅は「アイコン 40・文・ボタン」の1行（実測の高さ: 320・360px=128 / 375・390px=104 / 430px=88。320・360px は題が2行に折れる。従来は約190。ボタンは「入手」・読み上げは
     * 「App Storeで入手」のまま）。**md 以上は今までの大きさ**（PC の見た目は変えない）。ホームと、フッター（2026-11-10 札 #515）が使う
     */
    compact?: boolean;
}) {
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
            className={`rounded-2xl bg-accent-soft ring-1 ring-line ${compact ? "p-3" : "p-5"} md:p-6 text-left ${className}`}
        >
            <div className={compact ? "flex flex-row items-center gap-3 md:gap-6" : "flex flex-col gap-4 md:flex-row md:items-center md:gap-6"}>
                <div className={compact ? "flex min-w-0 flex-1 items-center gap-3 md:gap-4" : "flex items-center gap-4 md:flex-1"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-aperture.png" alt="" aria-hidden="true" width={56} height={56} loading="lazy" decoding="async"
                         className={`${compact ? "h-10 w-10 md:h-14 md:w-14" : "h-14 w-14"} shrink-0 rounded-xl object-contain`} />
                    <div className="min-w-0">
                        <p className="m-0 text-accent" style={{ fontSize: "11px", lineHeight: "16px", letterSpacing: "0.08em" }}>
                            {en ? "iOS APP" : "iOSアプリ"}
                        </p>
                        <p className={`m-0 mt-1 font-serif font-bold text-white ${compact ? "text-[18px] leading-6 md:text-[20px] md:leading-7" : ""}`}
                           style={compact ? undefined : { fontSize: "20px", lineHeight: "28px" }}>
                            {en ? "Take it on your trips" : "旅先でも、アプリで。"}
                        </p>
                        <p className={`m-0 mt-1 text-text-2 ${compact ? "text-[12px] leading-4 md:text-[13px] md:leading-5" : ""}`}
                           style={{ ...(compact ? {} : { fontSize: "13px", lineHeight: "20px" }), lineBreak: "strict", textWrap: "pretty" }}>
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
                    aria-label={compact ? (en ? "Get it on the App Store" : "App Storeで入手") : undefined}
                    className={`inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent-fill py-3 font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:w-auto md:shrink-0 md:px-6 ${compact ? "shrink-0 px-4" : "w-full px-6"}`}
                    style={{ fontSize: "15px", lineHeight: "20px", touchAction: "manipulation" }}
                >
                    {compact ? (
                        <>
                            <span className="md:hidden" aria-hidden="true">{en ? "Get" : "入手"}</span>
                            <span className="hidden md:inline" aria-hidden="true">{en ? "Get it on the App Store" : "App Storeで入手"}</span>
                        </>
                    ) : (en ? "Get it on the App Store" : "App Storeで入手")}
                </a>
            </div>
        </section>
    );
}
