// lib/utils/androidHide.ts
//
// サーバーの部品（`app/layout.tsx`）からも読む定数なので、"use client" のファイルに置かない
// （client のファイルの export はサーバー側では参照の札になり、文字列として読めない）。

/**
 * **Android で札を「描く前に」隠す仕組み**（2026-11-11 判断・札 journey.photo-ios#527）。
 *
 * 札は静的な HTML に全員ぶん入り、水和のあと Android だけ消える（`AppInstallCard.tsx` の `useSyncExternalStore`）。
 * そのため Android ではホームの最初の画面で札（高さ 104＋余白 16）が消え、下の段が 120px 跳ね上がっていた
 * （本番の実測・412px 幅・Android の UA: CLS 0.0857。iPhone・PC の UA では 0.002）。
 *
 * `<head>` の小さな script が UA を見て `<html>` に印を付け、CSS がその印のときだけ札を `display:none` にする
 * ＝最初の描画から札が無い。水和のあとに部品が札を外しても、もう場所を取っていないので何も動かない。
 * 判定は部品と同じ式（`/Android/i`）。JS が切れている人には札が出る（今までどおり）
 */
export const ANDROID_FLAG_ATTR = "data-android";
export const HIDE_ON_ANDROID_ATTR = "data-hide-on-android";
export const ANDROID_FLAG_SCRIPT =
    `try{if(/Android/i.test(navigator.userAgent))document.documentElement.setAttribute("${ANDROID_FLAG_ATTR}","")}catch(e){}`;
export const ANDROID_HIDE_CSS = `html[${ANDROID_FLAG_ATTR}] [${HIDE_ON_ANDROID_ATTR}]{display:none!important}`;
