"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { signUp, confirmSignUp, resendConfirmationCode } from "../../lib/auth/cognito";
import { pendingNameKey, pendingVerifyKey } from "../../lib/utils/pendingName";
import { safeNextPath } from "../../lib/routes";
import { SETTINGS_INPUT_CLASS, SETTINGS_LABEL_CLASS, AUTH_PRIMARY_CLASS, AUTH_OUTLINE_CLASS, AUTH_TEXT_BUTTON_CLASS, AUTH_CAPTION_CLASS } from "../components/accountFormStyles";
import { AuthPhotoBand, AuthBrand } from "../components/AuthPhotoBand";
import { LoadingState } from "../components/StateViews";
import { track, signupFromVia, type SignupFrom } from "../../lib/utils/analytics";

type Step = "register" | "verify" | "done";


const PENDING_TTL = 24 * 60 * 60 * 1000;

/**
 * 控えた UUID を捨ててよい再送の失敗。**一時的な失敗を入れてはいけない**
 * （`LimitExceededException`・通信断は残して押し直させる）。
 *   NotAuthorizedException    … 無効化された／もう確認済み
 *   UserNotFoundException     … そんなユーザーは居ない（消された等）
 *   InvalidParameterException … 確認済み（"User is already confirmed."）
 *
 * **どの例外がどの状態かは、この環境から本物の Cognito で確かめられて
 * いない**（ネットワークが遮断されている）。3つとも入れてあるので
 * 挙動は変わらないが、名前と説明の対応はそのまま信じないこと。
 *
 * **足りない側に倒す。** 足りなければ控えが残り、24時間の TTL で
 * 自然に回復する（元の形と同じ）。多すぎると、直したはずの
 * 「確認画面に二度と戻れない」がそのまま戻る。
 */
const PERMANENT_RESEND_FAILURES = new Set([
    "NotAuthorizedException",
    "UserNotFoundException",
    "InvalidParameterException",
]);

function savePending(em: string, username: string, from: SignupFrom) {
    // `from`（どこから登録に来たか）も控える。確認コードの入力へは、ログイン画面の
    // 「確認コードを入力・再送する」から `via` 無しで戻ってくることがある（#432）
    try { localStorage.setItem(pendingVerifyKey(em), JSON.stringify({ username, t: Date.now(), from })); } catch { /* ignore */ }
}
/** 控えた `from`。無い・読めないときは null（呼ぶ側が URL の値を使う） */
function loadPendingFrom(em: string): SignupFrom | null {
    try {
        const raw = localStorage.getItem(pendingVerifyKey(em));
        const from = raw ? (JSON.parse(raw) as { from?: unknown })?.from : null;
        return from === "wish" || from === "other" ? from : null;
    } catch { return null; }
}
function loadPending(em: string): string | null {
    try {
        const raw = localStorage.getItem(pendingVerifyKey(em));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const { username, t } = parsed as Record<string, unknown>;
        if (typeof username !== "string" || typeof t !== "number") return null;
        if (Date.now() - t > PENDING_TTL) { localStorage.removeItem(pendingVerifyKey(em)); return null; }
        return username;
    } catch { return null; }
}
function clearPending(em: string) {
    try { localStorage.removeItem(pendingVerifyKey(em)); } catch { /* ignore */ }
}

function SignupForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    // **戻り先を登録の向こう側まで運ぶ。** 招待リンク（`/j?t=…`）で来た
    // 未登録の人は、ログイン画面の「新規登録」を押した時点で `next` を
    // 落としていた——登録を終えると必ず自分の空プロフィールに着地し、
    // 招待に戻る手段が履歴しか無かった。**招待から入った新規ユーザーが
    // いちばん最後で必ず落ちる**形。値は `safeNextPath` に通す
    // （外へ飛ばす値を素通しすると、この画面がオープンリダイレクトの
    // 踏み台になる。`safeNextPath` は過去に2回抜かれている）
    const nextPath = safeNextPath(searchParams?.get("next"));
    // 確認が済んだことをログイン画面のバナーに伝える。**`verified=1` を
    // 付ける箇所がリポジトリに1つも無く**、バナーは死んだ画面だった
    // （テストは自前で `verified=1` を作っていたので気づけない）
    const loginHref = `/login?verified=1${nextPath ? `&next=${encodeURIComponent(nextPath)}` : ""}`;
    // 登録の画面に来た理由（「行きたい」から＝`via=wish`。登録までの数え方・#432）
    const fromUrl = signupFromVia(searchParams?.get("via"));
    const { isAuthenticated, loading } = useAuth();
    const { showToast } = useToast();

    const [step, setStep] = useState<Step>("register");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [code, setCode] = useState("");
    const [cognitoUsername, setCognitoUsername] = useState(""); // signUp が返す UUID
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    // 控えから戻したときの `from`（URL に `via` が無い回のため）
    const [pendingFrom, setPendingFrom] = useState<SignupFrom | null>(null);
    const from: SignupFrom = fromUrl === "wish" ? "wish" : (pendingFrom ?? fromUrl);

    // ログイン済みならトップへ
    useEffect(() => {
        // **戻り先があればそこへ。** `/login` 側は `nextPath ?? …` を見るのに
        // ここだけトップへ流していた——招待リンクから来た人が既にログイン
        // 済みだった場合、その場で行き先を失う
        if (!loading && isAuthenticated) router.replace(nextPath ?? "/");   // 済んだ画面は履歴に残さない
    }, [isAuthenticated, loading, router, nextPath]);

    // URLパラメータ or localStorage から verify ステップを復元
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const emailParam = params.get("email");
        if (!emailParam) return;
        const savedUsername = loadPending(emailParam);
        if (savedUsername) {
            setEmail(emailParam);
            setCognitoUsername(savedUsername);
            setPendingFrom(loadPendingFrom(emailParam));
            setStep("verify");
        } else {
            setEmail(emailParam);
        }
    }, []);

    // 再送クールダウンタイマー
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const t = setTimeout(() => setResendCooldown((v) => v - 1), 1000);
        return () => clearTimeout(t);
    }, [resendCooldown]);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password !== confirmPassword) {
            setError("パスワードが一致しません");
            return;
        }
        if (password.length < 8) {
            setError("パスワードは8文字以上で入力してください");
            return;
        }

        setSubmitting(true);
        try {
            const result = await signUp(email, password);
            if (result.success && result.username) {
                savePending(email, result.username, from);
                if (displayName.trim()) {
                    // メールアドレスで区切る。
                    // 以前はグローバルな1キーだったので、登録を途中でやめた人の
                    // 表示名がそのまま残り、**次にその端末でログインした別人**の
                    // プロフィールに付いていた（共有のiPadなどで起きる）。
                    // 本人にはどこから来た名前なのか分からない。
                    try {
                        localStorage.setItem(pendingNameKey(email), displayName.trim());
                    } catch { /* ignore */ }
                }
                setCognitoUsername(result.username);
                setStep("verify");
                setResendCooldown(60);
            } else if (result.aliasExists) {
                // 登録済みだが未確認の場合、localStorage から UUID を復元して verify へ
                const savedUsername = loadPending(email);
                if (savedUsername) {
                    const resendResult = await resendConfirmationCode(savedUsername);
                    // **捨てるのは「この控えはもう使えない」ときだけ。**
                    //
                    // 「失敗したら捨てる」にしたら、`LimitExceededException`
                    // （再送の回数制限）や通信断でも唯一の手がかりを捨てて
                    // いた——**確認画面に二度と戻れない**（登録し直しても
                    // 「すでに登録されています」で終わり、未確認なので
                    // パスワード再設定も効かない）。24時間で TTL が切れて
                    // 自然に回復する元の形より悪い。
                    //
                    // 恒久的に効かないのは「その UUID がもう確認済み／存在
                    // しない」場合だけ。一時的な失敗では残して押し直させる。
                    if (PERMANENT_RESEND_FAILURES.has(resendResult.code ?? "")) clearPending(email);
                    if (resendResult.success) {
                        setCognitoUsername(savedUsername);
                        setStep("verify");
                        showToast("確認コードを再送しました", "success");
                        setResendCooldown(60);
                    } else {
                        setError("このメールアドレスはすでに登録されています。ログインするか、パスワードリセットをお試しください。");
                    }
                } else {
                    setError("このメールアドレスはすでに登録されています。ログインするか、パスワードリセットをお試しください。");
                }
            } else {
                setError(result.error ?? "登録に失敗しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            // サーバーの数（PostConfirmation のログ）と GA4 の数に、同じ出どころを渡す（#432）
            const result = await confirmSignUp(cognitoUsername, code.trim(), { platform: "web", from });
            if (result.success) {
                // もう確認済みだった回（`alreadyConfirmed`）は数えない（同じ人を二度数える）
                if (!result.alreadyConfirmed) track("sign_up", { method: "email", from });
                clearPending(email);
                setStep("done");
            } else {
                setError(result.error ?? "確認に失敗しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleResend = async () => {
        if (resendCooldown > 0 || resending) return;
        setResending(true);
        try {
            const result = await resendConfirmationCode(cognitoUsername);
            if (result.success) {
                showToast("確認コードを再送しました", "success");
                setResendCooldown(60);
            } else {
                setError(result.error ?? "再送に失敗しました");
            }
        } finally {
            setResending(false);
        }
    };

    if (loading) {
        return (
            <main className="min-h-screen bg-bg">
                <h1 className="sr-only">アカウント作成</h1>
                {/* 判定中は灰の骨格（iOS `JPLoadingState`・回る輪にしない） */}
                <div className="mx-auto w-full max-w-sm px-6 pt-[250px]"><LoadingState kind="rows" /></div>
            </main>
        );
    }

    // 2026-11-04: ログインと同じ形に（iOS はログインと登録が同じ画面の切り替え・`SignInView` の `.signUp`）。
    // 写真の帯の下に直に置き、札で囲まない。主ボタンは白、2番手は線の「ログインに戻る」。
    // 欄の順は iOS と同じ メールアドレス → パスワード →（Web だけの確認の欄）→ 表示名
    const invalid = (s: Step) => (error && step === s ? { "aria-invalid": true as const, "aria-describedby": "signup-form-error" } : {});
    const spinner = <span aria-hidden="true" className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />;
    const field = (id: string, label: string, input: React.ReactNode, after?: React.ReactNode) => (
        <div>
            <label htmlFor={id} className={SETTINGS_LABEL_CLASS}>{label}</label>
            {input}
            {after}
        </div>
    );

    return (
        <main className="relative isolate min-h-screen overflow-hidden bg-black px-6 pt-[250px] pb-16">
            <AuthPhotoBand />

            <div className="relative z-10 mx-auto w-full max-w-sm flex flex-col gap-[14px]" data-testid="signup-content">
                {/* 画面の題は読み上げだけ（iOS は大きいワードマークが見出し） */}
                <h1 className="sr-only">
                    {step === "register" && "アカウント作成"}
                    {step === "verify" && "メールを確認"}
                    {step === "done" && "登録完了"}
                </h1>
                <AuthBrand />

                {/* ステップ1: 登録 */}
                {step === "register" && (
                    <form onSubmit={handleRegister} className="flex flex-col gap-[14px]">
                        {field("signup-email", "メールアドレス", (
                            <input id="signup-email" {...invalid("register")} type="email" value={email}
                                onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
                                placeholder="you@example.com" disabled={submitting} className={SETTINGS_INPUT_CLASS} />
                        ))}
                        {field("signup-password", "パスワード", (
                            <input
                                id="signup-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                disabled={submitting}
                                // **条件の文は、欄に結ばないと読み上げに届かない。**
                                // ラベルは「パスワード」としか言わないので、満たすべき
                                // 条件を一度も言われないまま弾かれる（新規登録の唯一の進み方）
                                aria-describedby={error && step === "register" ? "signup-password-rule signup-form-error" : "signup-password-rule"}
                                aria-invalid={error && step === "register" ? true : undefined}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        ), (
                            <p id="signup-password-rule" className={`mt-1.5 ${AUTH_CAPTION_CLASS}`}>英大文字・小文字・数字・記号（!@#$など）をそれぞれ1文字以上含めてください</p>
                        ))}
                        {field("signup-password-confirm", "パスワード（確認）", (
                            <input id="signup-password-confirm" {...invalid("register")} type="password" value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password"
                                disabled={submitting} className={SETTINGS_INPUT_CLASS} />
                        ))}
                        {field("signup-display-name", "表示名（あとで変えられます）", (
                            <input id="signup-display-name" type="text" value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname"
                                maxLength={50} disabled={submitting} className={SETTINGS_INPUT_CLASS} />
                        ))}

                        <button type="submit" disabled={submitting || !email || !password || !confirmPassword}
                            className={AUTH_PRIMARY_CLASS} style={{ touchAction: "manipulation" }}>
                            {submitting && spinner}
                            {submitting ? "送っています…" : "登録する"}
                        </button>
                        <Link href={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"} prefetch={false}
                            className={AUTH_OUTLINE_CLASS} style={{ touchAction: "manipulation" }}>
                            ログインに戻る
                        </Link>
                    </form>
                )}

                {/* ステップ2: 確認コード（iOS `confirmSignUpSection`） */}
                {step === "verify" && (
                    <form onSubmit={handleVerify} className="flex flex-col gap-[14px]">
                        <p className="m-0 text-[15px] leading-[22px] text-white/70">{email} に確認コードを送信しました</p>
                        {field("signup-code", "確認コード", (
                            <input
                                autoComplete="one-time-code"
                                id="signup-code"
                                {...invalid("verify")}
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                required
                                inputMode="numeric"
                                disabled={submitting}
                                className={`${SETTINGS_INPUT_CLASS} tracking-[0.3em]`}
                                maxLength={6}
                            />
                        ))}
                        <button type="submit" disabled={submitting || code.trim().length < 6}
                            className={AUTH_PRIMARY_CLASS} style={{ touchAction: "manipulation" }}>
                            {submitting && spinner}
                            {submitting ? "確認しています…" : "登録を完了する"}
                        </button>
                        {/* **届かないときの出口**と戻り道（iOS: 13・白72% の文字ボタン） */}
                        <div className="flex items-center justify-between">
                            <button type="button"
                                onClick={() => { setStep("register"); setError(""); setCode(""); setResendCooldown(0); }}
                                className={AUTH_TEXT_BUTTON_CLASS} style={{ touchAction: "manipulation" }}>
                                戻る
                            </button>
                            <button type="button" onClick={handleResend} disabled={resendCooldown > 0 || resending}
                                className={AUTH_TEXT_BUTTON_CLASS} style={{ touchAction: "manipulation" }}>
                                {resendCooldown > 0
                                    ? `再送（${resendCooldown}秒後）`
                                    : resending ? "送っています…" : "コードを送り直す"}
                            </button>
                        </div>
                    </form>
                )}

                {/* ステップ3: 完了 */}
                {step === "done" && (
                    <div className="flex flex-col gap-[14px]">
                        <p className="m-0 text-[15px] leading-[22px] text-white/70">
                            登録が完了しました。ログインして写真のアップロードをお楽しみください。
                        </p>
                        <Link href={loginHref} prefetch={false} className={AUTH_PRIMARY_CLASS} style={{ touchAction: "manipulation" }}>
                            ログインする
                        </Link>
                    </div>
                )}

                {/* エラー（iOS: 欄の下に danger の1文）。欄からは aria-describedby で結ぶ */}
                {error && (
                    <p role="alert" id="signup-form-error" aria-live="assertive" className="m-0 text-[15px] leading-[22px] text-danger">
                        {error}
                    </p>
                )}
            </div>
        </main>
    );
}

export default function SignupPage() {
    // `useSearchParams` は Suspense の中で使う（静的書き出しの前提。
    // `/login`・`/users`・`/j` も同じ形）
    return (
        <Suspense fallback={
            // **事前描画で焼かれるのはこの fallback。** 空のままだと
            // JS が走る前の HTML に本文が1つも無い（`main` も見出しも0で、
            // 出るのはヘッダーとフッターだけ）。見た目は変えずに、
            // ランドマークと見出しだけ置く——`sr-only` は
            // `position: absolute` なので描画に影響しない
            <main className="min-h-screen bg-bg">
                <h1 className="sr-only">アカウント作成</h1>
            </main>
        }>
            <SignupForm />
        </Suspense>
    );
}
