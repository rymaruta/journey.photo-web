"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon, MapPinIcon, CalendarIcon, ChatBubbleLeftIcon } from "@heroicons/react/24/outline";
import type { Photo, Locale } from "@/lib/data/photos";
import { useAuth } from "../auth/context";
import Thumb from "./Thumb";
import SignUpLoginLinks from "./SignUpLoginLinks";
import {
    SIGNUP_BENEFITS, SIGNUP_BENEFITS_HEADING, signupBenefitsSignupHref, showsSignupBenefits, type SignUpBenefitId,
} from "@/lib/auth/signupBenefits";

const ICONS: Record<SignUpBenefitId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
    post: PlusIcon,
    wantToGo: MapPinIcon,
    tripPlan: CalendarIcon,
    message: ChatBubbleLeftIcon,
};

/**
 * **登録するとできること**の控えめな案内（札 journey.photo-ios#618 の案1・2026-11-15 判断で案C・`lib/auth/signupBenefits.ts`）。
 *
 * ログインしていない人にだけ出す（確かめ中は出さない）。形は案の模型の札（`.can`、`.cc`、`.cp`）と iOS のホームの段
 * （`HomeSignUpBenefitsView`）にそろえる: 真鍮の眉ラベル → 札4枚（地 surface、縁 白8%、角 14、内側 8。絵は写真の地に白い印）
 * → 線のボタン「新規登録」と文字の「ログイン」。スマホは2列、広い画面は4列。
 *
 * 押した先は今の登録の頁とログインの頁のまま（owner「アカウント登録画面は何も変えたくない」）。
 * 札は飾りではなく登録の頁へのリンク（押す回数 1回）。写真の上の印は白、真鍮は黒地の上の眉ラベルだけ。押せるものは 44px 以上。
 */
export default function SignUpBenefits({ locale, photos = [], className = "" }: {
    locale: Locale;
    /** 札の絵の地に敷く写真（読めなければ地の色のまま） */
    photos?: ReadonlyArray<Photo>;
    className?: string;
}) {
    const auth = useAuth();
    const pathname = usePathname();
    if (!showsSignupBenefits(auth)) return null;
    const isJa = locale !== "en";
    const signupHref = signupBenefitsSignupHref(pathname);
    const headingId = "signup-benefits-heading";
    return (
        <section aria-labelledby={headingId} data-testid="signup-benefits"
                 className={`flex flex-col gap-3 ${className}`}>
            <h2 id={headingId} className="m-0 eyebrow text-accent">
                {isJa ? SIGNUP_BENEFITS_HEADING.ja : SIGNUP_BENEFITS_HEADING.en}
            </h2>
            <ul className="m-0 p-0 grid grid-cols-2 sm:grid-cols-4 gap-2" style={{ listStyle: "none" }}>
                {SIGNUP_BENEFITS.map((b, i) => {
                    const Icon = ICONS[b.id];
                    const photo = photos[i];
                    return (
                        <li key={b.id} className="m-0 p-0">
                            <Link href={signupHref} prefetch={false} data-testid={`signup-benefit-${b.id}`}
                                  className="flex flex-col gap-2 p-2 rounded-xl bg-surface border border-line text-white no-underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                                  style={{ minHeight: 44, touchAction: "manipulation" }}>
                                <span aria-hidden="true" className="relative block overflow-hidden rounded-lg bg-surface-3" style={{ height: 58 }}>
                                    {photo && <Thumb photo={photo} alt="" sizes="(max-width:640px) 45vw, 220px" />}
                                    <span className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
                                        <Icon className="text-white" style={{ width: 26, height: 26 }} strokeWidth={1.8} />
                                    </span>
                                </span>
                                <span className="font-semibold" style={{ fontSize: "13px", lineHeight: 1.3 }}>
                                    {isJa ? b.ja : b.en}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
            {/* 下の2つは、ほかのログインのお願いと同じ部品（`SignUpLoginLinks`、札 journey.photo-ios#630） */}
            <SignUpLoginLinks locale={locale} next={pathname} testIdPrefix="signup-benefits" />
        </section>
    );
}
