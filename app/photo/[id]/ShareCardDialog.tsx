"use client";

import React, { useEffect, useRef, useState } from "react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/utils/scrollLock";
import { useEscapeKey } from "../../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";
import {
    initialShareCardStyle, renderShareCard, SHARE_CARD_HEIGHT, SHARE_CARD_STYLE_KEY, SHARE_CARD_STYLES,
    SHARE_CARD_WIDTH, shareCardRatioLabel, shareCardStyleName,
    type ShareCardCredit, type ShareCardRatio, type ShareCardStyle,
} from "../../../lib/utils/signatureShareCard";

type Props = {
    locale: "ja" | "en";
    photoId: string;
    credit: ShareCardCredit;
    /** 写真を読む（同じ出どころの /uploads に寄せた読み方は呼び出し元が持つ） */
    loadPhoto: () => Promise<ImageBitmap>;
    openerRef: React.RefObject<HTMLElement | null>;
    onClose: () => void;
    onError: () => void;
};

const RATIOS: readonly ShareCardRatio[] = ["4:5", "9:16", "1:1"];
/** 払って型を替える距離（これより短い払いは替えない・iOS と同じ 40） */
export const SWIPE_THRESHOLD = 40;
/** 見本の列の絵の幅（4:5 で 52×65）。書き出す画素は 3 倍 */
const THUMB_WIDTH = 52;

/** 払ったとき・矢印のキーの隣の型（端で反対の端へ回る） */
export function neighborStyle(style: ShareCardStyle, step: number): ShareCardStyle {
    const i = SHARE_CARD_STYLES.indexOf(style);
    const n = SHARE_CARD_STYLES.length;
    return SHARE_CARD_STYLES[(((i < 0 ? 0 : i) + step) % n + n) % n];
}

function readStoredStyle(): string | null {
    try { return window.localStorage.getItem(SHARE_CARD_STYLE_KEY); } catch { return null; }
}

/**
 * **SNS に貼るカードを作る画面**（2026-11-12 デザインの案 第8章・iOS の `SignatureShareCardSheet` と同じ形）。
 *
 * 見本を横に払うか、下の見本の列（絵と名前）を押して型を選ぶ。比率は「投稿 4:5・ストーリー 9:16・正方形 1:1」。
 * 開くと前に使った型（初めては縦書き）。メニューの「共有画像を保存（比率）」3行をこの1行にまとめた。
 */
export default function ShareCardDialog({ locale, photoId, credit, loadPhoto, openerRef, onClose, onError }: Props) {
    const en = locale === "en";
    const [style, setStyle] = useState<ShareCardStyle>(() => initialShareCardStyle(readStoredStyle()));
    const [ratio, setRatio] = useState<ShareCardRatio>("4:5");
    const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
    const [thumbs, setThumbs] = useState<Partial<Record<ShareCardStyle, string>>>({});
    const [failed, setFailed] = useState(false);
    const [dragX, setDragX] = useState(0);
    const photoRef = useRef<Promise<ImageBitmap> | null>(null);
    const cache = useRef(new Map<string, Blob>());
    const urls = useRef<string[]>([]);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const stripRef = useRef<HTMLDivElement | null>(null);
    const drag = useRef<{ x: number; id: number } | null>(null);
    // 開いている間は同じ写真・同じ字で作る（親が描き直すたびに作り直さない）
    const creditRef = useRef(credit);
    const loadRef = useRef(loadPhoto);

    useEscapeKey(true, onClose);
    useFocusTrap(true, dialogRef, openerRef);
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);
    useEffect(() => () => {
        urls.current.forEach(u => URL.revokeObjectURL(u));
        void photoRef.current?.then(b => b.close()).catch(() => undefined);
    }, []);

    const photo = () => {
        if (!photoRef.current) {
            photoRef.current = loadRef.current();
            photoRef.current.catch(() => { photoRef.current = null; });
        }
        return photoRef.current;
    };

    const objectUrl = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        return url;
    };

    // 選んだ型と比率の絵（作ったものは閉じるまで取っておく）
    useEffect(() => {
        let cancelled = false;
        const key = `${style}-${ratio}`;
        (async () => {
            try {
                let blob = cache.current.get(key);
                if (!blob) {
                    blob = await renderShareCard(await photo(), creditRef.current, ratio, style);
                    cache.current.set(key, blob);
                }
                if (!cancelled) { setPreview({ key, url: objectUrl(blob) }); setFailed(false); }
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();
        try { window.localStorage.setItem(SHARE_CARD_STYLE_KEY, style); } catch { /* 覚えられなくても作れる */ }
        return () => { cancelled = true; };
    }, [style, ratio]);

    // 見本の列の小さな絵（1080 で作ると重いので、幅 156 の画素で描く）
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const s of SHARE_CARD_STYLES) {
                if (cancelled) return;
                try {
                    const blob = await renderShareCard(await photo(), creditRef.current, "4:5", s, THUMB_WIDTH * 3);
                    if (!cancelled) setThumbs(t => ({ ...t, [s]: objectUrl(blob) }));
                } catch { /* 絵が無くても名前で選べる */ }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const el = stripRef.current?.querySelector<HTMLElement>(`[data-style="${style}"]`);
        el?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
    }, [style]);

    const save = async () => {
        const blob = cache.current.get(`${style}-${ratio}`);
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        try {
            const link = document.createElement("a");
            link.href = url;
            link.download = `journey-photo-${photoId}-${style}-${ratio.replace(":", "x")}.jpg`;
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            onError();
        } finally {
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };

    const ready = preview?.key === `${style}-${ratio}`;
    const aspect = SHARE_CARD_WIDTH / SHARE_CARD_HEIGHT[ratio];
    const name = (s: ShareCardStyle) => shareCardStyleName(s, locale);

    return (
        <div
            ref={dialogRef}
            className="fixed inset-0 z-50 flex justify-center overflow-y-auto overscroll-contain bg-black"
            role="dialog"
            aria-modal="true"
            aria-label={en ? "Share to social media" : "SNSに共有"}
        >
            <div className="flex w-full max-w-md flex-col min-h-full">
                <div className="relative flex h-11 shrink-0 items-center justify-center text-[16px] font-semibold text-white">
                    {en ? "Share to social media" : "SNSに共有"}
                    <button type="button" onClick={onClose}
                        className="absolute right-1.5 top-0 flex h-11 min-w-11 items-center justify-center px-2.5 text-[15px] text-white">
                        {en ? "Close" : "閉じる"}
                    </button>
                </div>

                {/* 見本。左右に払うと型が変わる（矢印のキーでも） */}
                <div
                    className="relative mt-2.5 flex min-h-[320px] flex-1 items-center justify-center overflow-hidden px-4"
                    style={{ touchAction: "pan-y" }}
                    tabIndex={0}
                    role="group"
                    aria-roledescription={en ? "preview" : "見本"}
                    aria-label={`${en ? "Preview" : "見本"} ${name(style)}・${en ? "swipe to change the style" : "左右に払うと型が変わる"}`}
                    data-testid="share-card-preview"
                    onKeyDown={e => {
                        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                            e.preventDefault();
                            setStyle(s => neighborStyle(s, e.key === "ArrowRight" ? 1 : -1));
                        }
                    }}
                    onPointerDown={e => { drag.current = { x: e.clientX, id: e.pointerId }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 無くても払える */ } }}
                    onPointerMove={e => { if (drag.current) setDragX(e.clientX - drag.current.x); }}
                    onPointerUp={e => {
                        if (!drag.current) return;
                        const dx = e.clientX - drag.current.x;
                        drag.current = null;
                        setDragX(0);
                        if (Math.abs(dx) > SWIPE_THRESHOLD) setStyle(s => neighborStyle(s, dx < 0 ? 1 : -1));
                    }}
                    onPointerCancel={() => { drag.current = null; setDragX(0); }}
                >
                    {failed ? (
                        <div className="flex flex-col items-center gap-2 text-center text-white">
                            <p>{en ? "Could not create the image" : "画像を作れませんでした"}</p>
                            <p className="text-[13px] text-text-2">{en ? "Choose another style or ratio" : "別の型か比率を選んでください"}</p>
                        </div>
                    ) : ready && preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview.url} alt="" draggable={false}
                            className="max-h-full max-w-full select-none object-contain"
                            style={{ aspectRatio: aspect, transform: `translateX(${dragX}px)`, opacity: 1 - Math.min(0.5, Math.abs(dragX) / 400), transition: dragX ? "none" : "transform .22s ease, opacity .22s ease" }} />
                    ) : (
                        <p className="text-[13px] text-text-2" role="status">{en ? "Preparing image…" : "共有画像を準備しています…"}</p>
                    )}
                </div>

                {/* 見本の列（絵で選ぶ・名前は下に1行）。今いる型は真鍮の輪と真鍮の字 */}
                <div ref={stripRef} className="flex shrink-0 gap-1.5 overflow-x-auto px-3.5 pb-1.5 pt-2 [scrollbar-width:none]"
                    role="group" aria-label={en ? "Card style" : "カードの型"}>
                    {SHARE_CARD_STYLES.map(s => {
                        const on = s === style;
                        return (
                            <button key={s} type="button" data-style={s} aria-pressed={on} onClick={() => setStyle(s)}
                                className={`flex min-h-11 min-w-[60px] shrink-0 flex-col items-center gap-[5px] pt-[3px] text-[12px] ${on ? "font-semibold text-accent" : "text-text-2"}`}>
                                <span className={`block overflow-hidden rounded-md ${on ? "shadow-[0_0_0_2px_#000,0_0_0_4px_var(--color-accent)]" : "shadow-[0_0_0_1px_rgba(255,255,255,.12)]"}`}
                                    style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * 1.25 }}>
                                    {thumbs[s]
                                        // eslint-disable-next-line @next/next/no-img-element
                                        ? <img src={thumbs[s]} alt="" className="h-full w-full object-cover" />
                                        : <span className="block h-full w-full bg-surface-4" />}
                                </span>
                                {name(s)}
                            </button>
                        );
                    })}
                </div>

                {/* 比率（どこに貼るか） */}
                <div className="flex shrink-0 gap-1.5 px-3.5 pt-1" role="radiogroup" aria-label={en ? "Ratio" : "比率"}>
                    {RATIOS.map(r => {
                        const on = r === ratio;
                        return (
                            <button key={r} type="button" role="radio" aria-checked={on} onClick={() => setRatio(r)}
                                className="min-h-11 flex-1">
                                <span className={`flex h-10 flex-col items-center justify-center rounded-xl border text-[12px] leading-tight ${on ? "border-primary bg-primary font-semibold text-ink" : "border-line-strong text-chip-text"}`}>
                                    {shareCardRatioLabel(r, locale)}
                                    <small className={`text-[11px] tabular-nums ${on ? "text-ink" : "text-text-3"}`}>{r}</small>
                                </span>
                            </button>
                        );
                    })}
                </div>

                <button type="button" onClick={() => void save()} disabled={!ready}
                    className="mx-3.5 mb-[22px] mt-2.5 h-[50px] shrink-0 rounded-full bg-primary text-[15px] font-semibold text-ink disabled:opacity-40">
                    {en ? "Save this image" : "この画像を保存"}
                </button>
            </div>
        </div>
    );
}
