import { swipeDeck } from "@/lib/data/swipeDeck";

/**
 * **撮影スポットを払う画面の札の山**（`/app/data/swipe.json`・2026-11-11）。
 *
 * 公開済みで代表写真のある撮影スポットを数百件（名前・地域・写真・出典）。中身と決まりは `lib/data/swipeDeck.ts`。
 * `/swipe` の画面が開いたときに1回だけ読む。静的に書き出す（Lambda も DB も通らない）
 */
export const dynamic = "force-static";

export function GET(): Response {
    return new Response(JSON.stringify(swipeDeck()), {
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
}
