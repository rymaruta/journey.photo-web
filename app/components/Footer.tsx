"use client";

import Link from "next/link";
import { useSyncExternalStore, useState } from "react";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";

export default function Footer() {
    const { locale, labels } = useLocale();
    const navLabels = labels.navigation || {};
    // SSRと初回描画を揃え、hydration後に端末情報を読む。
    const isIOS = useSyncExternalStore(
        () => () => {},
        () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
        () => false,
    );
    const [dismissed, setDismissed] = useState(false);
    const previouslyDismissed = useSyncExternalStore(
        () => () => {},
        () => { try { return sessionStorage.getItem("jp-ios-app-cta-dismissed") === "1"; } catch { return false; } },
        () => false,
    );
    const appStoreUrl = "https://apps.apple.com/jp/app/id6814335283";

    const links = [
        { href: ROUTES.HOME, label: navLabels.works || (locale === "en" ? "Works" : "作品") },
        { href: ROUTES.MAP, label: navLabels.map || (locale === "en" ? "Map" : "撮影地マップ") },
        { href: ROUTES.SPOTS, label: locale === "en" ? "Photo spots" : "撮影スポット" },
        { href: ROUTES.FAVORITES, label: navLabels.favorites || (locale === "en" ? "Liked Photos" : "いいねした写真") },
        { href: ROUTES.SAVES, label: navLabels.saves || (locale === "en" ? "Saved Photos" : "保存した写真") },
        { href: ROUTES.SAVED_SPOTS, label: locale === "en" ? "Want to go" : "行きたい場所" },
        { href: ROUTES.TERMS, label: locale === "en" ? "Terms" : "利用規約" },
        { href: ROUTES.PRIVACY, label: locale === "en" ? "Privacy" : "プライバシーポリシー" },
    ];

    return (
        <footer className="border-t border-line bg-bg" style={{ paddingBottom: "var(--page-bar-h, 0px)" }}>
            <div className="mx-auto max-w-5xl px-6 py-10 md:px-8 md:py-12">
                <div className="flex flex-col items-center gap-6 text-center">
                    <div className="flex flex-col items-center gap-3">
                        <p className="inline-flex items-center gap-3 text-[22px] font-semibold tracking-wide text-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/logo-aperture.png" alt="" aria-hidden="true" width={24} height={24} loading="lazy" className="h-6 w-6 shrink-0 object-contain" />
                            Journey Photo
                        </p>
                        <p className="text-[15px] leading-[22px] text-text-2">
                            {locale === "en" ? "Moments that move someone's next journey." : "旅の一瞬を、誰かの次の旅へ。"}
                        </p>
                    </div>

                    {isIOS && !dismissed && !previouslyDismissed && (
                        <section aria-label="iOSアプリのご案内" className="relative w-full max-w-[520px] rounded-2xl border border-line bg-white/[0.04] px-5 py-5 text-left">
                            <button
                                type="button"
                                aria-label="アプリのご案内を閉じる"
                                onClick={() => {
                                    setDismissed(true);
                                    try { sessionStorage.setItem("jp-ios-app-cta-dismissed", "1"); } catch { /* storage unavailable */ }
                                }}
                                className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-text-2 hover:text-white"
                            >
                                <span aria-hidden="true">×</span>
                            </button>
                            <div className="flex items-center gap-3 pr-10">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="/logo-aperture.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl object-contain" loading="lazy" />
                                <div>
                                    <p className="text-[16px] font-semibold text-white">Journey Photoをアプリでも</p>
                                    <p className="mt-1 text-[13px] leading-5 text-text-2">旅の写真を見つけて、保存して、次の旅へ。</p>
                                </div>
                            </div>
                            <a href={appStoreUrl} target="_blank" rel="noopener noreferrer"
                               className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-[14px] font-semibold text-black transition-opacity hover:opacity-90">
                                App Storeで入手
                            </a>
                        </section>
                    )}

                    <nav
                        aria-label={locale === "en" ? "Footer" : "フッター"}
                        className="grid w-full max-w-[640px] grid-cols-2 gap-x-5 sm:grid-cols-4 sm:gap-x-6"
                    >
                        {links.map(({ href, label }) => (
                            <Link
                                key={href}
                                href={href}
                                prefetch={false}
                                className="inline-flex min-h-[44px] items-center justify-center px-1 text-text-2 transition-colors hover:text-accent"
                                style={{ fontSize: "13px", lineHeight: "18px", touchAction: "manipulation" }}
                            >
                                {label}
                            </Link>
                        ))}
                    </nav>

                    <a href={appStoreUrl} target="_blank" rel="noopener noreferrer"
                       className="inline-flex min-h-[44px] items-center justify-center text-[13px] text-text-2 underline underline-offset-4 transition-colors hover:text-white">
                        iOSアプリをApp Storeで入手
                    </a>
                    <p className="text-[13px] leading-[18px] text-text-3">© Journey Photo</p>
                </div>
            </div>
        </footer>
    );
}
