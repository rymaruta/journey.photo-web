"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CameraIcon, ShieldCheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import { needsLegalConsent, acceptLegalConsent, LEGAL_CONSENT_KEY } from "../../lib/utils/legalConsent";
import { ROUTES } from "../../lib/routes";
import { BTN_FILL } from "./buttonStyles";

/**
 * **「はじめる前に」**（iOS の `LegalGateView` と同じ文言・同じ3項目）。
 *
 * ログインした人に、同意の記録（`lib/utils/legalConsent.ts`）が無ければ一度だけ出す。
 * 見るだけの人には出さない（Web はログインしなくても写真を見られる）。
 *
 * **閉じる手段は「同意してはじめる」だけ**（iOS と同じ）。Escape・背景では閉じない。
 * 規約とプライバシーポリシーのページでは出さない——覆うと読めない。
 */
/** 別のタブで同意したら、こちらも閉じる（`storage` は他のタブの書き込みでだけ飛ぶ） */
function subscribeConsent(onChange: () => void): () => void {
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === LEGAL_CONSENT_KEY) onChange(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
}

export default function LegalGate() {
    const { isAuthenticated, loading } = useAuth();
    const { locale } = useLocale();
    const pathname = usePathname();
    const isJa = locale !== "en";
    /** この画面で同意を押した（記録が書けない端末でも閉じるため、画面側でも覚える） */
    const [agreed, setAgreed] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // 記録は端末にしか無いので、**サーバーの HTML と水和の最初の描画では「要らない」**
    // （第3引数）。水和のあとに端末の記録を読む（effect で state に写すと、
    // 描画がもう1回余計に走る——lint の react-hooks/set-state-in-effect）
    const unconsented = useSyncExternalStore(subscribeConsent, () => needsLegalConsent(), () => false);
    const needs = !agreed && !loading && isAuthenticated && unconsented;

    const path = (pathname ?? "").replace(/\/+$/, "");
    const exempt = path === ROUTES.TERMS || path === ROUTES.PRIVACY;
    const open = needs && !exempt;

    // **優先度 1**: 裏で後から開くもの（共有リンクの拡大表示）に Tab を奪わせない
    useFocusTrap(open, panelRef, undefined, undefined, 1);
    useEffect(() => {
        if (!open) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [open]);

    if (!open) return null;

    const agree = () => {
        // 書けなくても閉じる（出られなくなるとサイトが使えない）。次に開いたときにまた出る
        acceptLegalConsent();
        setAgreed(true);
    };

    const items = [
        {
            Icon: CameraIcon,
            ja: "旅の写真を投稿して共有できます。",
            en: "Post and share photos from your travels.",
        },
        {
            Icon: ShieldCheckIcon,
            // 2026-11-25（App Store の審査 1.2・journey.photo-ios#604）: iOS の `LegalGateText.zeroTolerance` と同じ中身
            ja: "不適切な投稿や、ほかの人へのいやがらせは一切許しません。違反した投稿は削除し、投稿した人の利用を止めます。見つけたら、写真やコメント、プロフィールから通報やブロックができます。",
            en: "We have zero tolerance for objectionable content and abusive users. Posts that break these rules are removed, and the people who posted them are banned. You can report or block from any photo, comment or profile.",
        },
        {
            Icon: LockClosedIcon,
            ja: "撮影情報（EXIF）は端末で取り除いてから送ります。撮影地は約1kmに丸めて保存します。",
            en: "Photo metadata (EXIF) is removed on your device before upload. Locations are stored rounded to about 1 km.",
        },
    ];

    // **z はトースト（z-[100]）の下・ストーリーの下書き（z-[95]）の上。** 上に置くと、
    // ログイン直後のトーストが同意画面の裏に出て消える
    return (
        <div className="fixed inset-0 z-[96] bg-bg overflow-y-auto overscroll-contain pad-safe">
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="legal-gate-title"
                className="mx-auto flex min-h-full max-w-md flex-col px-6 pt-12 pb-8"
            >
                <p className="eyebrow text-accent">
                    {/* iOS も日本語の画面でこの英字の眉を出す（LegalGateView） */}
                    Before you start
                </p>
                <h2 id="legal-gate-title" className="mt-2 text-2xl font-bold text-white">
                    {isJa ? "はじめる前に" : "Before you start"}
                </h2>

                <ul className="mt-8 space-y-5">
                    {items.map(({ Icon, ja, en }) => (
                        <li key={ja} className="flex gap-3 text-sm leading-relaxed text-white/85">
                            <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" aria-hidden="true" />
                            <span>{isJa ? ja : en}</span>
                        </li>
                    ))}
                </ul>

                <div className="mt-auto pt-10">
                    <p className="flex gap-5 text-sm">
                        <Link href={ROUTES.TERMS} prefetch={false} className="text-accent underline underline-offset-4 hover:text-accent-strong">
                            {isJa ? "利用規約" : "Terms of Service"}
                        </Link>
                        <Link href={ROUTES.PRIVACY} prefetch={false} className="text-accent underline underline-offset-4 hover:text-accent-strong">
                            {isJa ? "プライバシーポリシー" : "Privacy Policy"}
                        </Link>
                    </p>
                    <button
                        type="button"
                        onClick={agree}
                        className={`${BTN_FILL} mt-5 w-full bg-accent-fill text-ink hover:brightness-110 active:scale-[0.98] transition`}
                        style={{ touchAction: "manipulation" }}
                    >
                        {isJa ? "利用規約に同意してはじめる" : "Agree to the Terms and continue"}
                    </button>
                </div>
            </div>
        </div>
    );
}
