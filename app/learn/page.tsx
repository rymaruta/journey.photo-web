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
  return <main className="mx-auto max-w-5xl px-5 py-12 text-white">
    <p className="mb-3 text-sm tracking-widest text-amber-300">JOURNEY PHOTO ACADEMY</p>
    <h1 className="text-3xl font-bold sm:text-5xl">写真とカメラの教科書</h1>
    <p className="mt-5 max-w-2xl leading-8 text-zinc-300">難しい専門用語を覚える前に、撮りたい写真を撮れるようになろう。初心者の「なぜ？」から、カメラ選びの奥深さまで。</p>
    <div className="mt-10 grid gap-5 md:grid-cols-2">{articles.map(a=><Link key={a.href} href={a.href} className="rounded-2xl border border-zinc-700 bg-zinc-900 p-7 transition hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-amber-400">
      <span className="text-sm text-amber-300">{a.tag}</span><h2 className="mt-3 text-2xl font-semibold">{a.title}</h2><p className="mt-4 leading-7 text-zinc-300">{a.description}</p><span className="mt-6 inline-block text-amber-300">記事を読む →</span>
    </Link>)}</div>
    <p className="mt-10 text-sm text-zinc-400">撮影を学んだら、旅先や日常で実際に撮ってみよう。写真を共有する楽しさもJourney Photoで。</p>
  </main>;
}