"use client";

/**
 * パスワードを変える（iOS `ChangePasswordView`・板 `ChangePassword.dc.html`・2026-11-04 に設定の下の画面へ移した）。
 *
 * 中身は設定（`/user/settings`）に1枚で並べていたものをそのまま移した。並びは iOS と同じ:
 * 明朝 30 の題 → いまのパスワード → 新しいパスワード（下に決まり）→ 「変える」（写真の無い画面の主ボタン＝真鍮の塗りに墨）。
 *
 * **すべての端末からログアウト**は Web だけの口（iOS に無い）。パスワードを変えても他の端末は
 * ログインしたまま（Cognito は変更で既存のトークンを失効させない）なので、同じ画面の下に置く
 * ——「誰かに入られたかも」と思った人が来るのはここ。消す操作ではないので危ない色にしない。
 */

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "../../../i18n/context";
import { useToast } from "../../../../lib/hooks/useToast";
import { ROUTES } from "../../../../lib/routes";
import {
    changePassword,
    PASSWORD_RULE_MESSAGE,
    getCurrentEmail,
    signOutEverywhere,
} from "../../../../lib/auth/cognito";
import { SettingsGroup, SettingsRowButton, SettingsNote, SettingsShell } from "../SettingsParts";
import { SETTINGS_INPUT_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_CLASS } from "../formStyles";

export default function ChangePasswordPage() {
    const { locale } = useLocale();
    const en = locale === "en";
    const router = useRouter();
    const { showToast } = useToast();

    const [curPassword, setCurPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [changingPassword, setChangingPassword] = useState(false);
    // パスワード管理（キーチェーン）がどのアカウントのパスワードかを知る手がかり（下の <form> の注記）
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    // すべての端末からログアウト。**いまの端末も含む**ので、押した人はここもログインし直しになる（画面でそう言う）
    const [signingOutAll, setSigningOutAll] = useState(false);

    useEffect(() => {
        let aborted = false;
        void getCurrentEmail().then((e) => { if (!aborted) setCurrentEmail(e); });
        return () => { aborted = true; };
    }, []);

    /**
     * **送る前に断るのは、こちらで確かめられる条件だけ。**
     *
     * プールの規則は8文字以上＋英大小・数字・記号（`provision-env.js:410`）だが、
     * **本番のプールが今もその設定かはコードからは確かめられない**——
     * ここで規則を写して厳しく断ると、プールが通すパスワードを画面だけが
     * 拒む側に倒れる。なので長さと空欄と「同じもの」だけ見て、残りは
     * サーバーの `InvalidPasswordException` に言わせる。
     */
    const handleChangePassword = async () => {
        if (changingPassword) return;
        if (!curPassword || !newPassword) return;
        if (newPassword.length < 8) {
            showToast(PASSWORD_RULE_MESSAGE, "error");
            return;
        }
        if (newPassword === curPassword) {
            showToast(en ? "The new password is the same as the current one." : "いまのパスワードと同じです", "error");
            return;
        }
        setChangingPassword(true);
        try {
            const result = await changePassword(curPassword, newPassword);
            if (!result.success) {
                showToast(result.error || (en ? "Failed to change password." : "パスワードを変更できませんでした"), "error");
                return;
            }
            // **打った中身を画面に残さない。** 次に誰かがこの端末を触ったとき、
            // 入力欄に残っていると読める（`type="password"` でも devtools で見える）
            setCurPassword("");
            setNewPassword("");
            // Cognito はパスワードを変えてもいまのトークンを失効させないので、
            // ログインし直す必要は無い。**そう言わないと「他の端末はどうなる？」に
            // 答えられない**ので、そこまで書く
            showToast(en
                ? "Password changed. You stay signed in on this device; other devices stay signed in until their session expires."
                : "パスワードを変更しました。この端末はログインしたままです（他の端末は、そのセッションが切れるまでログインしたままになります）", "success");
        } finally {
            setChangingPassword(false);
        }
    };

    /**
     * **パスワードを変えても他の端末は生きたまま**——Cognito はパスワードの
     * 変更で既存のトークンを失効させない。漏れたかもしれない端末を止める
     * 手段がサイトに1つも無かったので、その口。
     */
    const handleSignOutEverywhere = async () => {
        if (signingOutAll) return;
        setSigningOutAll(true);
        try {
            const result = await signOutEverywhere();
            if (!result.success) {
                showToast(result.error || (en ? "Failed to sign out." : "ログアウトできませんでした"), "error");
                return;
            }
            showToast(en
                ? "Signed out on all devices. Please sign in again."
                : "すべての端末からログアウトしました。もう一度ログインしてください", "success");
            // **ここもログアウトしている**ので、ログイン画面へ送る。
            // 残すと「ログイン中の顔のまま、押すたびに失敗する」状態になる
            router.replace(ROUTES.LOGIN);
        } finally {
            setSigningOutAll(false);
        }
    };

    const title = en ? "Change password" : "パスワードを変える";
    return (
        <SettingsShell title={title} back={{ href: ROUTES.SETTINGS, label: en ? "Settings" : "設定" }}>
            {/* **パスワードの変更は <form> で送り、ユーザー名の欄も置く。**
                iOS のパスワード管理（キーチェーン）は、フォームの送信と
                `autocomplete="username"` の欄を手がかりに「パスワードを
                更新しますか」と聞く。ボタンの onClick だけで送っていた頃は
                新しいパスワードを覚えず、次のログインで古い方が入って失敗した。
                ユーザー名の欄は見せない（`hidden` で支援技術からも外れる。読み取り専用）。 */}
            <form
                className="flex flex-col gap-4"
                onSubmit={(e) => { e.preventDefault(); void handleChangePassword(); }}
            >
                <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={currentEmail ?? ""}
                    readOnly
                    hidden
                    aria-label={en ? "Username" : "ユーザー名"}
                    tabIndex={-1}
                />
                <div>
                    <label className={SETTINGS_LABEL_CLASS} htmlFor="settings-current-password">
                        {en ? "Current password" : "いまのパスワード"}
                    </label>
                    <input
                        id="settings-current-password"
                        type="password"
                        // ブラウザとパスワード管理に「いまのもの」と伝える。付けないと新しい方を保存候補にされる
                        autoComplete="current-password"
                        value={curPassword}
                        onChange={(e) => setCurPassword(e.target.value)}
                        disabled={changingPassword}
                        className={SETTINGS_INPUT_CLASS}
                    />
                </div>
                <div>
                    <label className={SETTINGS_LABEL_CLASS} htmlFor="settings-new-password">
                        {en ? "New password" : "新しいパスワード"}
                    </label>
                    <input
                        id="settings-new-password"
                        type="password"
                        autoComplete="new-password"
                        // **満たせないと進めない条件は、読み上げにも渡す**
                        aria-describedby="settings-password-rule"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={changingPassword}
                        className={SETTINGS_INPUT_CLASS}
                    />
                    {/* 板には無いが残す（iOS も同じ）——決まりを知らずに打つと、送ってから断られる */}
                    <p id="settings-password-rule" className="mt-1.5 px-1 text-xs text-text-3 leading-relaxed">
                        {PASSWORD_RULE_MESSAGE}
                    </p>
                </div>
                <div className="pt-2">
                    <button
                        type="submit"
                        // **押せるのに必ず失敗する形にしない。** 空欄のうちは押しても往復するだけ
                        disabled={changingPassword || !curPassword || !newPassword}
                        className={SETTINGS_PRIMARY_CLASS}
                        style={{ touchAction: "manipulation" }}
                    >
                        {changingPassword && <span aria-hidden="true" className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />}
                        {changingPassword ? (en ? "Changing…" : "変えています…") : (en ? "Change" : "変える")}
                    </button>
                </div>
            </form>

            <SettingsGroup title={en ? "Other devices" : "ほかの端末"}>
                <SettingsRowButton
                    title={signingOutAll
                        ? (en ? "Signing out…" : "ログアウトしています…")
                        : (en ? "Sign out on all devices" : "すべての端末からログアウトする")}
                    onClick={() => void handleSignOutEverywhere()}
                    disabled={signingOutAll}
                    busy={signingOutAll}
                    testId="settings-sign-out-all"
                />
                <SettingsNote>
                    {en
                        ? "Signs out everywhere, including this device. Use this if you changed your password because you think someone else got in — a password change alone does not sign other devices out."
                        : "この端末を含め、すべての端末からログアウトします。パスワードを変えただけでは他の端末はログインしたままなので、誰かに入られたかもしれないときはこちらも押してください"}
                </SettingsNote>
            </SettingsGroup>
        </SettingsShell>
    );
}
