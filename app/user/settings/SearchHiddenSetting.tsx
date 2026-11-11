"use client";

/**
 * 設定の「公開範囲とプライバシー」の1行: **検索エンジンにプロフィールを表示しない**
 * （2026-11-11 owner 承認・journey.photo-ios#526。iOS の設定の同じ行と対）。
 *
 * - `PUT /user/profile` の `searchHidden`（真偽だけ）。**既定はオフ＝表示する**
 * - 効くのは静的サイトの `/users/<id>`（noindex・sitemap から外す・構造化データを出さない）。
 *   保存でサイトの作り直しが走る（`api-user/src/profileUpdate.ts`）
 * - 確かめのダイアログは出さない（取り消せる操作。CLAUDE.md「聞く・選ばせるのは最小に」）
 * - 読めなかったときは行を出さない（今の値が分からないまま切り替えさせない）
 */

import React, { useEffect, useRef, useState } from "react";
import { userFetch, sessionErrorMessage } from "../../../lib/utils/api";
import { usableObject } from "../../../lib/utils/apiRows";
import { SettingsNote, SettingsToggleRow } from "./SettingsParts";

export default function SearchHiddenSetting({ locale }: { locale: "ja" | "en" }) {
    const en = locale === "en";
    /** null = まだ・読めなかった → 何も描かない */
    const [hidden, setHidden] = useState<boolean | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const busy = useRef(false);

    useEffect(() => {
        let live = true;
        void (async () => {
            try {
                const res = await userFetch("/user/profile");
                if (!res.ok || !live) return;
                const p = usableObject<Record<string, unknown>>(await res.json().catch(() => null), "GET /user/profile");
                if (!p || !live) return;
                // 本人の応答には常に真偽で載る。無ければ既定（表示する）
                setHidden(p.searchHidden === true);
            } catch { /* 読めなければ行を出さない */ }
        })();
        return () => { live = false; };
    }, []);

    if (hidden === null) return null;

    const toggle = async () => {
        if (busy.current) return;
        busy.current = true;
        const before = hidden;
        const next = !before;
        setHidden(next);
        setSaving(true);
        setError(null);
        try {
            const res = await userFetch("/user/profile", { method: "PUT", body: JSON.stringify({ searchHidden: next }) });
            if (!res.ok) throw new Error(String(res.status));
        } catch (e) {
            // 送れなければ元に戻す（隠したつもりで出ている、を作らない）
            setHidden(before);
            setError(sessionErrorMessage(e)
                ?? (en ? "Couldn't change this. Please try again." : "切り替えられませんでした。もう一度お試しください。"));
        } finally {
            busy.current = false;
            setSaving(false);
        }
    };

    return (
        <>
            <SettingsToggleRow
                label={en ? "Hide my profile from search engines" : "検索エンジンにプロフィールを表示しない"}
                detail={en
                    ? "Your profile page won't appear in Google and other search results. Your photos keep their own sharing settings."
                    : "Google などの検索結果に、あなたのプロフィールのページを出さないようにします。写真ごとの公開の設定は変わりません。"}
                on={hidden}
                disabled={saving}
                onToggle={() => void toggle()}
                testId="settings-search-hidden"
            />
            {error && <SettingsNote role="alert" tone="danger">{error}</SettingsNote>}
        </>
    );
}
