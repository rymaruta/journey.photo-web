import SwipeClient from "./SwipeClient";

/**
 * 撮影スポットを払う（`/swipe`・2026-11-11）。見出しと一行は静的な HTML に入れ（検索に出す頁）、
 * 札の山と操作は画面（`SwipeClient`）。言葉は iOS の `SpotSwipe` と同じ
 */
export default function SwipePage() {
    return (
        <main className="px-4 sm:px-6 pt-3 pb-28 min-h-screen text-white bg-bg max-w-xl mx-auto w-full">
            <p className="m-0 eyebrow text-accent">行き先を探す</p>
            <h1 className="m-0 mt-1 font-serif font-bold" style={{ fontSize: "20px", lineHeight: "28px" }}>
                写真を払って、行きたい場所を探す
            </h1>
            <p className="m-0 mt-1 text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>
                右へ払うと行きたい、左へ払うと見送る。
            </p>
            <SwipeClient />
        </main>
    );
}
