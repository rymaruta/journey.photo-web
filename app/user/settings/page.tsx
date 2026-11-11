"use client";

/**
 * 設定（iOS `SettingsView`・板 `Settings.dc.html`。2026-11-04 に iOS の今の並びと形へそろえた）。
 *
 * ## 並び（iOS `SettingsOutline` と同じ順・Web に在るものだけ）
 *
 *     Pro                   名前の横のバッジと Pro マーク（/user/badges）・光と天気の知らせ（Pro の人だけ）
 *     旅の道具              共同アルバム・旅行プラン
 *     公開範囲とプライバシー ブロックした人 → 下の画面・親しい友達 → 下の画面
 *     写真と撮影            いいねした写真・構図一覧
 *     ヘルプと規約          利用規約・プライバシーポリシー → 下の画面・問い合わせ（宛先があるときだけ）
 *     アカウント            メールアドレスを変える（Web だけ）・パスワードを変える → 下の画面
 *     （見出しなし）         ログアウト
 *     （見出しなし）         アカウントの削除（名前ごと danger・退会の窓を開く）
 *
 * 形は真鍮の眉ラベル＋札、行は最小 54（`SettingsParts.tsx`）。
 *
 * ## iOS にあって置かなかったもの（Web に中身が無い）
 *
 *   Journey Photo Pro の行・サポーター証・保存した旅   Web では何も売らない／電波なしの旅はアプリだけ
 *   旅のトランク・キャンピングカー・すれちがい乗車券・すれちがい帳   Web に画面が無い
 *   お知らせ（プッシュ通知）   Web にプッシュを受け取る設定の実装が無い
 *   データとストレージ         操作できる実体が SW の写真キャッシュだけで、消す口は新機能
 *   新しくなったこと・バージョンの行   Web に履歴もバージョン文字列も無い
 *
 * owner の指示「デザインだけ完成して操作できない画面は作らない」に従い、**中身の無い枠は並べない**。
 *
 * ## 設定から外した行（2026-11-04・iOS の設定に無く、マイページに入口がある）
 *
 *   写真の下書き・行きたい場所・ストーリーのアーカイブ・ハイライトの管理
 *   （マイページの「下書き →」「アーカイブ →」・行きたい場所の札・ハイライトの輪の「＋」から開ける）
 *
 * ## 門は `useMemberGate` を使わない（`SettingsShell`）
 *
 * あれは**グループ（投稿権限）まで見る**。登録直後の `AdminAddUserToGroup` が落ちた人は
 * `no-group` になるが、その人にもパスワードの変更と退会は要る——むしろ**権限が付かなかった人ほど
 * 退会したい**。ここはログインしているかどうかだけ見る。
 */

import React, { useRef, useState } from "react";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ROUTES } from "../../../lib/routes";
import { siteConfig } from "../../../lib/utils/seo";
import DeleteAccountModal from "../../components/DeleteAccountModal";
import LightAlertSettings from "./LightAlertSettings";
import SearchHiddenSetting from "./SearchHiddenSetting";
import { SettingsGroup, SettingsRowButton, SettingsRowLink, SettingsShell } from "./SettingsParts";

/** 下の画面の行き先（`ROUTES.SETTINGS` の下） */
export const SETTINGS_SUBPAGES = {
    blocked: `${ROUTES.SETTINGS}/blocked`,
    closeFriends: `${ROUTES.SETTINGS}/close-friends`,
    legal: `${ROUTES.SETTINGS}/legal`,
    email: `${ROUTES.SETTINGS}/email`,
    password: `${ROUTES.SETTINGS}/password`,
} as const;

export default function SettingsPage() {
    const { deleteAccount, logout } = useAuth();
    const { locale } = useLocale();
    const en = locale === "en";
    const { showToast } = useToast();

    // 退会（アカウント削除）
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    // 退会の窓を閉じたときの戻り先（窓の中の autoFocus に奪われるため明示）
    const deleteAccountBtnRef = useRef<HTMLButtonElement | null>(null);
    const [deletingAccount, setDeletingAccount] = useState(false);
    // ログアウトの最中。二度押させず、進み具合を見せる（iOS `isSigningOut`）
    const [signingOut, setSigningOut] = useState(false);

    const handleDeleteAccount = async () => {
        setDeletingAccount(true);
        try {
            const result = await deleteAccount();
            if (result.success) {
                // deleteAccount 内でトップへ遷移済み。トーストで結果を伝える。
                showToast(en ? "Your account has been deleted." : "退会が完了しました。ご利用ありがとうございました。", "success");
            } else {
                showToast(result.error || (en ? "Failed to delete account." : "退会処理に失敗しました。"), "error");
                setShowDeleteModal(false);
            }
        } catch {
            showToast(en ? "Failed to delete account." : "退会処理に失敗しました。", "error");
            setShowDeleteModal(false);
        } finally {
            setDeletingAccount(false);
        }
    };

    const handleLogout = async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            // 終わるとトップへ送られる（`AuthProvider.logout`・ヘッダーのメニューと同じ口）
            await logout();
        } finally {
            setSigningOut(false);
        }
    };
    const busySigningOut = signingOut;

    return (
        <SettingsShell title={en ? "Settings" : "設定"}>
            {/* 板 43 の並び: Pro がいちばん上 */}
            <SettingsGroup title="Pro" testId="settings-pro">
                <SettingsRowLink href={ROUTES.BADGES} title={en ? "Badge & Pro mark next to your name" : "名前の横のバッジと Pro マーク"} />
                <LightAlertSettings locale={en ? "en" : "ja"} />
            </SettingsGroup>

            <SettingsGroup title={en ? "Travel tools" : "旅の道具"}>
                <SettingsRowLink
                    href={ROUTES.ALBUMS}
                    title={en ? "Shared albums" : "共同アルバム"}
                    detail={en ? "Collect photos with your travel companions via an invite link" : "招待リンクで、旅の仲間と写真を集める"}
                />
                <SettingsRowLink
                    href={ROUTES.TRIPS}
                    title={en ? "Trip plans" : "旅行プラン"}
                    detail={en ? "Put the places you want to visit in order" : "行きたい場所を、回る順に並べる"}
                />
            </SettingsGroup>

            <SettingsGroup title={en ? "Sharing & privacy" : "公開範囲とプライバシー"}>
                {/* **解除できる場所がここしか無い**——ストーリーの返信からブロックできるぶん、戻す口が要る */}
                <SettingsRowLink href={SETTINGS_SUBPAGES.blocked} title={en ? "Blocked people" : "ブロックした人"} />
                <SettingsRowLink href={SETTINGS_SUBPAGES.closeFriends} title={en ? "Close friends" : "親しい友達"} />
                {/* 2026-11-11 owner 承認（journey.photo-ios#526）。既定はオフ＝表示する */}
                <SearchHiddenSetting locale={en ? "en" : "ja"} />
            </SettingsGroup>

            <SettingsGroup title={en ? "Photos & shooting" : "写真と撮影"}>
                <SettingsRowLink href={ROUTES.FAVORITES} title={en ? "Liked photos" : "いいねした写真"} />
                <SettingsRowLink
                    href={ROUTES.COMPOSITION}
                    title={en ? "Composition guide" : "構図一覧"}
                    detail={en ? "Explore compositions and illustrated examples" : "構図の説明と作例の配置図を見る"}
                />
            </SettingsGroup>

            <SettingsGroup title={en ? "Help & terms" : "ヘルプと規約"}>
                <SettingsRowLink href={SETTINGS_SUBPAGES.legal} title={en ? "Terms & Privacy" : "利用規約・プライバシーポリシー"} />
                {/* **宛先が空なら行を描かない。** `NEXT_PUBLIC_CONTACT_EMAIL` は `deploy.yml` が直書きで渡していて
                    （`publicEnvWiring.test.ts` が見張る）本番では出るが、それを前提にして押しても何も起きない行を残さない */}
                {siteConfig.contactEmail && (
                    <SettingsRowLink href={`mailto:${siteConfig.contactEmail}`} external title={en ? "Contact" : "問い合わせ"} />
                )}
            </SettingsGroup>

            <SettingsGroup title={en ? "Account" : "アカウント"}>
                {/* メールアドレスの変更は Web だけ（メールがログインID・`email/page.tsx` の注記） */}
                <SettingsRowLink href={SETTINGS_SUBPAGES.email} title={en ? "Change email address" : "メールアドレスを変える"} />
                <SettingsRowLink href={SETTINGS_SUBPAGES.password} title={en ? "Change password" : "パスワードを変える"} />
            </SettingsGroup>

            {/* ログアウトは削除と同じ札に並べない（押し間違い・確認なしで効く）。白い行のまま・矢印なし（iOS） */}
            <SettingsGroup testId="settings-logout">
                <SettingsRowButton
                    title={busySigningOut ? (en ? "Signing out…" : "ログアウトしています…") : (en ? "Log out" : "ログアウト")}
                    onClick={() => void handleLogout()}
                    disabled={busySigningOut}
                    busy={busySigningOut}
                />
            </SettingsGroup>

            {/* アカウントの削除（いちばん下・別の札）。名前ごと danger（#F0565A）・行き先があるので矢印あり（板 v2） */}
            <SettingsGroup testId="settings-delete">
                <SettingsRowButton
                    ref={deleteAccountBtnRef}
                    title={en ? "Delete account" : "アカウントの削除"}
                    color="danger"
                    chevron
                    onClick={() => setShowDeleteModal(true)}
                />
            </SettingsGroup>

            <DeleteAccountModal
                openerRef={deleteAccountBtnRef}
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={() => void handleDeleteAccount()}
                locale={locale}
                deleting={deletingAccount}
            />
        </SettingsShell>
    );
}
