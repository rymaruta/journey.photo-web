"use client";

import { useEffect } from "react";
import { blocksSave } from "../../lib/utils/saveGuard";

/**
 * 写真を保存させない（サイト全体の1か所）。
 *
 * **2026-11-12 owner「他人は共有画像とかは DL できないようにして欲しい」。**
 * 以前は `Thumb`・写真の詳細・モーダルの `<img>` にだけ右クリック止めがあり、
 * 地図の写真の一覧・シート、ストーリー、プロフィールのカバー、旅の本、
 * 通知の小さな写真などは**右クリックの「名前を付けて画像を保存」とドラッグで
 * 落とせた**（本番を Playwright で開いて確かめた: /map の写真21枚すべて）。
 * 画面ごとに付けると新しい画面で必ず抜けるので、ここで document ごと止める。
 *
 * 止めるもの:
 *   - 写真・動画の上の右クリックのメニュー（`contextmenu`）
 *   - 写真・動画のドラッグ（デスクトップへ落とす）
 *   - Ctrl/Cmd+S（頁ごと保存。写真が一緒に落ちる）
 * iOS Safari の長押しの保存は CSS（`globals.css` の `-webkit-touch-callout`）で止める。
 *
 * 画面写真・開発者ツールは止められない。
 */
export default function DisableSave() {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
                e.preventDefault();
            }
        };
        const onMedia = (e: Event) => {
            if (blocksSave(e.target)) e.preventDefault();
        };
        document.addEventListener("keydown", onKey);
        // capture で取る。画面の側が stopPropagation しても抜けない
        document.addEventListener("contextmenu", onMedia, true);
        document.addEventListener("dragstart", onMedia, true);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("contextmenu", onMedia, true);
            document.removeEventListener("dragstart", onMedia, true);
        };
    }, []);
    return null;
}
