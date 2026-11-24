"use client";

/**
 * ブロックした人（iOS `BlockedUsersView`・板 `BlockedUsers.dc.html`）。
 * 2026-11-04: 設定の中に一覧ごと開いていたのを、iOS と同じく設定の行 → この画面にした。
 * 中身（読み込み・解除・失敗の言い方）は今までの部品（`BlockedUsers`）をそのまま使う。
 */

import React from "react";
import { useLocale } from "../../../i18n/context";
import { ROUTES } from "../../../../lib/routes";
import { SettingsShell } from "../SettingsParts";
import BlockedUsers from "../BlockedUsers";

export default function BlockedUsersPage() {
    const { locale } = useLocale();
    const en = locale === "en";
    return (
        <SettingsShell
            title={en ? "Blocked people" : "ブロックした人"}
            back={{ href: ROUTES.SETTINGS, label: en ? "Settings" : "設定" }}
            // 板の説明。iOS のほかの入口（通報・プロフィール）と同じ言い方
            intro={en
                ? "Blocking hides each other's posts, stories and notifications."
                : "ブロックすると、おたがいの投稿・ストーリー・通知が見えなくなります。"}
        >
            <BlockedUsers locale={en ? "en" : "ja"} />
        </SettingsShell>
    );
}
