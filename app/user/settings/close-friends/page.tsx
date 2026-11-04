"use client";

/**
 * 親しい友達（iOS `CloseFriendsView`・板 `CloseFriends.dc.html`）。
 * 2026-11-04: 設定の中に一覧ごと開いていたのを、iOS と同じく設定の行 → この画面にした。
 * 中身（選ぶ・探す・保存）は今までの部品（`CloseFriends`）をそのまま使う。
 */

import React from "react";
import { useAuth } from "../../../auth/context";
import { useLocale } from "../../../i18n/context";
import { ROUTES } from "../../../../lib/routes";
import { SettingsShell } from "../SettingsParts";
import CloseFriends from "../CloseFriends";

export default function CloseFriendsPage() {
    const { userId } = useAuth();
    const { locale } = useLocale();
    const en = locale === "en";
    return (
        <SettingsShell
            title={en ? "Close friends" : "親しい友達"}
            back={{ href: ROUTES.SETTINGS, label: en ? "Settings" : "設定" }}
        >
            {userId && <CloseFriends locale={en ? "en" : "ja"} userId={userId} />}
        </SettingsShell>
    );
}
