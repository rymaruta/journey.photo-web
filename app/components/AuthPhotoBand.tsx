"use client";

import React from "react";
import publishedPhotos from "../data/photos.json";
import { publicImageUrl } from "../../lib/utils/seo";

/**
 * **ログイン・登録の上の写真の帯とワードマーク**（iOS `SignInView.tileHeader`・`brand`・板 SignIn・2026-11-04）。
 * iOS はログインと登録が同じ画面の切り替えなので、Web の2つの頁も同じ部品で同じ形にする。
 *
 *     帯         高さ 380・4列×3段の公開写真を -4° 傾け、左右に 20 はみ出し上へ 30。上 20% → 40% で 40% → 92% で黒
 *     本文の頭   帯の上から 250（`pt-[250px]`・帯に 130 食い込む）
 *     ワードマーク マーク 30＋明朝 Bold 40・字間 -0.025em → 10 → 一文（明朝 18・白72%）
 */

// 公開写真のみを使い、レンダーのたびに全件走査しない
const bandPhotos = publishedPhotos.filter((photo) => photo.published && photo.src && (!("sensitive" in photo) || photo.sensitive !== true)).slice(0, 12);

export function AuthPhotoBand() {
    // 飾りなので読み上げない
    return (
            <div aria-hidden="true" data-testid="login-photo-collage"
                 className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[380px] overflow-hidden">
                <div className="absolute -inset-x-5 -top-[30px] grid grid-cols-4 gap-[3px]"
                     style={{ transform: "rotate(-4deg)" }}>
                    {bandPhotos.map((photo, index) => (
                        <div key={photo.id} className="aspect-square min-w-0 overflow-hidden bg-surface">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={publicImageUrl(photo.thumbSrc || photo.src)} alt="" loading={index < 4 ? "eager" : "lazy"}
                                 fetchPriority={index === 0 ? "high" : "low"} decoding="async"
                                 className="h-full w-full object-cover" />
                        </div>
                    ))}
                </div>
                {/* iOS: 上 20% → 40% で 40% → 92% で黒 */}
                <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgb(0 0 0 / 0.2) 0%, rgb(0 0 0 / 0.4) 40%, #000 92%)" }} />
            </div>

    );
}

export function AuthBrand() {
    // iOS `AppLogo(.hero)`・`Labels.Brand.tagline`
    return (
                <div className="flex flex-col gap-[10px] pb-3" data-testid="login-wordmark">
                    <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/logo-aperture.png" alt="" width={30} height={30} className="h-[30px] w-[30px] object-contain" />
                        <p className="m-0 font-serif font-bold text-white whitespace-nowrap" style={{ fontSize: "40px", lineHeight: 1.15, letterSpacing: "-0.025em" }}>Journey Photo</p>
                    </div>
                    <p className="m-0 font-serif text-white/70" style={{ fontSize: "18px", lineHeight: 1.4 }}>写真から、次の旅が始まる。</p>
                </div>

    );
}
