"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { forgotPassword, confirmForgotPassword, PASSWORD_RULE_MESSAGE } from "../../lib/auth/cognito";
import { userFetch } from "../../lib/utils/api";
import { LoadingState } from "../components/StateViews";
import { AuthPhotoBand, AuthBrand } from "../components/AuthPhotoBand";
import { ROUTES, safeNextPath } from "../../lib/routes";
import { pendingNameKey } from "../../lib/utils/pendingName";
import { WISH_VIA, track } from "../../lib/utils/analytics";
import { SETTINGS_INPUT_CLASS, SETTINGS_LABEL_CLASS, AUTH_PRIMARY_CLASS, AUTH_OUTLINE_CLASS, AUTH_TEXT_BUTTON_CLASS, AUTH_CAPTION_CLASS } from "../components/accountFormStyles";

type Step = "login" | "forgot-send" | "forgot-confirm";


function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const verified = searchParams?.get("verified") === "1";
    // ログイン後の戻り先。**これが無かったので、写真を見ていて「フォローする
    // にはログインしてください」→ ログイン → 必ず自分のプロフィールに着地し、
    // さっき見ていた写真も相手も見失っていた。**
    // 受け取るのはサイト内の絶対パスだけ（safeNextPath がオープン
    // リダイレクトを塞ぐ）。無ければ従来どおり自分のプロフィールへ。
    const nextPath = safeNextPath(searchParams?.get("next"));
    // 「行きたい」から来た印（`via=wish`）を新規登録へ運ぶ（登録までの数え方・#432）。
    // 決まった値だけ通す
    const viaWish = searchParams?.get("via") === WISH_VIA;
    const signupQuery = [
        nextPath ? `next=${encodeURIComponent(nextPath)}` : "",
        viaWish ? `via=${WISH_VIA}` : "",
    ].filter(Boolean).join("&");
    const signupHref = signupQuery ? `/signup?${signupQuery}` : "/signup";
    const { login, isAuthenticated, loading, userId } = useAuth();
    const { showToast } = useToast();

    const [step, setStep] = useState<Step>("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [resetCode, setResetCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [needsVerification, setNeedsVerification] = useState(false);
    /** 案内（送りました、など）。エラーとは別に出す（iOS `notice`） */
    const [notice, setNotice] = useState("");

    // **replace で出る。** push にすると、ログイン済みで /login に着地する
    // たびに履歴が伸び、戻るが「/login → next → /login」の往復から
    // 抜けられなくなる（useMemberGate 側と合わせて1つの罠になっていた）。
    useEffect(() => {
        if (!loading && isAuthenticated) {
            router.replace(nextPath ?? (userId ? ROUTES.USER_PROFILE(userId) : "/"));
        }
    }, [isAuthenticated, loading, router, userId, nextPath]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setNotice("");
        setNeedsVerification(false);
        setSubmitting(true);
        try {
            const result = await login(username.trim(), password);
            if (result.success) {
                // 新規登録時に保存した表示名があれば、プロフィールを作成
                // 登録したときと同じメールアドレスの分だけを使う。
                // グローバルな1キーだった頃は、別人が登録途中で残した名前を
                // 拾ってしまい、こちらのプロフィールに勝手に付いていた。
                const pendingKey = pendingNameKey(username);
                let pendingDisplayName: string | null = null;
                try { pendingDisplayName = localStorage.getItem(pendingKey); } catch { /* ignore */ }
                if (pendingDisplayName) {
                    // **待たない。** ここは API を2本、直列で叩く。
                    // `userFetch` はセッション最大10秒＋要求20秒なので、
                    // **1本あたり最大30秒・2本で最大60秒**「ログイン中...」の
                    // ままになる。しかもこの枝に入るのは
                    // **登録を終えたばかりの初回ログインちょうど**——
                    // 電波の悪い場所でそこを踏んだ人は、トークンはもう手元に
                    // あるのに固まった画面を見て閉じる。
                    //
                    // 落ちても控え（`pendingKey`）は残るので、**次にログイン
                    // したときにここがもう一度走る**。
                    //
                    // **`ProfileSetupBanner` は拾い直さない**（一度そう書いた
                    // が誤り）。あちらは `GET /user/profile` で名前の有無を
                    // 見て「名前を決めましょう」と促すだけで、`pendingKey` も
                    // `localStorage` も読まない。つまり次のログインまでの間、
                    // 登録時に入れた表示名は画面に出てこない。**先に着地させる。**
                    void (async () => {
                        try {
                            // PUT /user/profile は全置換なので、既にプロフィールがある場合は上書きしない
                            const check = await userFetch("/user/profile");
                            const existing = check.ok ? await check.json() as { displayName?: string } : null;
                            if (existing?.displayName) {
                                try { localStorage.removeItem(pendingKey); } catch { /* ignore */ }
                            } else {
                                const res = await userFetch("/user/profile", {
                                    method: "PUT",
                                    body: JSON.stringify({ displayName: pendingDisplayName }),
                                });
                                if (res.ok) {
                                    try { localStorage.removeItem(pendingKey); } catch { /* ignore */ }
                                }
                            }
                        } catch {
                            /* プロフィール作成失敗してもログインは成功させる — /user/profile から再設定できる */
                        }
                    })();
                }
                track("login", { method: "email" });
                showToast("ログインしました", "success");
                // インスタ風: ログイン後は自分のプロフィールページへ
                // ログインが済んだ画面に戻れても意味が無い（上のエフェクトが
                // すぐ送り返す）ので replace
                router.replace(nextPath ?? (result.userId ? ROUTES.USER_PROFILE(result.userId) : "/"));
            } else if (result.needsVerification) {
                setNeedsVerification(true);
                setError(result.error || "メールアドレスの確認が完了していません");
            } else {
                setError(result.error || "ログインに失敗しました");
            }
        } catch {
            setError("ログイン中に通信エラーが発生しました。時間をおいて再度お試しください。");
        } finally {
            setSubmitting(false);
        }
    };

    const handleForgotSend = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setNotice("");
        setSubmitting(true);
        try {
            const result = await forgotPassword(username.trim());
            if (result.success) {
                setStep("forgot-confirm");
                setNotice("送りました。メールをご確認ください。");
            } else {
                setError(result.error ?? "エラーが発生しました");
            }
        } catch {
            setError("確認コードの送信に失敗しました。通信環境を確認して再度お試しください。");
        } finally {
            setSubmitting(false);
        }
    };

    const handleForgotConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setNotice("");
        // **送る前に見る。** 登録側（`app/signup`）は長さと一致を見ているのに
        // ここは空でなければ送っていた。3文字でも往復して、しかも戻ってくる
        // のは AWS の `InvalidPasswordException` の文言（記号の話が抜けていた）
        // **`.trim()` は保険。** `type="email"` の欄はブラウザ側の
        // 値の正規化で前後の空白が落ちる（jsdom でも実測: `.trim()` を
        // 外してもこの画面のテストは全部通る＝ここは死にコードに近い）。
        // 本当に効かせているのは `signUp` の境界（`lib/auth/cognito.ts`）で、
        // そちらは呼び出し側が何を渡すか分からない。
        if (newPassword.length < 8) {
            setError(PASSWORD_RULE_MESSAGE);
            return;
        }
        setSubmitting(true);
        try {
            // **コードも落とす。** ここは `type="text"` なので、ブラウザ側の
            // 正規化は効かない（`type="email"` の欄とは違う）。メールから
            // 6桁をコピペすると末尾に空白が付くことがあり、そのまま送ると
            // `CodeMismatchException` →「確認コードが正しくありません」で、
            // 利用者は同じものを打ち直す。登録側（`app/signup`）は
            // `code.trim()` に加えて長さまで見ている
            const result = await confirmForgotPassword(username.trim(), resetCode.trim(), newPassword);
            if (result.success) {
                // iOS と同じく、ログインの欄へ戻して案内する（完了だけの画面を挟まない）
                setStep("login");
                setPassword("");
                setResetCode("");
                setNewPassword("");
                setNotice("変えました。新しいパスワードでログインしてください。");
            } else {
                setError(result.error ?? "エラーが発生しました");
            }
        } catch {
            setError("パスワードの再設定に失敗しました。通信環境を確認して再度お試しください。");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <main className="min-h-screen bg-bg">
                <h1 className="sr-only">ログイン</h1>
                {/* 判定中は灰の骨格（iOS `JPLoadingState`・回る輪にしない） */}
                <div className="mx-auto w-full max-w-sm px-6 pt-[250px]"><LoadingState kind="rows" /></div>
            </main>
        );
    }

    // 2026-11-04: iOS `SignInView`（板 SignIn）の形に。**札で囲まない**——写真の帯（380）の下へ溶かし、
    // 帯の上から 250 でワードマークが始まる（帯に 130 食い込む・`SignInLayout.contentOverlap`）。
    // 左寄せ・左右 24・行の間 14。主ボタンは白（写真のある画面）、2番手は線のボタン。
    // 失敗は欄の下に danger の1文（iOS と同じ並び: 欄 → 案内 → エラー → 確認の入口）
    const errorFor = (s: Step) => (error && step === s ? { "aria-invalid": true as const, "aria-describedby": "login-form-error" } : {});
    const field = (id: string, label: string, input: React.ReactNode) => (
        <div>
            <label htmlFor={id} className={SETTINGS_LABEL_CLASS}>{label}</label>
            {input}
        </div>
    );
    const spinner = <span aria-hidden="true" className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />;
    const backToLogin = (
        <button type="button" onClick={() => { setStep("login"); setError(""); setResetCode(""); setNewPassword(""); }}
            disabled={submitting} className={AUTH_OUTLINE_CLASS} style={{ touchAction: "manipulation" }}>
            ログインに戻る
        </button>
    );

    return (
        <main className="relative isolate min-h-screen overflow-hidden bg-black px-6 pt-[250px] pb-16">
            <AuthPhotoBand />

            <div className="relative z-10 mx-auto w-full max-w-sm flex flex-col gap-[14px]" data-testid="login-content">
                {/* 画面の題は読み上げだけ（iOS は大きいワードマークが見出し） */}
                <h1 className="sr-only">
                    {step === "login" ? "ログイン" : step === "forgot-send" ? "パスワードを忘れた" : "確認コードを入力"}
                </h1>
                <AuthBrand />

                {/* ログイン */}
                {step === "login" && (
                    <form onSubmit={handleLogin} className="flex flex-col gap-[14px]">
                        {field("login-email", "メールアドレス", (
                            <input id="login-email" {...errorFor("login")} type="email" value={username}
                                onChange={(e) => setUsername(e.target.value)} required autoComplete="email"
                                placeholder="you@example.com" disabled={submitting} className={SETTINGS_INPUT_CLASS} />
                        ))}
                        {field("login-password", "パスワード", (
                            <input id="login-password" {...errorFor("login")} type="password" value={password}
                                onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
                                disabled={submitting} className={SETTINGS_INPUT_CLASS} />
                        ))}
                        {/* 板: 欄の下に右寄せ・13・白72% */}
                        <div className="flex justify-end -my-2">
                            <button type="button" onClick={() => { setStep("forgot-send"); setError(""); setPassword(""); }}
                                disabled={submitting} className={AUTH_TEXT_BUTTON_CLASS} style={{ touchAction: "manipulation" }}>
                                パスワードを忘れた
                            </button>
                        </div>
                        <button type="submit" disabled={submitting || !username || !password} className={AUTH_PRIMARY_CLASS}
                            style={{ touchAction: "manipulation" }}>
                            {submitting && spinner}
                            {submitting ? "ログインしています…" : "ログイン"}
                        </button>
                        {/* 登録先へ next と via を維持する */}
                        <Link href={signupHref} prefetch={false} className={AUTH_OUTLINE_CLASS} style={{ touchAction: "manipulation" }}>
                            アカウントを作る
                        </Link>
                    </form>
                )}

                {/* パスワードの再設定（iOS `resetSection`）: メールアドレス → コードを送る */}
                {step === "forgot-send" && (
                    <form onSubmit={handleForgotSend} className="flex flex-col gap-[14px]">
                        {field("reset-email", "メールアドレス", (
                            <input id="reset-email" {...errorFor("forgot-send")} type="email" value={username}
                                onChange={(e) => setUsername(e.target.value)} required autoComplete="email"
                                placeholder="you@example.com" disabled={submitting} className={SETTINGS_INPUT_CLASS} />
                        ))}
                        <p className={AUTH_CAPTION_CLASS}>登録したメールアドレスに、確認コードを送ります。</p>
                        <button type="submit" disabled={submitting || !username} className={AUTH_PRIMARY_CLASS}
                            style={{ touchAction: "manipulation" }}>
                            {submitting && spinner}
                            {submitting ? "送っています…" : "コードを送る"}
                        </button>
                        {backToLogin}
                    </form>
                )}

                {/* 確認コードと新しいパスワード */}
                {step === "forgot-confirm" && (
                    <form onSubmit={handleForgotConfirm} className="flex flex-col gap-[14px]">
                        {field("reset-email-fixed", "メールアドレス", (
                            <input id="reset-email-fixed" type="email" autoComplete="email" value={username} readOnly disabled className={SETTINGS_INPUT_CLASS} />
                        ))}
                        {field("reset-code", "確認コード", (
                            <input
                                autoComplete="one-time-code"
                                id="reset-code"
                                {...errorFor("forgot-confirm")}
                                type="text"
                                // 数字だけのコード。登録・設定の確認コードと揃える
                                inputMode="numeric"
                                value={resetCode}
                                onChange={(e) => setResetCode(e.target.value)}
                                required
                                disabled={submitting}
                                className={`${SETTINGS_INPUT_CLASS} tracking-widest`}
                            />
                        ))}
                        {field("reset-new-password", "新しいパスワード", (
                            <input autoComplete="new-password" id="reset-new-password" type="password" value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)} required disabled={submitting}
                                aria-describedby="reset-password-rule" className={SETTINGS_INPUT_CLASS} />
                        ))}
                        <p id="reset-password-rule" className={AUTH_CAPTION_CLASS}>{PASSWORD_RULE_MESSAGE}</p>
                        <button type="submit" disabled={submitting || resetCode.trim().length < 6 || !newPassword}
                            className={AUTH_PRIMARY_CLASS} style={{ touchAction: "manipulation" }}>
                            {submitting && spinner}
                            {submitting ? "変えています…" : "パスワードを変える"}
                        </button>
                        {backToLogin}
                    </form>
                )}

                {/* 案内（iOS `notice`・callout・白72%） */}
                {notice && <p role="status" className="m-0 text-[15px] leading-[22px] text-white/70">{notice}</p>}
                {verified && step === "login" && !notice && (
                    <p role="status" className="m-0 text-[15px] leading-[22px] text-white/70">メールアドレスの確認が完了しました。ログインしてください。</p>
                )}
                {/* エラー（iOS: danger の1文）。欄からは aria-describedby で結ぶ（#491） */}
                {error && (
                    <p role="alert" id="login-form-error" aria-live="assertive" className="m-0 text-[15px] leading-[22px] text-danger">
                        {error}
                    </p>
                )}
                {/* 未確認アカウントへの入口（iOS `verificationOffer`: 一文 → 線のボタン） */}
                {needsVerification && step === "login" && (
                    <div className="flex flex-col gap-[10px]">
                        <p className="m-0 text-[15px] leading-[22px] text-white">確認コードのメールが届いているか確認してください。</p>
                        <Link href={`/signup?email=${encodeURIComponent(username)}`} prefetch={false}
                            className={AUTH_OUTLINE_CLASS} style={{ touchAction: "manipulation" }}>
                            確認コードを入力・再送する
                        </Link>
                    </div>
                )}
            </div>
        </main>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            // **事前描画で焼かれるのはこの fallback。** 空のままだと
            // JS が走る前の HTML に本文が1つも無い（`main` も見出しも0で、
            // 出るのはヘッダーとフッターだけ）。見た目は変えずに、
            // ランドマークと見出しだけ置く——`sr-only` は
            // `position: absolute` なので描画に影響しない
            <main className="min-h-screen bg-bg">
                <h1 className="sr-only">ログイン</h1>
            </main>
        }>
            <LoginForm />
        </Suspense>
    );
}
