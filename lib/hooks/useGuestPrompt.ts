"use client";

import { useCallback } from "react";
import { useToast } from "./useToast";
import { loginWithNext } from "../routes";
import { track, type LoginPromptTrigger } from "../utils/analytics";
import type { LoginVia } from "../auth/loginVia";

/**
 * 未ログインの反応（いいね・保存・フォロー・コメント）を、登録・ログインの入口に変える（2026-11-09 owner 承認）。
 *
 * **押した人に「ログインしてください」と言うだけで終わらせない。** 文言は数秒で消えるので、
 * トーストに「ログイン」のリンクを付ける。戻り先は**今開いている頁**（押した写真・人に返す）、
 * `via` は何を押したか（ログイン画面が理由と得られるものを1〜2行で言う・`lib/auth/loginVia.ts`）。
 * 4か所（写真ページ・モーダル・フォロー・コメント）が同じ見せ方になるよう、文言と作りをここに1つだけ置く。
 *
 * 数える（`login_prompt`）のは**案内を出した回**。押したあとにログインへ進んだかは `view_signup` / `login` で見る。
 */
export const GUEST_PROMPT_COPY: Record<Exclude<LoginPromptTrigger, "following_tab">, { ja: string; en: string }> = {
    like: { ja: "いいねするにはログインしてください", en: "Log in to like" },
    save: { ja: "写真を保存するにはログインしてください", en: "Log in to save photos." },
    follow: { ja: "フォローするにはログインしてください", en: "Log in to follow" },
    comment: { ja: "コメントするにはログインしてください", en: "Log in to comment" },
};
export const GUEST_PROMPT_ACTION = { ja: "ログイン", en: "Log in" } as const;
/** 切れ目なく読めるように、既定の3秒より長く出す（リンクを押す間） */
export const GUEST_PROMPT_MS = 6000;

/**
 * 連打・ダブルタップで同じ案内を積まない。**同じ文言のトーストが出ている間（`GUEST_PROMPT_MS`）は新しく出さず、
 * `login_prompt` も数えない**（出していない案内は数えない）。フォローボタンは一覧に何個も並ぶので、
 * 記録はフックの中ではなくモジュールに置く。早く閉じられた場合も、同じ文言は区切りが過ぎるまで出ない（小さい取りこぼし）
 */
const lastShownAt = new Map<string, number>();
export function resetGuestPromptThrottle() { lastShownAt.clear(); }

const VIA_OF: Record<keyof typeof GUEST_PROMPT_COPY, LoginVia> = {
    like: "like", save: "save", follow: "follow", comment: "comment",
};

export function useGuestPrompt(locale: "ja" | "en" | string) {
    const { showToast } = useToast();
    const en = locale === "en";
    return useCallback((trigger: keyof typeof GUEST_PROMPT_COPY, message?: string) => {
        const text = message ?? (en ? GUEST_PROMPT_COPY[trigger].en : GUEST_PROMPT_COPY[trigger].ja);
        const now = Date.now();
        const last = lastShownAt.get(text);
        if (last !== undefined && now - last >= 0 && now - last < GUEST_PROMPT_MS) return;
        lastShownAt.set(text, now);
        const next = typeof window === "undefined" ? null : window.location.pathname + window.location.search;
        showToast(
            text,
            "info",
            GUEST_PROMPT_MS,
            { label: en ? GUEST_PROMPT_ACTION.en : GUEST_PROMPT_ACTION.ja, href: loginWithNext(next, VIA_OF[trigger]) },
        );
        track("login_prompt", { trigger });
    }, [showToast, en]);
}
