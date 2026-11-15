/**
 * ギャラリーモーダルのキャプションの高さの下限（TAP-7）。
 *
 * **固定 px で書いてはいけない。** 画像 300px とキャプション 200px の固定下限は
 * 合計 500px で、外枠（`sm:max-h-[95vh]`）がそれより低い**横向きのスマホでは
 * 必ず溢れる**。どちらも `flex-shrink-0` なので縮まず、キャプションの箱ごと
 * 画面の外へ出る——中を最後までスクロールしても共有ボタンの行に指が届かない。
 * 実測（修正前）: 667x375 で画面外 118px、568x320 で169px、844x390 で104px。
 *
 * **訂正: 画像側の下限は要らなかった。** 最初は `min(300px, 45vh)` を置いたが、
 * 画像の高さは `60vh` なので **45vh の下限は一度も拘束しない**（実測でも、
 * `0px` にしても `min(300px,45vh)` にしても画像の高さは1pxも変わらない）。
 * 溢れを止めていたのは「300px 固定をやめたこと」であって、新しい下限では
 * ない。**効いていない定数を残すと、次に読む人が『ここが効いている』と
 * 信じて別の場所を壊す**ので消した。画像は `60vh` が上限も下限も決める。
 */
export const CAPTION_MIN_HEIGHT = "min(200px, 30dvh)";

/** 画像エリアの高さ（外枠に対する割合）。CSS 側の `60vh` と対。 */
export const IMAGE_HEIGHT_RATIO = 0.6;
/** 外枠の上限（`sm:max-h-[95vh]`）。スマホ縦は `h-full` なのでもっと余裕がある。 */
export const FRAME_RATIO = 0.95;

/** 画面の高さ（px）に対して、実際に効くキャプションの下限を解く */
export function resolvedCaptionMinHeight(viewportHeight: number): number {
    return Math.min(200, viewportHeight * 0.30);
}

/**
 * その画面の高さで、**画像（60vh）とキャプションの下限**が外枠に収まるか。
 *
 * **モデルを実物に合わせた（訂正）。** 最初は「画像の下限 + キャプションの
 * 下限 ≤ 95vh」で書いたが、実際に高さを決めているのは画像の**下限ではなく
 * `60vh`** の方。式に入れる相手を間違えると、条件を満たしているのに溢れる。
 */
export function captionFitsViewport(viewportHeight: number): boolean {
    return viewportHeight * IMAGE_HEIGHT_RATIO + resolvedCaptionMinHeight(viewportHeight)
        <= viewportHeight * FRAME_RATIO;
}

/**
 * スマホ（640px 未満）でのモーダルの写真の高さ（2026-11-15）。
 *
 * スマホでは枠ごと1本でスクロールするので、写真は縦横比どおりの高さで置く（横長の写真の上下に黒い余りを作らない）。
 * 上限は 80dvh（写真ページの写真の `max-h-[80vh]` と同じ。縦長の写真でも、最初の画面の下に題の頭が見える）。
 * 寸法が無い・壊れているときは、今までと同じ 60dvh。
 */
export function phoneImageHeight(width?: number, height?: number): string {
    if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "60dvh";
    const vw = Math.round((height / width) * 100 * 1000) / 1000;
    return `min(${vw}vw, 80dvh)`;
}
