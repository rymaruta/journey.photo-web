"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import UserAvatar from "./UserAvatar";
import { BTN_FILL, BTN_LINE } from "./buttonStyles";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import { signupBenefitsLoginHref, signupBenefitsSignupHref } from "../../lib/auth/signupBenefits";
import { newFollowNonce, rememberFollowAfterLogin, clearFollowAfterLogin, withFollowMark } from "../../lib/utils/followAfterLogin";

type Props = {
    targetUserId: string;
    /** 表示名。無ければ見出しは「フォローするにはログイン」 */
    targetName?: string;
    /** @名（@ は付けずに渡す） */
    targetHandle?: string;
    locale: "ja" | "en";
    onClose: () => void;
    /** 閉じたときのフォーカスの戻り先＝押したフォローのボタン */
    restoreRef: React.RefObject<HTMLElement | null>;
};

/**
 * **ログインしていない人がフォローを押したときの案内の板**（札 journey.photo-ios#664、2026-11-20 判断）。
 *
 * owner「qr読み込んだあとにプロフィール遷移してフォローするボタン押すとログインしてくださいみたいな
 * ポップアップ出てくると思うけど、それのサイズが小さい気がして気付きにくいかも。ユーザビリティとか
 * 考えてブラッシュアップしてもいいよ」。以前は小さな info のトースト「フォローするにはログインしてください」
 * が出て消えるだけで、ログインしたあともフォローされていなかった。
 *
 * - スマホは下から出る板、PC（640px 以上）は中央の小さな窓（`FollowingSheet`・`ReportDialog` と同じ形）
 * - 中身は「誰を」（顔と名前）→ 見出し1行 → 主「ログインしてフォロー」→ 副「新しく登録」。閉じるは左上
 *   （デザインの板 03: シートは左上の「閉じる」、2026-11-13 owner 承認）
 * - 主ボタンは写真の無い黒地なので accent-fill（真鍮の塗りに墨）。高さは板の 50（主）と 44（副）
 * - 押した先はログイン・登録の頁のまま。戻り先（`next`）に合言葉を載せ、押した瞬間にこのタブへ印を書く。
 *   戻ってきた頁の `FollowAction` が両方を突き合わせて1回だけフォローする（`lib/utils/followAfterLogin.ts`）
 * - 閉じた人には印を書かない（書いてあれば消す）＝勝手にフォローしない
 *
 * フォローのボタンの全部の形（人の頁・写真の詳細・お知らせ・人を探す）が `FollowAction` の1本なので、
 * この板も1つだけ。
 */
export default function FollowLoginSheet({ targetUserId, targetName, targetHandle, locale, onClose, restoreRef }: Props) {
    const isJa = locale !== "en";
    const panelRef = useRef<HTMLDivElement | null>(null);
    /** 開いたとき最初に当てる先＝主の操作（閉じるから読み上げを始めない） */
    const primaryRef = useRef<HTMLAnchorElement | null>(null);
    const titleId = useId();
    // 合言葉は開くたびに作る。リンク先（`next`）に載せるので、押す前から決まっている必要がある。
    // **書くのは押したときだけ**（開いただけ・閉じた人の端末には残さない）
    const [nonce] = useState(newFollowNonce);
    const [here, setHere] = useState<string | null>(null);

    useFocusTrap(true, panelRef, restoreRef, primaryRef);
    useEscapeKey(true, onClose);
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);
    useEffect(() => {
        window.addEventListener("popstate", onClose);
        return () => window.removeEventListener("popstate", onClose);
    }, [onClose]);
    useEffect(() => {
        setHere(withFollowMark(window.location.pathname + window.location.search + window.location.hash, nonce));
    }, [nonce]);

    const close = () => {
        clearFollowAfterLogin();
        onClose();
    };
    const remember = () => rememberFollowAfterLogin(targetUserId, nonce);

    const name = targetName?.trim();
    const title = isJa
        ? (name ? `${name}さんをフォローするにはログイン` : "フォローするにはログイン")
        : (name ? `Log in to follow ${name}` : "Log in to follow");

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4" role="presentation">
            <div className="absolute inset-0 bg-black/70" onClick={close} aria-hidden="true" data-testid="follow-login-backdrop" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-testid="follow-login-sheet"
                // 板 02b: シートの上の角 24・左右 20。PC は札の角 16 の窓
                className="relative w-full sm:max-w-[360px] rounded-t-3xl sm:rounded-2xl bg-surface-2 ring-1 ring-line shadow-2xl shadow-black/60 story-media-in"
                style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))", fontFeatureSettings: '"palt"' }}
            >
                <div className="flex items-center px-[12px] pt-[12px]">
                    <button
                        type="button"
                        onClick={close}
                        data-testid="follow-login-close"
                        className="inline-flex items-center justify-center rounded-full bg-white/8 ring-1 ring-inset ring-line text-white hover:bg-white/12 active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{ minHeight: "44px", minWidth: "44px", padding: "0 16px", fontSize: "15px", touchAction: "manipulation" }}
                    >
                        {isJa ? "閉じる" : "Close"}
                    </button>
                </div>
                <div className="px-[20px] pt-[8px] flex flex-col items-center text-center">
                    <UserAvatar userId={targetUserId} className="w-16 h-16 ring-1 ring-line" iconClassName="w-8 h-8" />
                    <h2 id={titleId} className="font-serif font-bold text-white m-0 mt-[12px] break-words" style={{ fontSize: "20px", lineHeight: 1.4 }}>
                        {title}
                    </h2>
                    {targetHandle && (
                        <p className="m-0 mt-[4px] text-text-3 break-all" style={{ fontSize: "12px", lineHeight: "16px" }}>@{targetHandle}</p>
                    )}
                    <div className="w-full flex flex-col gap-[12px] mt-[24px]">
                        <Link
                            ref={primaryRef}
                            href={signupBenefitsLoginHref(here, "follow")}
                            prefetch={false}
                            onClick={remember}
                            data-testid="follow-login-primary"
                            className={`${BTN_FILL} w-full inline-flex items-center justify-center bg-accent-fill text-ink no-underline hover:brightness-110 active:scale-[0.98] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}
                            style={{ touchAction: "manipulation" }}
                        >
                            {isJa ? "ログインしてフォロー" : "Log in and follow"}
                        </Link>
                        <Link
                            href={signupBenefitsSignupHref(here, "follow")}
                            prefetch={false}
                            onClick={remember}
                            data-testid="follow-login-signup"
                            className={`${BTN_LINE} w-full inline-flex items-center justify-center no-underline hover:bg-white/5 active:scale-[0.98] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                            style={{ touchAction: "manipulation" }}
                        >
                            {isJa ? "新しく登録" : "Sign up"}
                        </Link>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
