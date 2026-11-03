"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "../i18n/context";

/** iOS CompositionCatalogView に対応する撮影ガイドの第一段階。画像は端末内のみで使用する。 */
const GUIDES = [
  { id: "thirds", ja: "三分割構図", en: "Rule of thirds", sceneJa: "風景・人物・街並み", sceneEn: "Landscapes, portraits and streets", tipJa: "被写体を縦横の交点に置くと、余白に視線の流れが生まれます。", tipEn: "Place your subject at an intersection to create visual flow." },
  { id: "center", ja: "日の丸構図", en: "Centered composition", sceneJa: "人物・花・印象的な建築", sceneEn: "Portraits, flowers and architecture", tipJa: "主役を中央に置き、周囲の背景をシンプルに整えます。", tipEn: "Center the subject and simplify the background." },
  { id: "diagonal", ja: "対角線構図", en: "Diagonal composition", sceneJa: "道路・橋・山並み", sceneEn: "Roads, bridges and ridgelines", tipJa: "斜めの線を意識すると、奥行きや動きを表現できます。", tipEn: "Use diagonal lines to emphasize depth and movement." },
] as const;
type GuideId = (typeof GUIDES)[number]["id"];

export default function CompositionGuidePage() {
  const { locale } = useLocale();
  const isJa = locale !== "en";
  const [active, setActive] = useState<GuideId>("thirds");
  const [showLines, setShowLines] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const guide = GUIDES.find((item) => item.id === active)!;
  return (
    <main className="min-h-screen bg-bg text-white px-4 pt-10 pb-20">
      <div className="mx-auto max-w-xl space-y-6">
        <Link href="/user/settings" className="inline-flex min-h-11 items-center text-sm text-white/70">← {isJa ? "設定に戻る" : "Back to settings"}</Link>
        <header className="space-y-2">
          <p className="text-xs tracking-widest text-[#C9A66B]">{isJa ? "撮影ガイド" : "SHOOTING GUIDE"}</p>
          <h1 className="text-3xl font-semibold">{isJa ? "構図一覧" : "Composition guide"}</h1>
          <p className="text-sm text-white/70">{isJa ? "構図を選び、自分の写真にガイド線を重ねて確認できます。" : "Choose a composition and preview guide lines over your own photo."}</p>
        </header>
        <div className="space-y-2" aria-label={isJa ? "構図を選ぶ" : "Choose a composition"}>
          {GUIDES.map((item) => <button key={item.id} type="button" onClick={() => setActive(item.id)} aria-pressed={active === item.id} className={`flex w-full min-h-14 items-center justify-between border-b border-white/10 px-2 text-left ${active === item.id ? "text-[#C9A66B]" : "text-white"}`}>
            <span><strong className="block text-sm">{isJa ? item.ja : item.en}</strong><span className="text-xs text-white/60">{isJa ? item.sceneJa : item.sceneEn}</span></span><span aria-hidden="true">›</span>
          </button>)}
        </div>
        <section className="space-y-4" aria-label={isJa ? "構図の確認" : "Composition preview"}>
          <h2 className="text-xl font-semibold">{isJa ? guide.ja : guide.en}</h2>
          <div className="relative mx-auto aspect-[3/4] w-full max-w-[270px] overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-slate-600 to-slate-900">
            {photoUrl && <img src={photoUrl} alt={isJa ? "端末内の写真" : "Local photo"} className="absolute inset-0 h-full w-full object-cover" />}
            {showLines && <svg viewBox="0 0 300 400" className="absolute inset-0 h-full w-full" aria-label={isJa ? "構図ガイド線" : "Composition guidelines"}>
              <g fill="none" stroke="#fff" strokeWidth="2" strokeOpacity=".85">
                {active === "thirds" && <><path d="M100 0V400M200 0V400M0 133.33H300M0 266.67H300" /></>}
                {active === "center" && <><circle cx="150" cy="200" r="35" /><path d="M150 140V260M90 200H210" /></>}
                {active === "diagonal" && <><path d="M0 0L300 400M300 0L0 400" /></>}
              </g>
            </svg>}
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-white/20 px-4 text-sm">
            {isJa ? "自分の写真で構図を確認" : "Try with your photo"}
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; setPhotoUrl(file ? URL.createObjectURL(file) : null); event.currentTarget.value = ""; }} />
          </label>
          <p className="text-xs text-white/60">{isJa ? "写真は端末内だけで表示し、アップロードしません。" : "Your photo stays on this device and is not uploaded."}</p>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm"><span>{isJa ? "ガイド線を表示" : "Show guide lines"}</span><input type="checkbox" checked={showLines} onChange={(event) => setShowLines(event.target.checked)} className="h-5 w-5 accent-[#C9A66B]" /></label>
          <p className="text-sm leading-relaxed text-white/75">{isJa ? guide.tipJa : guide.tipEn}</p>
          <p className="text-xs text-white/50">{isJa ? "現在は代表的な3構図に対応しています。iOS版の全37種類への拡張は今後の対応です。" : "Three compositions are currently available. The full 37-guide iOS catalog is not yet included."}</p>
        </section>
      </div>
    </main>
  );
}
