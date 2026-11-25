"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { track, type SignupFrom } from "../../lib/utils/analytics";
import {
    APPLE_SCRIPT_URL, GOOGLE_SCRIPT_URL, FEDERATED_FAIL_MESSAGE, FederatedCancelled, FederatedShownError,
    exchangeWithServer, googleId, loadScript, loadWebIds, makeNonce, prepareApple, readCachedWebIds, runApple,
    type ApplePrepared, type FederatedProvider, type WebIds,
} from "../../lib/auth/federated";

/**
 * ログインと新規登録の頁の「Apple でサインイン」「Google でログイン」（札 journey.photo-ios#730）。
 * iOS の案（ログインの画面と連携）と同じ並び: Apple → Google → 「またはメールアドレスで」→ メールの欄。
 *
 *     Google Google の部品が描くボタン（`renderButton`・白の地 `outline`・丸・大 40・印と字を真ん中に）。形を Google の決まりから外さない
 *     Apple  Google の部品の形に合わせて作る: 白の地・縁 #DADCE0 の 1px・高さ 40（当たり 44）・角は丸・横いっぱい（最大 400）・
 *            印 18・字 14 の中太（字間 0.25）・印と字の間 8 で、印と字のまとまりを真ん中に（Google の部品の実測と同じ）。
 *            黒い地の上は白、字と印は黒（Apple の決まり）
 *     間 10（iOS `externalGap`）
 *
 * 2026-11-25 owner「バランス悪く見える。各アイコンとかロゴとかも」: 前は Apple が白の地・字 16、Google が黒の地（`filled_black`）で
 * G の印が大きな白い丸に入り、2つの色・印の大きさ・字の大きさが割れていた。Google の部品の黒の形は印を白い丸に入れる決まりの絵で、
 * こちらでは変えられない。白の形（`outline`）なら印は丸なしの 18 で、Apple の白のボタンと同じ見た目にそろう。
 * Google の部品は高さ 40・字 14 の決まった形なので、Apple の側を Google に合わせた（Apple の決まりは字の大きさと高さを任せている）。
 * 自前の Google のボタン（公式の G の絵を使う形）は、押したときに ID トークンを受け取る道が Google の部品の
 * ボタンしか無い（ほかの道は戻り先の URL の登録かサーバーの秘密の鍵が要る）ので、今の流れ（nonce・CUSTOM_AUTH）を守るため取らない
 *
 * サーバーが Web の宛先（`webClientId`）を返した提供元のボタンだけを出す。どちらも無ければ何も出さない（今の画面のまま）。
 * 押す回数: Apple 2回（ボタン → Apple の画面で続ける）、Google 2〜3回（ボタン → アカウントを選ぶ（→ 続ける））
 */
export function FederatedSignIn({ mode, from = "other", placement = "top", onError }: {
    mode: "signin" | "signup";
    from?: SignupFrom;
    /** top: ボタン → 「またはメールアドレスで」（欄の上）。bottom: 「または」→ ボタン（欄の下・「行きたい」から来た登録） */
    placement?: "top" | "bottom";
    /** 失敗の一文（空でもとに戻す）。頁のエラーの場所に出す */
    onError: (message: string) => void;
}) {
    const { loginWithTicket } = useAuth();
    const { showToast } = useToast();
    const [ids, setIds] = useState<WebIds>({ apple: null, google: null });
    const [appleReady, setAppleReady] = useState(false);
    const [googleReady, setGoogleReady] = useState(false);
    const [busy, setBusy] = useState<FederatedProvider | null>(null);
    const applePrep = useRef<ApplePrepared | null>(null);
    const googleNonce = useRef<string | null>(null);
    const googleBox = useRef<HTMLDivElement | null>(null);
    const mounted = useRef(true);
    // 付け直したときに true へ戻す（開発の StrictMode は付けて外して付け直すので、戻さないとボタンが押せないままになる）
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    // 前に見た答えで先に出し、サーバーの今の答えで直す
    useEffect(() => {
        setIds(readCachedWebIds());
        let alive = true;
        void loadWebIds().then((v) => { if (alive) setIds(v); });
        return () => { alive = false; };
    }, []);

    const finish = useCallback(async (provider: FederatedProvider, run: () => Promise<{ username: string; challengeAnswer: string; created: boolean }>) => {
        onError("");
        setBusy(provider);
        try {
            const t = await run();
            const signed = await loginWithTicket(t.username, t.challengeAnswer);
            if (!signed.success) throw new FederatedShownError(signed.error || FEDERATED_FAIL_MESSAGE);
            if (t.created) track("sign_up", { method: provider, from });
            else track("login", { method: provider });
            showToast(t.created ? "登録しました" : "ログインしました", "success");
            // 行き先へは頁の「ログイン済みなら戻り先へ」が運ぶ（メールのログインと同じ）
        } catch (e) {
            // 画面に出すのは日本語の決まった文とサーバーの理由だけ（提供元の部品の英語の理由は出さない）
            if (!(e instanceof FederatedCancelled)) onError(e instanceof FederatedShownError ? e.message : FEDERATED_FAIL_MESSAGE);
        } finally {
            if (mounted.current) setBusy(null);
        }
    }, [from, loginWithTicket, onError, showToast]);

    // ── Apple: 部品を読み、押す前に nonce を用意する（押した手の動きの中でポップアップを開くため）
    const readyApple = useCallback(async (clientId: string) => {
        setAppleReady(false);
        applePrep.current = await prepareApple(clientId, window.location.origin);
        if (mounted.current) setAppleReady(!!applePrep.current);
    }, []);
    useEffect(() => {
        if (!ids.apple) return;
        const clientId = ids.apple;
        let alive = true;
        loadScript(APPLE_SCRIPT_URL).then(() => { if (alive) void readyApple(clientId); }).catch(() => { if (alive) setAppleReady(false); });
        return () => { alive = false; };
    }, [ids.apple, readyApple]);

    const onApple = () => {
        const prep = applePrep.current;
        if (!prep || busy || !ids.apple) return;
        // 🔴 ここで待たずに開く（`runApple` の最初で Apple のポップアップを開く）
        const opened = runApple(prep);
        applePrep.current = null;
        setAppleReady(false);
        const clientId = ids.apple;
        void finish("apple", async () => exchangeWithServer("apple", { ...(await opened), nonce: prep.nonce.raw }))
            // 次の1回のために作り直す（nonce は1回きり）
            .then(() => { if (mounted.current) void readyApple(clientId); });
    };

    // ── Google: Google の部品がボタンを描く。nonce は initialize に渡す（1回ごとに作り直す）
    const finishRef = useRef(finish);
    useEffect(() => { finishRef.current = finish; }, [finish]);
    const renderGoogle = useCallback(async (clientId: string) => {
        const gid = googleId();
        const box = googleBox.current;
        if (!gid || !box) return;
        const nonce = await makeNonce();
        googleNonce.current = nonce.raw;
        gid.initialize({
            client_id: clientId,
            nonce: nonce.hashed,
            ux_mode: "popup",
            context: mode === "signup" ? "signup" : "signin",
            auto_select: false,
            itp_support: true,
            callback: (resp: { credential?: string }) => {
                const raw = googleNonce.current;
                googleNonce.current = null;
                if (!resp?.credential || !raw) { onError(FEDERATED_FAIL_MESSAGE); return; }
                void finishRef.current("google", () => exchangeWithServer("google", { idToken: resp.credential, nonce: raw }))
                    .then(() => { if (mounted.current) void renderGoogle(clientId); });
            },
        });
        box.replaceChildren();
        gid.renderButton(box, {
            type: "standard", theme: "outline", size: "large", shape: "pill",
            text: mode === "signup" ? "signup_with" : "signin_with",
            logo_alignment: "center", locale: "ja",
            width: Math.max(200, Math.min(400, Math.round(box.getBoundingClientRect().width || 320))),
        });
        if (mounted.current) setGoogleReady(true);
    }, [mode, onError]);
    useEffect(() => {
        if (!ids.google) return;
        const clientId = ids.google;
        let alive = true;
        loadScript(GOOGLE_SCRIPT_URL).then(() => { if (alive) void renderGoogle(clientId); }).catch(() => { if (alive) setGoogleReady(false); });
        return () => { alive = false; };
    }, [ids.google, renderGoogle]);

    if (!ids.apple && !ids.google) return null;

    const divider = (
        <div data-testid="federated-or" className={`flex items-center gap-4 text-[13px] text-white/70 whitespace-nowrap before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line ${placement === "top" ? "[@media(max-height:720px)]:hidden" : ""}`}>
            {placement === "top" ? "またはメールアドレスで" : "または"}
        </div>
    );
    const spinner = <span aria-hidden="true" className="w-4 h-4 border-2 border-black/25 border-t-black rounded-full animate-spin" />;

    return (
        // 背の低い画面（720 以下）は間を 8 にし、上の「またはメールアドレスで」の線を消す（iOS の tight・`AUTH_STACK_CLASS`）
        <div className="flex flex-col gap-[10px] [@media(max-height:720px)]:gap-2" data-testid="federated-signin">
            {placement === "bottom" && divider}
            {ids.apple && (
                // 当たり 44（見た目 40・上下 2 は透明）
                <button type="button" onClick={onApple} disabled={!appleReady || busy !== null}
                    data-testid="federated-apple" aria-busy={busy === "apple"}
                    className="group w-full max-w-[400px] mx-auto py-[2px] -my-[2px] disabled:cursor-default focus:outline-none"
                    style={{ touchAction: "manipulation" }}>
                    <span className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white text-black text-[14px] font-medium tracking-[0.25px] ring-1 ring-inset ring-[#DADCE0] transition group-active:scale-[0.98] group-disabled:opacity-60 group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-black">
                        {busy === "apple" ? spinner : <AppleMark />}
                        {mode === "signup" ? "Apple で登録" : "Apple でサインイン"}
                    </span>
                </button>
            )}
            {ids.google && (
                <div className="relative w-full max-w-[400px] mx-auto min-h-10" data-testid="federated-google" aria-busy={busy === "google"}>
                    <div ref={googleBox} className="flex w-full justify-center [color-scheme:normal]" />
                    {/* 部品が読めるまでの場所取り（同じ形の灰の骨格。押せない） */}
                    {!googleReady && <div aria-hidden="true" className="absolute inset-0 rounded-full bg-white ring-1 ring-inset ring-[#DADCE0]" />}
                    {/* 進んでいる間は押せなくする（Google の部品は止める口を持たない） */}
                    {busy !== null && <div aria-hidden="true" className="absolute inset-0 rounded-full bg-black/50" />}
                </div>
            )}
            {placement === "top" && divider}
        </div>
    );
}

/** Apple の印（黒）。Apple の決まりどおり、字の左に置き、字と同じ高さにそろえる */
function AppleMark() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] -mt-[2px] flex-none text-black" fill="currentColor">
            <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
        </svg>
    );
}
