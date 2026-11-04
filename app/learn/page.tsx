import "./academy.css";
import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "../../lib/utils/seo";

export const metadata: Metadata = {
  title: "写真とカメラの教科書｜初心者から学べる撮影ガイド",
  description: "F値・シャッタースピード・ISO感度からカメラメーカーの特徴まで。写真初心者にもわかりやすいJourney Photoの撮影ガイド。",
  alternates: { canonical: `${siteConfig.url}/learn` },
};
const articles = [
  { href: "/learn/camera-basics", title: "カメラの使い方 完全入門", tag: "はじめてのカメラ", description: "F値・シャッタースピード・ISO感度を、写真が変わる理由からやさしく理解。" },
  { href: "/learn/camera-brands", title: "カメラメーカーの特徴を比較", tag: "カメラ選び", description: "SONY・Canon・Nikon・FUJIFILM・Leica・Hasselbladなどの個性と選び方。" },
];
export default function LearnPage() {
  return <main className="academy-shell">
    <section className="academy-hero"><p className="academy-kicker">JOURNEY PHOTO / PHOTO ACADEMY</p>
    <h1 className="academy-display">写真とカメラの教科書</h1>
    <p className="academy-lead">難しい専門用語を覚える前に、撮りたい写真を撮れるようになろう。初心者の「なぜ？」から、カメラ選びの奥深さまで。</p></section>
    <div className="academy-grid">{articles.map(a=><Link key={a.href} href={a.href} className="academy-card">
      <span className="academy-number">{a.tag}</span><h2 >{a.title}</h2><p >{a.description}</p><span className="academy-link">記事を読む →</span>
    </Link>)}</div>
    <p className="mt-10 text-sm text-zinc-400">撮影を学んだら、旅先や日常で実際に撮ってみよう。写真を共有する楽しさもJourney Photoで。</p>
  </main>;
}