import SavedSpotsMapClient from "./SavedSpotsMapClient";
import { spotPins } from "../../../lib/data/spotLink";

/**
 * 行きたい場所を地図で見る（`/saved-spots/map`）の**サーバー側の殻**。
 *
 * `/map` と同じ理由で、台帳をここで解いて地図に要る項目（名前・地域・スラッグ・座標）だけ渡す
 * （画面は `"use client"` なので、そこから `content/spots.json` を読むと全文がチャンクに載る）。
 * 静的書き出しなので、ビルド時に1回だけ走る。
 */
export default function SavedSpotsMapPage() {
    return <SavedSpotsMapClient spots={spotPins()} />;
}
