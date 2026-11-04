"use client";

/**
 * 利用規約・プライバシーポリシー（iOS `LegalLinksView`）。設定の「ヘルプと規約」の1行から開く。
 * 中身はサイトの頁（`/terms`・`/privacy`）。iOS と同じく、リンクは黒地なので真鍮。
 */

import React from "react";
import { useLocale } from "../../../i18n/context";
import { ROUTES } from "../../../../lib/routes";
import { SettingsGroup, SettingsRowLink, SettingsShell } from "../SettingsParts";

export default function LegalLinksPage() {
    const { locale } = useLocale();
    const en = locale === "en";
    return (
        <SettingsShell
            title={en ? "Terms & Privacy" : "利用規約・プライバシーポリシー"}
            back={{ href: ROUTES.SETTINGS, label: en ? "Settings" : "設定" }}
        >
            <SettingsGroup>
                <SettingsRowLink href={ROUTES.TERMS} title={en ? "Terms of Use" : "利用規約"} color="accent" />
                <SettingsRowLink href={ROUTES.PRIVACY} title={en ? "Privacy Policy" : "プライバシーポリシー"} color="accent" />
            </SettingsGroup>
        </SettingsShell>
    );
}
