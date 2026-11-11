"use client";

/**
 * 意見を送る（札 #546・2026-11-11 owner 承認「フォームまかせる」「形式は自由記述」）。
 *
 * **書いて送るだけ**: 開く → 書く → 送る。自由に書く欄1つが主で、👍／👎・種類の選択は置かない。
 * 「写真を添える」「返事が欲しい」は任意で、欄の下に小さな文字のボタンとして控えめに置く。
 * 返事が欲しいは**ログインしている人だけ**（宛先の無い人に返事を約束しない）。
 *
 * 形は設定の下の画面（`SettingsShell`・iOS `FeedbackSheet`）にそろえた: 明朝 30 の題・欄（`SETTINGS_INPUT_CLASS` の地と縁）・
 * 写真の無い画面の主ボタン（真鍮の塗りに墨）。**ログインしていなくても開ける**ので `SettingsShell`（ログインの門）は使わない。
 *
 * 圏外で送れなかったときは、書いたものを欄に残して「つながったらもう一度送ってください」と言う（同じ id で送り直す＝二重にならない）。
 * 書きかけは端末に残す（`FEEDBACK_DRAFT_KEY`。読めなくても画面は動く）。
 */

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, PhotoIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import { userFetch, userPublicFetch } from "../../lib/utils/api";
import { toUploadSafeFile } from "../../lib/utils/image";
import {
    FEEDBACK_DRAFT_KEY, FEEDBACK_PHOTO_MAX_BYTES, FEEDBACK_TEXT_MAX,
    feedbackBody, screenFrom, sendFeedback, type FeedbackScreen,
} from "../../lib/feedback";
import { BTN_FILL } from "../components/buttonStyles";

// 2026-11-11 判断: 形は設定の下の画面と同じ値（`SettingsParts.tsx` の `SETTINGS_TITLE_CLASS`・
// `accountFormStyles.ts` の `SETTINGS_LABEL_CLASS`／`SETTINGS_PRIMARY_CLASS`）。**develop の枝にはその2つの部品がまだ無い**ので、
// main と develop で同じ1枚にするため、ここでは値を書く（部品が develop にそろったら読み替える）
const TITLE_CLASS = "m-0 px-1 font-serif font-bold text-white text-[30px] leading-[1.3]";
const LABEL_CLASS = "block mb-1.5 text-xs font-medium text-white/70";
const PRIMARY_CLASS = `w-full inline-flex items-center justify-center gap-2 ${BTN_FILL} bg-accent-fill text-ink hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`;
const QUIET_BUTTON = "inline-flex items-center gap-2 min-h-[44px] text-[13px] text-text-2 hover:text-white transition-colors disabled:opacity-40";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

export default function FeedbackPage() {
    const { isAuthenticated } = useAuth();
    const { locale } = useLocale();
    const en = locale === "en";
    const textId = useId();

    const [text, setText] = useState("");
    const [wantsReply, setWantsReply] = useState(false);
    const [photo, setPhoto] = useState<File | null>(null);
    const [preparing, setPreparing] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [screen, setScreen] = useState<FeedbackScreen>("web");
    // 押し直し・送り直しでも同じ id（サーバーで1件のまま）。送れたら新しくする
    const idRef = useRef<string>("");
    const fileRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        // `?from=` は事前描画では読めないので、描いたあとに読む（URL の問いを読むフックの Suspense を避ける）
        setScreen(screenFrom(new URLSearchParams(window.location.search).get("from")));
        try {
            const saved = window.localStorage.getItem(FEEDBACK_DRAFT_KEY);
            if (saved) setText(saved.slice(0, FEEDBACK_TEXT_MAX));
        } catch { /* 端末に残せない環境でも書ける */ }
    }, []);

    const keepDraft = (value: string) => {
        try {
            if (value.trim()) window.localStorage.setItem(FEEDBACK_DRAFT_KEY, value);
            else window.localStorage.removeItem(FEEDBACK_DRAFT_KEY);
        } catch { /* 残せなくても書ける */ }
    };

    const pickPhoto = async (file: File | undefined) => {
        if (!file) return;
        setPreparing(true);
        setError(null);
        try {
            // 位置・撮影情報を落とした1枚だけを送る（投稿と同じ関所）
            const safe = await toUploadSafeFile(file);
            if (safe.size > FEEDBACK_PHOTO_MAX_BYTES) {
                setError(en ? "The photo is too large (max 10MB)." : "写真が大きすぎます（最大10MB）");
                return;
            }
            setPhoto(safe);
        } catch {
            setError(en ? "Couldn't use this photo." : "この写真は添えられませんでした");
        } finally {
            setPreparing(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const submit = async () => {
        const body = text.trim();
        if (!body || sending || preparing) return;
        setSending(true);
        setError(null);
        if (!idRef.current) idRef.current = newId();
        try {
            const result = await sendFeedback(
                feedbackBody({ id: idRef.current, text: body, screen, wantsReply, signedIn: isAuthenticated, photo }),
                photo,
                { post: isAuthenticated ? userFetch : userPublicFetch, signedIn: isAuthenticated },
            );
            if (result.ok) {
                idRef.current = "";
                keepDraft("");
                setText("");
                setPhoto(null);
                setDone(true);
                return;
            }
            setError(result.offline
                ? (en ? "You seem to be offline. Your note is kept here — send it again when you're connected."
                    : "つながっていないようです。書いたものは残してあります。つながったらもう一度送ってください")
                : result.message);
        } catch {
            // ログインの確かめが届かなかった（`userFetch` が投げる）など。書いたものは残す
            setError(en ? "Couldn't send. Please try again." : "送れませんでした。もう一度お試しください");
        } finally {
            setSending(false);
        }
    };

    return (
        <main className="min-h-screen bg-bg text-white" data-testid="feedback-page">
            <div className="max-w-sm mx-auto px-4 pt-12 pb-16">
                <Link
                    href={ROUTES.HOME}
                    prefetch={false}
                    className="inline-flex items-center gap-1.5 min-h-[44px] text-xs text-white/60 hover:text-white transition-colors mb-4"
                    style={{ touchAction: "manipulation" }}
                >
                    <ArrowLeftIcon aria-hidden="true" className="w-3 h-3" />
                    {en ? "Back" : "戻る"}
                </Link>
                <div className="flex flex-col gap-8">
                    <h1 className={TITLE_CLASS}>{en ? "Send feedback" : "意見を送る"}</h1>

                    {done ? (
                        <div className="flex flex-col gap-4" role="status" data-testid="feedback-done">
                            <p className="m-0 px-1 text-[15px] leading-[22px] text-white">
                                {en ? "Received — thank you!" : "届きました。ありがとうございます"}
                            </p>
                            <button type="button" className={QUIET_BUTTON} onClick={() => setDone(false)}>
                                {en ? "Send another" : "もう1つ送る"}
                            </button>
                        </div>
                    ) : (
                        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                            <div>
                                <label className={LABEL_CLASS} htmlFor={textId}>{en ? "Your feedback" : "ひとこと"}</label>
                                <textarea
                                    id={textId}
                                    // 開いたらすぐ書ける（押す回数を増やさない）
                                    autoFocus
                                    rows={6}
                                    maxLength={FEEDBACK_TEXT_MAX}
                                    value={text}
                                    onChange={(e) => { setText(e.target.value); keepDraft(e.target.value); }}
                                    disabled={sending}
                                    placeholder={en ? "Anything you noticed, got stuck on, or would like to see"
                                        : "使ってみて思ったこと・困ったこと・欲しい機能など、自由に書いてください"}
                                    className="w-full bg-surface-2 border border-line-strong rounded-field px-[14px] py-3 text-[15px] leading-[1.5] text-white placeholder-white/50 focus:outline-none focus:border-white/30 transition-colors disabled:opacity-60 resize-none"
                                    data-testid="feedback-text"
                                />
                            </div>

                            {/* 任意の2つ。控えめな文字のボタン（13・text-2・当たり 44） */}
                            <div className="flex flex-col items-start">
                                {photo ? (
                                    <div className="flex items-center gap-3">
                                        <span className="text-[13px] text-text-2">{en ? "1 photo attached" : "写真を1枚添えました"}</span>
                                        <button type="button" className={QUIET_BUTTON} onClick={() => setPhoto(null)} disabled={sending}>
                                            {en ? "Remove" : "外す"}
                                        </button>
                                    </div>
                                ) : (
                                    <button type="button" className={QUIET_BUTTON} onClick={() => fileRef.current?.click()}
                                            disabled={sending || preparing} data-testid="feedback-photo">
                                        <PhotoIcon aria-hidden="true" className="w-4 h-4" />
                                        {preparing ? (en ? "Preparing photo…" : "写真を準備しています…") : (en ? "Attach a photo (optional)" : "写真を添える（任意）")}
                                    </button>
                                )}
                                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden
                                       onChange={(e) => void pickPhoto(e.target.files?.[0])} />
                                {isAuthenticated && (
                                    <label className={`${QUIET_BUTTON} cursor-pointer`}>
                                        {/* 選んだら真鍮（黒地の上の合図）。形でも伝わる（チェックの箱） */}
                                        <input type="checkbox" checked={wantsReply} onChange={(e) => setWantsReply(e.target.checked)}
                                               disabled={sending} className="h-4 w-4 accent-accent" data-testid="feedback-reply" />
                                        {en ? "I'd like a reply (optional)" : "返事が欲しい（任意）"}
                                    </label>
                                )}
                            </div>

                            {error && <p role="alert" className="m-0 text-[13px] leading-relaxed text-danger" data-testid="feedback-error">{error}</p>}

                            <button type="submit" className={PRIMARY_CLASS} disabled={!text.trim() || sending || preparing}
                                    data-testid="feedback-send">
                                {sending ? (en ? "Sending…" : "送っています…") : (en ? "Send" : "送る")}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </main>
    );
}
