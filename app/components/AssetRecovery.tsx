"use client";

import { useEffect } from "react";
import { isAssetElement, shouldAutoReload, markReloaded, stylesheetsApplied, isLeavingPage } from "../../lib/utils/assetRecovery";

// CSS/JS チャンクの読み込み失敗を検知したら1回だけ自動リロードする。
// （リソースの error はバブルしないため capture で拾う）
export default function AssetRecovery() {
    useEffect(() => {
        // 頁を離れる途中（`isLeavingPage` の注記）。WebKit は移動の始まりに読み込み中の script / CSS へ error を出す
        let leftAt = 0;
        const onLeave = () => { leftAt = Date.now(); };
        const onShow = () => { leftAt = 0; };
        window.addEventListener("beforeunload", onLeave);
        window.addEventListener("pagehide", onLeave);
        window.addEventListener("pageshow", onShow);
        const reload = () => {
            if (isLeavingPage(leftAt)) return;
            if (!shouldAutoReload()) return;
            markReloaded();
            window.location.reload();
        };

        const onError = (e: Event) => {
            if (!isAssetElement(e.target)) return;
            reload();
        };
        window.addEventListener("error", onError, true);

        // error を取りこぼしても「CSS が当たっていない」状態は直接見て検知する
        const check = () => { if (!stylesheetsApplied(document)) reload(); };
        if (document.readyState === "complete") check();
        else window.addEventListener("load", check, { once: true });

        return () => {
            window.removeEventListener("error", onError, true);
            window.removeEventListener("load", check);
            window.removeEventListener("beforeunload", onLeave);
            window.removeEventListener("pagehide", onLeave);
            window.removeEventListener("pageshow", onShow);
        };
    }, []);
    return null;
}
