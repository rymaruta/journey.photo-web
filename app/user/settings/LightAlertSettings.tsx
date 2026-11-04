"use client";

/**
 * 設定の **Pro の節**: 光と天気の知らせ（iOS の `LightAlertSettingsRows`・2026-10-11 owner）。
 *
 * 1. 「光と天気の知らせ」の行 → 一覧（`/user/light`）
 * 2. 「前の晩に知らせる」の入切 → `PUT /user/profile` の `lightAlert`（既定 受け取る）
 *
 * **Pro でない人には行を出さない**（節「Pro」は設定の画面が組む・2026-11-04）。 Web では何も売らない（購入へ案内しない）ので、
 * iOS の「Pro でなければ案内を開く」は持ってこない。Pro かどうかは自分のプロフィールの
 * `pro`（`GET /user/profile`。本人の応答は印を外していても資格のまま——`userProfile.ts` の
 * `withBadgeFields`）で見る。読めなかったときも出さない（出して 403 を踏ませない）。
 *
 * 2026-10-11 判断: 設定の板（Settings）では入切は「お知らせ」の節にあるが、Web の設定には
 * お知らせの節が無い（ファイル冒頭の「置かなかった節」）。iOS と同じく一覧を開く行と並べて
 * Pro の節に置いた。設定の画面（`page.tsx`）への変更は1行にとどめる（別の枝が同じ画面を触るため）。
 */

import React, { useEffect, useRef, useState } from "react";
import { userFetch, sessionErrorMessage } from "../../../lib/utils/api";
import { usableObject } from "../../../lib/utils/apiRows";
import { ROUTES } from "../../../lib/routes";
import { SettingsNote, SettingsRowLink } from "./SettingsParts";

export default function LightAlertSettings({ locale }: { locale: "ja" | "en" }) {
    const en = locale === "en";
    /** false = まだ・Pro でない・読めなかった → 何も描かない */
    const [pro, setPro] = useState(false);
    const [wants, setWants] = useState(true);
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
                setPro(p.pro === true);
                // 本人の応答には常に真偽で載る。無ければ既定（受け取る）
                setWants(p.lightAlert !== false);
            } catch { /* 読めなければ節を出さない */ }
        })();
        return () => { live = false; };
    }, []);

    if (!pro) return null;

    const toggle = async () => {
        if (busy.current) return;
        busy.current = true;
        const before = wants;
        const next = !before;
        setWants(next);
        setSaving(true);
        setError(null);
        try {
            const res = await userFetch("/user/profile", { method: "PUT", body: JSON.stringify({ lightAlert: next }) });
            if (!res.ok) throw new Error(String(res.status));
        } catch (e) {
            // 送れなければ元に戻す（入っているように見せて届かない／止めたつもりで届く、を作らない）
            setWants(before);
            setError(sessionErrorMessage(e)
                ?? (en ? "Couldn't change this. Please try again." : "切り替えられませんでした。もう一度お試しください。"));
        } finally {
            busy.current = false;
            setSaving(false);
        }
    };

    const label = en ? "Alert me the evening before" : "前の晩に知らせる";
    // 2026-11-04: 設定の「Pro」の札（`page.tsx`）の中の2行として描く（iOS `LightAlertSettingsRows`）。
    // 板 v2 は行の絵を外した（Pro の行の Pro マークだけ）ので、光の絵と2行目の字下げもやめた
    return (
        <>
            <SettingsRowLink
                href={ROUTES.LIGHT_FORECAST}
                title={en ? "Light & weather alerts" : "光と天気の知らせ"}
                detail={en ? "This week's light and weather at your wishlist places" : "行きたい場所の、今週の光と天気"}
                testId="settings-light"
            />
            <div className="flex items-center gap-3 px-[14px] py-[13px] min-h-[54px]">
                <span className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="text-[15px] leading-[20px] text-white">{label}</span>
                    <span className="text-[12px] leading-[1.55] text-white/60">
                        {en
                            ? "If a wishlist place looks set for a clear, glowing sunrise, we'll tell you the evening before (in the iPhone app)."
                            : "行きたい場所が、明日の朝に晴れて朝焼けになりそうなら前の晩に（iPhone のアプリに届きます）。"}
                    </span>
                </span>
                {/* 板のトグル（51×31・入は accent-deep に白い玉）。押せる高さは 44px */}
                <button
                    type="button"
                    role="switch"
                    aria-checked={wants}
                    aria-label={label}
                    disabled={saving}
                    onClick={() => void toggle()}
                    className="flex-shrink-0 flex items-center disabled:opacity-60"
                    style={{ width: "51px", minHeight: "44px", touchAction: "manipulation" }}
                >
                    <span
                        className={`relative block rounded-full transition-colors ${wants ? "bg-accent-deep" : "bg-white/20"}`}
                        style={{ width: "51px", height: "31px" }}
                    >
                        <span
                            className="absolute rounded-full bg-white transition-transform"
                            style={{
                                width: "27px", height: "27px", top: "2px", left: "2px",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                                transform: wants ? "translateX(20px)" : "translateX(0)",
                            }}
                        />
                    </span>
                </button>
            </div>
            {error && <SettingsNote role="alert" tone="danger">{error}</SettingsNote>}
        </>
    );
}
