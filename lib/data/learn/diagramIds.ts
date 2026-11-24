// lib/data/learn/diagramIds.ts
//
// **教科書の図（SVG）の一覧**（2026-11-04）。章のデータは図を id で指す（図の描き方は
// `app/learn/_parts/Diagrams.tsx`）。新しい図が要るときはここに id を足し、描き方を足す。
export const DIAGRAM_IDS = [
    /** F値と絞りの穴の大きさ（F1.4〜F16 の円） */
    "aperture-sizes",
    /** ピントの合う奥行き（被写界深度）: 浅い／深い */
    "depth-of-field",
    /** シャッタースピードと動きの写り方（止める・流す） */
    "shutter-motion",
    /** 露出の3要素（絞り・シャッター・ISO）と「段」の梯子 */
    "exposure-ladder",
    /** ヒストグラムの形（暗い・標準・明るい・コントラスト高い） */
    "histogram-shapes",
    /** 色温度の目盛り（ろうそく〜青空の日陰） */
    "color-temperature",
    /** 焦点距離と画角（広角〜望遠） */
    "focal-angles",
    /** 光の向き（順光・サイド光・逆光） */
    "light-direction",
    /** 時間帯と光（朝・昼・夕・夜の色と影） */
    "time-of-day",
    /** 手ぶれしない目安（焦点距離とシャッター速度） */
    "handheld-rule",
    /** 同じ大きさの人物を、広角で近づく／望遠で離れる（背景の大きさの違い） */
    "perspective-compression",
    /** フルサイズ・APS-C・マイクロフォーサーズのセンサー枠の大きさ（同じ像の円の上） */
    "crop-factor",
    /** トーンカーブの4つの形（直線・S字・逆S字・黒浮き） */
    "tone-curve",
    /** 現像の順番（選ぶ→切り抜き→色→明るさ→部分→細部→書き出し） */
    "develop-order",
    /** フラッシュの直当てとバウンス */
    "flash-bounce",
    /** 青空を絞って撮るとセンサーのゴミが点で写る */
    "sensor-dust-test",
    /** バックアップの 3-2-1（3つ・2種類・1つは別の場所） */
    "backup-3-2-1",
    /** 星が点で写るシャッター秒数の目安（500 ルール） */
    "star-trail-rule",
    /** 料理を撮る角度（真上・斜め・真横） */
    "shooting-angle",
    /** 雪・白い壁は露出補正を＋にする */
    "exposure-compensation-snow",
] as const;
export type DiagramId = typeof DIAGRAM_IDS[number];
