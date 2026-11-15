"use client";

import React from "react";
import Link from "next/link";
import {
    SIGNUP_BENEFITS_SIGNUP, SIGNUP_BENEFITS_LOGIN, signupBenefitsSignupHref, signupBenefitsLoginHref,
} from "@/lib/auth/signupBenefits";

/**
 * **ログインのお願いに並べる「新規登録」と「ログイン」**（札 journey.photo-ios#630、2026-11-15）。
 *
 * owner「ログインのお願いあるけど、会員登録してない人には有効ではないので、会員登録もそこに出したい」。
 * 「ログインしてください」と頼む所（空の頁、コメントの欄、フォロー中の並び、払う画面の札）に、この2つを並べる。
 * 押した先は今の登録の頁とログインの頁のまま（頁そのものは変えない）。どちらも押す回数 1回。
 *
 * **2026-11-15 判断: 新規登録を主にする。** 本番の会員は約7人（Cognito の見積もり）で、
 * お願いを見る人の多くはまだ登録していない。ログインは隣の文字のリンク（「登録するとできること」と同じ形）。
 * - `outline`: 写真のある画面（線のボタン。「登録するとできること」の段と同じ）
 * - `fill`: 写真の無い画面（主ボタンは真鍮の塗りに墨。デザインの板の決まり）
 *
 * 言葉は `lib/auth/signupBenefits.ts` と iOS の `SignInPrompt.signUpLabel` / `loginLabel` と同じ。
 */
export default function SignUpLoginLinks({ locale, next, via, variant = "outline", testIdPrefix = "signin-ask", className = "" }: {
    locale: string;
    /** 登録やログインのあとに戻る頁（サイト内のパスだけ通す） */
    next?: string | null;
    via?: Parameters<typeof signupBenefitsSignupHref>[1];
    variant?: "outline" | "fill";
    testIdPrefix?: string;
    className?: string;
}) {
    const isJa = locale !== "en";
    const primary = variant === "fill"
        ? "bg-accent-fill text-ink hover:brightness-110"
        : "border border-line-strong text-white";
    return (
        <div className={`flex items-center gap-4 ${className}`}>
            <Link href={signupBenefitsSignupHref(next, via)} prefetch={false} data-testid={`${testIdPrefix}-signup`}
                  className={`inline-flex items-center justify-center px-5 rounded-full font-semibold no-underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${primary}`}
                  style={{ minHeight: 44, fontSize: "15px", touchAction: "manipulation" }}>
                {isJa ? SIGNUP_BENEFITS_SIGNUP.ja : SIGNUP_BENEFITS_SIGNUP.en}
            </Link>
            <Link href={signupBenefitsLoginHref(next, via)} prefetch={false} data-testid={`${testIdPrefix}-login`}
                  className="inline-flex items-center justify-center text-text-2 no-underline hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ minHeight: 44, minWidth: 44, fontSize: "13px", touchAction: "manipulation" }}>
                {isJa ? SIGNUP_BENEFITS_LOGIN.ja : SIGNUP_BENEFITS_LOGIN.en}
            </Link>
        </div>
    );
}
