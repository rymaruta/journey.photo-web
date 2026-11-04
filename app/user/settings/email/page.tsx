"use client";

/**
 * メールアドレスを変える（Web だけの口・2026-11-04 に設定の下の画面へ移した）。
 *
 * **メールがログインID**（プールの `AliasAttributes` が email）なので、変える手段が無いと
 * 「メールを変えた人はアカウントごと失う」——退会して作り直す以外に無く、写真・いいね・
 * フォロワー・共有したURLが全部消えていた。iOS の設定には無いが、Web では外さない。
 *
 * **2段**——新しいアドレスにコードを送り、そのコードで確定する。確定するまで古いアドレスで
 * ログインできる（プールの `AttributesRequireVerificationBeforeUpdate` が効いている。
 * 本番に入っていることは `diagnose` で実測した）。中身は設定に1枚で並べていたものをそのまま移した。
 */

import React, { useEffect, useState } from "react";
import { useLocale } from "../../../i18n/context";
import { useToast } from "../../../../lib/hooks/useToast";
import { ROUTES } from "../../../../lib/routes";
import { getCurrentEmail, startEmailChange, confirmEmailChange } from "../../../../lib/auth/cognito";
import { SettingsShell } from "../SettingsParts";
import { SETTINGS_INPUT_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_CLASS } from "../formStyles";

export default function ChangeEmailPage() {
    const { locale } = useLocale();
    const en = locale === "en";
    const { showToast } = useToast();

    // **「まだ」と「読めなかった」を分ける。** `getCurrentEmail()` は失敗しても
    // `null` を返すので、初期値と同じにすると**「読み込み中」のまま永久に止まる**
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    const [emailLoad, setEmailLoad] = useState<"loading" | "ok" | "failed">("loading");
    const [newEmail, setNewEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    // コードを送った先。**送ったアドレスを覚えておく**——欄を書き換えられても「どこに届いたか」を言い続けるため
    const [emailPending, setEmailPending] = useState<string | null>(null);
    const [emailBusy, setEmailBusy] = useState(false);

    // いま登録されているアドレスを出す（何から何に変えるのかが分からないと押せない）。
    // **変えたあとは読み直さない**——ID トークンは作られた時点の写しで、
    // 次に更新されるまで古い値のまま（`getCurrentEmail` のコメントを見よ）
    useEffect(() => {
        let aborted = false;
        void (async () => {
            const e = await getCurrentEmail();
            if (aborted) return;
            setCurrentEmail(e);
            setEmailLoad(e ? "ok" : "failed");
        })();
        return () => { aborted = true; };
    }, []);

    const handleStartEmailChange = async () => {
        if (emailBusy) return;
        const next = newEmail.trim();
        // 送る前に断れるものだけ断る（形の細かい判定はサーバーに任せる）
        if (!next) return;
        // 読めていない（`currentEmail` が null）ときは、空でない文字列がそれと等しくなることは無いので**そのまま素通りする**
        if (next === currentEmail) {
            showToast(en ? "That is already your email address." : "いまのメールアドレスと同じです", "error");
            return;
        }
        setEmailBusy(true);
        try {
            const result = await startEmailChange(next);
            if (!result.success) {
                showToast(result.error || (en ? "Failed to send the code." : "確認コードを送れませんでした"), "error");
                return;
            }
            setEmailPending(next);
            setEmailCode("");
            showToast(en
                ? `A confirmation code was sent to ${next}. Your current address still works until you confirm.`
                : `${next} に確認コードを送りました。確定するまでは、いまのアドレスでログインできます`, "success");
        } finally {
            setEmailBusy(false);
        }
    };

    const handleConfirmEmailChange = async () => {
        if (emailBusy || !emailCode.trim()) return;
        setEmailBusy(true);
        try {
            const result = await confirmEmailChange(emailCode);
            if (!result.success) {
                showToast(result.error || (en ? "Failed to change your email." : "メールアドレスを変更できませんでした"), "error");
                return;
            }
            // **自分が知っている新しい値を出す**（トークンはまだ古い）
            setCurrentEmail(emailPending);
            setEmailLoad("ok");
            setEmailPending(null);
            setNewEmail("");
            setEmailCode("");
            showToast(en
                ? "Your email address has been changed. Use it to sign in from now on."
                : "メールアドレスを変更しました。次からはこのアドレスでログインしてください", "success");
        } finally {
            setEmailBusy(false);
        }
    };

    const spinner = <span aria-hidden="true" className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />;
    return (
        <SettingsShell
            title={en ? "Change email address" : "メールアドレスを変える"}
            back={{ href: ROUTES.SETTINGS, label: en ? "Settings" : "設定" }}
            intro={<>
                {en ? "Sign-in address" : "ログインに使うアドレス"}:{" "}
                <span className="text-white">{currentEmail ?? (emailLoad === "failed"
                    ? (en ? "(couldn't read it — you can still change it below)" : "（読み取れませんでした。下から変更はできます）")
                    : (en ? "(loading)" : "（読み込み中）"))}</span>
            </>}
        >
            <div className="flex flex-col gap-4">
                {emailPending === null ? (
                    <>
                        <div>
                            <label className={SETTINGS_LABEL_CLASS} htmlFor="settings-new-email">
                                {en ? "New email address" : "新しいメールアドレス"}
                            </label>
                            <input
                                id="settings-new-email"
                                type="email"
                                // **本人の連絡先**なので `email`（パスワード管理を汚さない）
                                autoComplete="email"
                                inputMode="email"
                                aria-describedby="settings-email-note"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                disabled={emailBusy}
                                className={SETTINGS_INPUT_CLASS}
                            />
                            <p id="settings-email-note" className="mt-1.5 px-1 text-xs text-text-3 leading-relaxed">
                                {en
                                    ? "We'll send a confirmation code to the new address. Your current address keeps working until you confirm."
                                    : "新しいアドレスに確認コードを送ります。確定するまでは、いまのアドレスでログインできます"}
                            </p>
                        </div>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => void handleStartEmailChange()}
                                disabled={emailBusy || !newEmail.trim()}
                                className={SETTINGS_PRIMARY_CLASS}
                                style={{ touchAction: "manipulation" }}
                            >
                                {emailBusy && spinner}
                                {en ? "Send confirmation code" : "確認コードを送る"}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <label className={SETTINGS_LABEL_CLASS} htmlFor="settings-email-code">
                                {en ? `Code sent to ${emailPending}` : `${emailPending} に送ったコード`}
                            </label>
                            <input
                                id="settings-email-code"
                                type="text"
                                // 届いたコードを自動で入れられるようにする
                                autoComplete="one-time-code"
                                inputMode="numeric"
                                value={emailCode}
                                onChange={(e) => setEmailCode(e.target.value)}
                                disabled={emailBusy}
                                className={SETTINGS_INPUT_CLASS}
                            />
                        </div>
                        <div className="pt-2 flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={() => void handleConfirmEmailChange()}
                                disabled={emailBusy || !emailCode.trim()}
                                className={SETTINGS_PRIMARY_CLASS}
                                style={{ touchAction: "manipulation" }}
                            >
                                {emailBusy && spinner}
                                {en ? "Change email address" : "メールアドレスを変更する"}
                            </button>
                            {/* **やめる道を残す。** コードが届かない／打ち間違えた人がここで詰まると、画面から出るしか無くなる */}
                            <button
                                type="button"
                                onClick={() => { setEmailPending(null); setEmailCode(""); }}
                                disabled={emailBusy}
                                className="w-full min-h-[44px] text-[13px] text-text-2 hover:text-white transition disabled:opacity-40"
                                style={{ touchAction: "manipulation" }}
                            >
                                {en ? "Cancel and use a different address" : "やめる（別のアドレスにする）"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </SettingsShell>
    );
}
