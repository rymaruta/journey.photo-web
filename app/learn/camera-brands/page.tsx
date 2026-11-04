import "../guide-details.css";
import "../academy.css";
import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "../../../lib/utils/seo";
export const metadata: Metadata = {title:"カメラメーカーの特徴を比較｜初心者向けブランドガイド",description:"SONY、Canon、Nikon、FUJIFILM、Leica、Hasselblad、OM SYSTEM、Panasonic、RICOHの特徴を、撮影スタイルやレンズ選びの視点から解説。",alternates:{canonical:`${siteConfig.url}/learn/camera-brands`}};
const brands=[
{brand:"SONY",official:"https://www.sony.jp/ichigan/",character:"小型のフルサイズから動画向けまで選択肢が広い",detail:"αシリーズを中心に、瞳AFや動画機能などの進化が特徴。Eマウントは対応レンズの選択肢が豊富です。",forWhom:"写真も動画も楽しみたい人"},
{brand:"Canon",official:"https://personal.canon.jp/product/camera",character:"操作のわかりやすさと幅広いEOS Rシリーズ",detail:"人物、スポーツ、旅行まで多彩な機種を展開。RFレンズの対応や価格は機種ごとに確認しましょう。",forWhom:"人物・家族写真から始めたい人"},
{brand:"Nikon",official:"https://www.nikon-image.com/products/",character:"静止画と動画を両立するZシリーズ",detail:"Zマウントのレンズ群と堅実な操作系が魅力。風景から野鳥まで、機種によって得意分野が異なります。",forWhom:"風景や動体撮影をじっくり楽しみたい人"},
{brand:"FUJIFILM",official:"https://fujifilm-x.com/ja-jp/",character:"色づくりと撮る楽しさ",detail:"フィルムシミュレーションで色の雰囲気を選べます。XシリーズのAPS-CとGFXシリーズのラージフォーマットは用途も価格帯も異なります。",forWhom:"JPEGの色やスナップ撮影を楽しみたい人"},
{brand:"Leica",official:"https://leica-camera.com/ja-JP",character:"シンプルな操作と独特の撮影体験",detail:"M型のレンジファインダー、Qシリーズのレンズ一体型など、製品ごとに体験が大きく違います。高価格帯なので実機での操作確認が大切です。",forWhom:"街歩きや撮影そのものを味わいたい人"},
{brand:"Hasselblad",official:"https://www.hasselblad.com/",character:"中判センサーを活かした高精細な表現",detail:"Xシステムはラージフォーマットの画質と独自の色表現が魅力。一方でレンズ価格、重量、AF性能、連写性能なども用途に合わせて比較しましょう。",forWhom:"風景や作品撮りを丁寧に楽しみたい人"},
{brand:"OM SYSTEM",official:"https://explore.omsystem.com/jp/ja/",character:"携帯性とアウトドアでの機動力",detail:"マイクロフォーサーズ規格を採用。望遠を持ち歩きやすく、機種によって防塵防滴や手ぶれ補正を重視した設計があります。",forWhom:"登山・野鳥・旅行で荷物を軽くしたい人"},
{brand:"Panasonic LUMIX",official:"https://panasonic.jp/dc/",character:"動画機能とハイブリッド撮影",detail:"フルサイズのLマウントとマイクロフォーサーズを展開。動画向け機能は機種差が大きいため、必要な記録形式や熱対策を確認しましょう。",forWhom:"動画制作も本格的に始めたい人"},
{brand:"RICOH / PENTAX",official:"https://www.ricoh-imaging.co.jp/japan/",character:"日常スナップと一眼レフへのこだわり",detail:"RICOH GRはコンパクトなスナップ機として知られ、PENTAXは光学ファインダーを備える一眼レフを展開。製品の方向性は別々に比較しましょう。",forWhom:"身軽な街撮り、または一眼レフの操作感が好きな人"},
];

const buyingChecklist=[
 {title:"予算はレンズ込みで考える",body:"本体だけでなく、標準ズーム、予備バッテリー、記録メディア、持ち運び用バッグまで含めて予算を決めましょう。中古品は保証と状態を確認します。"},
 {title:"センサーサイズと持ち運びを比較",body:"フルサイズが常に正解ではありません。APS-Cやマイクロフォーサーズはシステム全体を小さくしやすい場合があり、中判は高精細な撮影を重視する選択肢です。"},
 {title:"レンズの選択肢を先に見る",body:"広角で風景、望遠で動物、明るい単焦点で人物など、撮影対象で必要なレンズが変わります。マウントごとの対応と総重量を確認しましょう。"},
 {title:"AF・手ぶれ補正・動画は機種ごと",body:"同じブランドでもエントリー機と上位機で性能差があります。特に動物認識、動画記録形式、防塵防滴、手ぶれ補正は型番単位で公式仕様を確認してください。"},
 {title:"店頭ではこの5点を試す",body:"①持ちやすさ ②ファインダーの見やすさ ③メニューの理解しやすさ ④レンズを付けた重量 ⑤実際のシャッター操作。スペック表だけではわからない相性があります。"},
];
const commonQuestions=[
 {q:"初心者に一番おすすめのメーカーは？",a:"万人にとっての一位はありません。撮りたい被写体、予算、重さ、使いたいレンズの4つで候補を絞り、実機を触って決めるのがおすすめです。"},
 {q:"フルサイズを買えば必ず写真が上達する？",a:"いいえ。構図、光、ピント、シャッタースピードの理解が大切です。小さなセンサーでも素晴らしい写真は撮れます。"},
 {q:"写真の色はメーカーだけで決まる？",a:"JPEGの色づくりには各社の個性がありますが、光、ホワイトバランス、設定、レンズ、RAW現像でも大きく変わります。"},
 {q:"一度メーカーを決めたら変えられない？",a:"変更はできますが、レンズのマウント互換性や買い替え費用が問題になります。長く使うならレンズのラインアップも重視しましょう。"},
];

export default function CameraBrandsPage(){return <main className="academy-shell"><Link href="/learn" className="academy-back">← 教科書に戻る</Link><p className="academy-kicker">カメラ選び</p><h1 className="academy-article-title">カメラメーカーの特徴を比較</h1><p className="academy-lead">どのメーカーが「一番いい」かではなく、どんな写真を撮りたいかが大切。同じメーカーでも機種によって得意分野は変わります。ここではブランドの傾向を入口に、自分に合う一台の探し方を紹介します。</p><nav aria-label="メーカー一覧" className="academy-chips">{brands.map(b=><a key={b.brand} href={`#${b.brand.replace(/[^a-zA-Z]/g,"").toLowerCase()}`} >{b.brand}</a>)}</nav><article className="academy-brand-grid">{brands.map(b=><section id={b.brand.replace(/[^a-zA-Z]/g,"").toLowerCase()} key={b.brand} className="academy-brand"><h2 >{b.brand}</h2><h3 >{b.character}</h3><p >{b.detail}</p><p><strong>こんな人に：</strong>{b.forWhom}</p><a href={b.official} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block text-accent underline underline-offset-4">公式サイトで製品情報を確認 ↗</a></section>)}</article><section className="mt-12"><h2 className="text-2xl font-bold">失敗しない選び方</h2><p className="mt-4 leading-9 text-zinc-200">まず撮りたいものを3つ挙げ、持ち運びやすさ、レンズを含む総予算、操作のしやすさを比較しましょう。メーカー名だけで決めず、使いたいレンズの重さ・価格・在庫も確認してください。購入前には店頭で実際に握り、メニューやファインダーを試すのがおすすめです。</p><p className="academy-note">このページは各メーカーの一般的な傾向を紹介しています。具体的な仕様、互換性、価格、発売状況は各メーカーの公式情報で確認してください。</p></section><section className="academy-section"><h2>購入前に確認したい5つのポイント</h2><div className="academy-deep-guides">{buyingChecklist.map((item,i)=><div key={item.title} className="academy-buying-item"><span className="academy-section-number">CHECK {String(i+1).padStart(2,"0")}</span><h3>{item.title}</h3><p>{item.body}</p></div>)}</div></section><section className="academy-section"><h2>カメラ選びのよくある質問</h2><div className="academy-faq">{commonQuestions.map(item=><details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div></section><Link href="/learn/camera-basics" className="mt-10 inline-block text-amber-300 underline">カメラの基本を学ぶ →</Link></main>}
