import { nearbyIndexJson } from "@/lib/data/todayPlaces";

/**
 * **近くの撮影スポットの索引**（`/app/data/nearby.json`・2026-11-07）。「今日の日の出・日の入り」のハブ（`/today`）の
 * 「現在地で調べる」が、**ボタンを押して位置が取れたあとにだけ**読む。近い順の並べ替えは端末の中で、
 * 位置はこのファイルの URL にも付かない（全員同じ静的ファイル）。
 *
 * 形: `[slug, 名前, 緯度, 経度, 種類（台帳の category）, 県スラッグ][]`。緯度経度は小数3桁。
 * 入るのは国内で頁を建てているスポットだけ（`visibleSpots`・座標あり）。
 * `.json` は `public, max-age=3600` で配られ、デプロイのたびに CDN から消される（`spot-photo-links.json` と同じ）。
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
    return new Response(nearbyIndexJson(), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
