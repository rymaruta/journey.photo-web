"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "../i18n/context";

/** iOS CompositionCatalogView に対応する撮影ガイドの第一段階。画像は端末内のみで使用する。 */
const GUIDES = [
  { id: "thirds", ja: "三分割", en: "Rule of thirds", sceneJa: "風景・人物・街並み", sceneEn: "Landscapes, portraits and streets", tipJa: "被写体を縦横の交点に置くと、余白に視線の流れが生まれます。", tipEn: "Place your subject at an intersection to create visual flow." },
  { id: "hinomaru", ja: "日の丸", en: "Centered (Hinomaru)", sceneJa: "人物・花・印象的な建築", sceneEn: "Portraits, flowers and architecture", tipJa: "主役を中央に置き、周囲の背景をシンプルに整えます。", tipEn: "Center the subject and simplify the background." },
  { id: "diagonals", ja: "対角線", en: "Diagonals", sceneJa: "道路・橋・山並み", sceneEn: "Roads, bridges and ridgelines", tipJa: "斜めの線を意識すると、奥行きや動きを表現できます。", tipEn: "Use diagonal lines to emphasize depth and movement." },
  { id: "halves", ja: "二分割・十字", en: "Halves / cross", sceneJa: "水平線・建築", sceneEn: "Horizons and architecture", tipJa: "中央で上下左右を分け、形の対比を意識します。", tipEn: "Divide the frame in half to emphasize contrast." },
  { id: "symmetry", ja: "シンメトリー", en: "Symmetry", sceneJa: "反射・建物・回廊", sceneEn: "Reflections and architecture", tipJa: "左右の形が釣り合う位置を探します。", tipEn: "Align matching shapes across the center." },
  { id: "horizon", ja: "水平線", en: "Horizon", sceneJa: "海・湖・夕景", sceneEn: "Seascapes, lakes and sunsets", tipJa: "水平を保ち、空と地面の比率を調整します。", tipEn: "Keep the horizon level and balance sky and ground." },
  { id: "grid4", ja: "4×4", en: "4×4 grid", sceneJa: "建築・細かな配置", sceneEn: "Architecture and precise framing", tipJa: "細かい格子を使って要素の位置と間隔を揃えます。", tipEn: "Use the grid to align objects and spacing." },
  { id: "squareGrid", ja: "方眼", en: "Square grid", sceneJa: "建築・パターン", sceneEn: "Architecture and patterns", tipJa: "縦横の反復を確認し、歪みを抑えます。", tipEn: "Check repeating lines and minimize distortion." },
  { id: "tianzige", ja: "田字格", en: "Tian grid", sceneJa: "建築・静物", sceneEn: "Architecture and still life", tipJa: "中央の縦横線を基準に四隅のバランスを整えます。", tipEn: "Balance the four quadrants around the center." },
  { id: "mizige", ja: "米字格", en: "Mi grid", sceneJa: "建築・放射状の被写体", sceneEn: "Architecture and radiating subjects", tipJa: "中心から四隅への対角線を使って視線を導きます。", tipEn: "Guide the eye with lines from the center to each corner." },
  { id: "phiGrid", ja: "ファイグリッド", en: "Phi grid", sceneJa: "風景・人物", sceneEn: "Landscapes and portraits", tipJa: "黄金比に近い位置に被写体を置いて余白を整えます。", tipEn: "Use golden-ratio divisions to balance the frame." },
  { id: "thirdsDiagonals", ja: "3×3＋対角", en: "Thirds + diagonals", sceneJa: "街並み・道路", sceneEn: "Streets and roads", tipJa: "三分割と対角線の交点を意識します。", tipEn: "Use intersections of thirds and diagonals." },
  { id: "triangle", ja: "三角", en: "Triangle", sceneJa: "山・人物の配置", sceneEn: "Mountains and subject groups", tipJa: "三角形の頂点に視線を集めて安定感を出します。", tipEn: "Arrange subjects around a triangle for stability." },
  { id: "radial", ja: "放射線", en: "Radial lines", sceneJa: "建築・トンネル", sceneEn: "Architecture and tunnels", tipJa: "線が集まる一点に主役を置きます。", tipEn: "Place the focal point where the lines converge." },
  { id: "square", ja: "1:1", en: "1:1", sceneJa: "正方形の切り取り", sceneEn: "Square crop", tipJa: "正方形の枠内で主役の位置を整えます。", tipEn: "Compose within the square crop." },
  { id: "ratio4x5", ja: "4:5", en: "4:5", sceneJa: "縦長の人物写真", sceneEn: "Vertical portraits", tipJa: "4:5の枠に収まるように配置します。", tipEn: "Compose within a 4:5 crop." },
  { id: "ratio9x16", ja: "9:16", en: "9:16", sceneJa: "縦長の風景", sceneEn: "Vertical landscapes", tipJa: "9:16の縦長の余白を生かします。", tipEn: "Use the tall frame to emphasize vertical space." },
  { id: "ratio16x9", ja: "16:9", en: "16:9", sceneJa: "広い風景", sceneEn: "Wide landscapes", tipJa: "横方向の広がりを意識します。", tipEn: "Emphasize width and panoramic balance." },
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
                {active === "hinomaru" && <><circle cx="150" cy="200" r="35" /><path d="M150 140V260M90 200H210" /></>}
                {active === "diagonals" && <><path d="M0 0L300 400M300 0L0 400" /></>}
                {active === "halves" && <path d="M150 0V400M0 200H300" />}
                {active === "symmetry" && <path d="M150 0V400" />}
                {active === "horizon" && <path d="M0 200H300" />}
                {active === "grid4" && <path d="M75 0V400M150 0V400M225 0V400M0 100H300M0 200H300M0 300H300" />}
                {active === "squareGrid" && <path d="M75 0V400M150 0V400M225 0V400M0 75H300M0 150H300M0 225H300M0 300H300M0 375H300" />}
                {active === "tianzige" && <path d="M150 0V400M0 200H300" />}
                {active === "mizige" && <path d="M150 0V400M0 200H300M0 0L300 400M300 0L0 400" />}
                {active === "phiGrid" && <path d="M114.6 0V400M185.4 0V400M0 152.8H300M0 247.2H300" />}
                {active === "thirdsDiagonals" && <path d="M100 0V400M200 0V400M0 133.33H300M0 266.67H300M0 0L300 400M300 0L0 400" />}
                {active === "triangle" && <path d="M150 45L25 355L275 355Z" />}
                {active === "radial" && <path d="M150 200L0 0M150 200L150 0M150 200L300 0M150 200L0 200M150 200L300 200M150 200L0 400M150 200L150 400M150 200L300 400" />}
                {active === "square" && <rect x="0" y="50" width="300" height="300" />}
                {active === "ratio4x5" && <rect x="0" y="12.5" width="300" height="375" />}
                {active === "ratio9x16" && <rect x="37.5" y="0" width="225" height="400" />}
                {active === "ratio16x9" && <rect x="0" y="115.625" width="300" height="168.75" />}
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
          <p className="text-xs text-white/50">{isJa ? "現在は代表的な18構図に対応しています。iOS版の全37種類への拡張は今後の対応です。" : "Eighteen compositions are currently available. The full 37-guide iOS catalog is not yet included."}</p>
        </section>
      </div>
    </main>
  );
}
