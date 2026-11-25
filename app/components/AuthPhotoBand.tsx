"use client";

import React from "react";
import PHOTOS_JSON from "../data/photos.json";
import type { Photo } from "../../lib/data/photos";
import { publicImageUrl } from "../../lib/utils/seo";

/**
 * **ログイン・登録の上の写真の帯とワードマーク**（iOS `SignInView.tileHeader`・`brand`・板 SignIn・2026-11-04）。
 * iOS はログインと登録が同じ画面の切り替えなので、Web の2つの頁も同じ部品で同じ形にする。
 *
 *     帯         高さ 235・4列×3段の公開写真を -4° 傾け、左右に 20 はみ出し上へ 30。溶けは iOS `SignInLayout.fadeStops`
 *                （上 10% → 50% で 22% → 82% で 62% → 下端で黒。写真が下まで見える）
 *     本文の頭   帯の上から 142（`pt-[142px]`）。ロゴと一文が帯の下端の 16 上で終わり、欄は帯のすぐ下から
 *
 * 2026-11-25 owner「Web のログインのロゴがアプリと比べて小さい」: iOS の 390×844（Apple と Google のボタンあり）と
 * 同じ見え方にそろえた。iOS は写真の段が「見せられる高さ − 欄の段」で、ロゴはその下端から 16 上（`headBottom`）。
 * 390×844 では写真の段が安全域の上から約 299、ロゴの上端が約 205。Web は上にサイトの見出し（64）があるので、
 * 帯を 299 − 64 = 235、ロゴの上端を 205 − 64 ≈ 142 にして、画面の上からの位置を iOS と同じにした
 *     ワードマーク マーク 30＋明朝 Bold 40・字間 -0.025em → 10 → 一文（明朝 18・白72%）
 */

// 公開写真のみを使い、レンダーのたびに全件走査しない。
// **型は Photo[] と名指しする**（2026-11-24・journey.photo-ios#717）: staging は写真が0件のことがあり、`photos.json` が `[]` だと
// 読み込んだ型が `never[]` になって `photo.published` で next build が落ちた（他の所の `PHOTOS_JSON as Photo[]` と同じ）
const publishedPhotos = PHOTOS_JSON as Photo[];
const bandPhotos = publishedPhotos.filter((photo) => photo.published && photo.src && (!("sensitive" in photo) || photo.sensitive !== true)).slice(0, 12);

export function AuthPhotoBand() {
    // 飾りなので読み上げない
    return (
            <div aria-hidden="true" data-testid="login-photo-collage"
                 className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[235px] overflow-hidden">
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
                {/* iOS `SignInLayout.fadeStops`（2026-11-24 owner「写真の下の方がフェードアウトしていて少し悲しい」） */}
                <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgb(0 0 0 / 0.10) 0%, rgb(0 0 0 / 0.22) 50%, rgb(0 0 0 / 0.62) 82%, #000 100%)" }} />
            </div>

    );
}

/**
 * ログインと登録の頁のロゴの寸法。**ここ1か所で決める**（iOS の担当が寸法を決めたら、ここの数だけを替える）。
 *
 * 2026-11-25 owner「Web のログインのロゴがアプリと比べて小さい」「印が字に比べて小さい」
 * 「タイトルとかも小さいし、サブタイトルも消えるの嫌だ」。
 * - 字は iOS と同じ serif の太字（`font-wordmark`＝iPhone では New York）。明朝の英字は細く狭く、同じ 40 でも小さく見えていた
 * - 字は最大 44（前は 40）。横に入らない幅では、横いっぱいに収まる大きさまで縮める（2行に割らない・横に送らない）
 * - 印の直径は字の大きさ × `markRatio`（前は 29.5／40＝0.74。仮に 0.9）
 * - 一文（副題）は**どの幅でも出す**（消さない）
 */
export const AUTH_BRAND = {
    /** 字の大きさの上限（px） */
    wordmarkMax: 44,
    /** 印の直径 ÷ 字の大きさ */
    markRatio: 0.9,
    /** 印と字の間（px・iOS の大きいロゴと同じ 12） */
    markGap: 12,
    /**
     * 「Journey Photo」1行の幅 ÷ 字の大きさ（字間 -0.025em 込み）＋ 印の比。字の幅は New York の太字で約 6.7em、
     * 無い所の代わり（Georgia）で約 7.0em。広い方に合わせ、印の 0.9 を足して 7.9
     */
    widthEm: 7.9,
    /** 一文（副題）の大きさ（px・iOS と同じ明朝 18） */
    tagline: 18,
    /** 詰めた形（「行きたい」から来た登録）: 字の大きさと一文 */
    compactWordmark: 22,
    compactTagline: 13,
} as const;
/** 互換の名前（試験と模型が読む） */
export const AUTH_MARK_RATIO = AUTH_BRAND.markRatio;
export const AUTH_WORDMARK_SIZE = AUTH_BRAND.wordmarkMax;

/**
 * 字の大きさ: 上限か、本文の幅（画面 − 左右 24、最大 384）に1行が収まる大きさの小さい方
 */
export function wordmarkFontSize(max: number = AUTH_BRAND.wordmarkMax): string {
    return `min(${max}px, calc((min(100vw - 48px, 384px) - ${AUTH_BRAND.markGap}px) / ${AUTH_BRAND.widthEm}))`;
}

/** ログインと登録の頁のロゴと一文。`compact` は「行きたい」から来た登録（写真の帯が無く、主ボタンを最初の画面に出す形） */
export function AuthBrand({ compact = false }: { compact?: boolean }) {
    // iOS `AppLogo(.hero)`・`Labels.Brand.tagline`・`SignInLayout.brandGap`（ロゴと一文の間 4・一文は明朝の白 90%）
    const size = compact ? AUTH_BRAND.compactWordmark : AUTH_BRAND.wordmarkMax;
    return (
                // 詰めた形は下の札との間も詰める（行の間 14 → 8）。375×667 でも「登録して保存」を下のタブの上に出す（#432）
                <div className={`flex flex-col gap-1 ${compact ? "-mb-1.5" : "pb-0.5"}`} data-testid="login-wordmark" style={{ filter: "drop-shadow(0 1px 6px rgb(0 0 0 / 0.55))" }}>
                    <div className="flex items-center" style={{ fontSize: wordmarkFontSize(size), gap: AUTH_BRAND.markGap }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/logo-aperture.png" alt="" width={40} height={40} className="flex-none object-contain"
                            style={{ width: `${AUTH_BRAND.markRatio}em`, height: `${AUTH_BRAND.markRatio}em` }} data-testid="login-wordmark-mark" />
                        <p className="m-0 font-wordmark font-bold text-white whitespace-nowrap" style={{ fontSize: "1em", lineHeight: 1.15, letterSpacing: "-0.025em" }}>Journey Photo</p>
                    </div>
                    {/* 副題はどの幅でも出す（2026-11-25 owner「サブタイトルも消えるの嫌だ」） */}
                    <p className="m-0 font-serif text-white/90" data-testid="login-tagline"
                        style={{ fontSize: `${compact ? AUTH_BRAND.compactTagline : AUTH_BRAND.tagline}px`, lineHeight: compact ? 1.35 : 1.4 }}>写真から、次の旅が始まる。</p>
                </div>

    );
}
