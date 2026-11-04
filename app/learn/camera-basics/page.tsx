import "../guide-details.css";
import "../academy.css";
import type { Metadata } from "next";
import Link from "next/link";
import ExposureLab from "./ExposureLab";
import { siteConfig } from "../../../lib/utils/seo";
export const metadata: Metadata = { title: "カメラの使い方完全入門｜F値・シャッター速度・ISOをやさしく解説", description: "カメラ初心者が最初に覚えたい3つの設定、撮影モード、ピント、ホワイトバランス、失敗したときの直し方を具体例で解説。", alternates: { canonical: `${siteConfig.url}/learn/camera-basics` } };
const sections = [
  {id:"first",title:"最初の一枚は「A（Av）モード」で",body:"カメラには全部おまかせのオートと、自分で設定するモードがあります。最初はA（CanonではAv）がおすすめ。背景のぼけ具合を決めるF値だけ自分で選び、シャッタースピードはカメラに任せられます。まずは明るい屋外で、動かない被写体を撮ってみましょう。"},
  {id:"aperture",title:"F値：背景のぼけ方を変える",body:"F値はレンズの光の通り道の大きさを表す数字です。F1.8のように小さいほど背景がぼけやすく、F8のように大きいほど手前から奥までピントが合う範囲が広がります。人物ならF2〜F4、風景ならF5.6〜F11から試すと違いをつかみやすいです。レンズや撮影距離によって結果は変わります。"},
  {id:"shutter",title:"シャッタースピード：動きを止める・流す",body:"シャッターが開いている時間のこと。1/1000秒なら走る人や動物の動きを止めやすく、1/30秒では手ぶれや被写体ぶれが起きやすくなります。流れる水をなめらかに写すには長いシャッタースピードが使えますが、三脚があると安心。手持ちならまず1/125秒前後を目安にし、望遠や動く被写体ではさらに速くしましょう。"},
  {id:"iso",title:"ISO感度：暗さに対応する",body:"ISO100から400、800、3200へと数字を上げると、同じF値とシャッタースピードでも画像が明るくなります。ただし高感度ではノイズが目立つ場合があります。最初はISO AUTOで大丈夫。暗い場所でブレるときは、ISOを上げてシャッタースピードを確保する方がきれいに残せることもあります。"},
  {id:"exposure",title:"明るさは3つの設定の組み合わせ",body:"F値・シャッタースピード・ISOは別々ではありません。F値を小さくすると光を多く取り込めます。シャッターを長く開けても光が増えます。ISOは取り込んだ光の信号を増幅して画像の明るさを調整します。まずはA（Av）モードとISO AUTOで撮り、暗すぎる・明るすぎるときは露出補正（±）を使ってみましょう。"},
  {id:"focus",title:"ピント：どこを見せたいか決める",body:"人物なら目、料理なら一番見せたい部分にピントを合わせましょう。AF-S／ワンショットAFは止まった被写体、AF-C／サーボAFは動く被写体に向いています。顔・瞳認識が使える機種なら活用すると便利です。ピントが合わないときは被写体との距離が近すぎないかも確認しましょう。"},
  {id:"whitebalance",title:"ホワイトバランス：色を自然に整える",body:"夕方の光はオレンジ色、日陰は青っぽく写ることがあります。最初はAWB（オートホワイトバランス）で十分。夕焼けの暖かさを残したいときは「曇天」や「日陰」なども試してみましょう。RAWで撮っておくと、対応ソフトで撮影後に色温度を柔軟に調整できます。"},
  {id:"practice",title:"今日の練習：同じ場所を3枚撮る",body:"① A（Av）モードでF値を最小にして撮る。② 同じ位置からF8にして撮る。③ 露出補正を＋1にして撮る。背景のぼけ方と明るさを見比べれば、数字の意味が写真でわかります。F8では暗くなって手ぶれすることがあるので、明るい場所で試してください。"},
];

const fieldGuides = [
 {title:"撮影前の5分チェック",items:["バッテリーとSDカードの空き容量を確認する","レンズ前面の汚れを柔らかいクロスで確認する","画質をJPEG高画質、またはRAW＋JPEGに設定する","AFとISO AUTOを確認する","撮影後に一枚拡大してピントとブレを確認する"]},
 {title:"シーン別・最初の設定",items:["人物：A/Av、F2.8〜F4、瞳AF、ISO AUTO。背景との距離を離すとぼけやすい","風景：A/Av、F5.6〜F11、ISO AUTO。画面の端まで見て水平を整える","街歩き：A/Av、F4〜F8、ISO AUTO。動く人が多いならシャッター速度を確認","動物：S/Tv、1/1000秒前後から、AF-C、連写。暗ければISOが上がる","夜景手持ち：A/AvまたはS/Tv、手ぶれ補正、ISO AUTO。まずブレない速度を優先","滝や川：速いシャッターで水滴を止めるか、三脚と低速シャッターで流れを描く"]},
 {title:"失敗した写真の直し方",items:["全体がぼける：シャッタースピードを速くし、カメラをしっかり構える","被写体だけぼける：AFの位置と追従モードを確認する","暗すぎる：露出補正をプラスにする。必要ならISOやF値も調整","白飛びする：露出補正をマイナスにし、ヒストグラムも確認","背景がぼけない：F値を小さく、被写体に近づき、背景を遠ざける","ザラザラする：ISOを下げるか光を増やす。ただしブレ防止を優先する"]},
 {title:"初心者が覚えておきたい用語",items:["焦点距離：広角ほど広く、望遠ほど遠くのものを大きく写しやすい","センサーサイズ：画角、ぼけ、画質、機材の大きさに関わる要素のひとつ","RAW：撮影後の明るさや色の調整幅が広い記録形式","JPEG：すぐ共有しやすく、ファイル容量を抑えやすい形式","手ぶれ補正：手の揺れを減らす機能。動く被写体のブレは止められない"]},
];
const questions = [
 {q:"初心者はMモードから始めるべき？",a:"いいえ。まずはA/AvやPモードで撮り、F値と明るさの関係をつかむのがおすすめ。Mモードは設定の意図が明確になってからで十分です。"},
 {q:"F値を小さくすれば必ずいい写真になる？",a:"なりません。集合写真や風景では、少し絞って複数の被写体にピントを合わせた方が適切な場合があります。"},
 {q:"ISOは100に固定した方が画質がいい？",a:"低感度が有利な場面は多いですが、ISO100にこだわってブレた写真になるより、感度を上げて撮り切る方がよい場合があります。"},
 {q:"レンズは最初から高価なものが必要？",a:"必要ありません。まず手元のレンズで焦点距離やF値の違いを学び、撮りたい写真に不足が出てから追加を考えましょう。"},
];

export default function CameraBasicsPage(){return <main className="academy-shell academy-article"><Link href="/learn" className="academy-back">← 教科書に戻る</Link><p className="academy-kicker">初心者向け・撮影入門</p><h1 className="academy-article-title">カメラの使い方 完全入門</h1><p className="academy-lead">カメラの数字は、覚えるためではなく「こんな写真を撮りたい」を叶えるための道具。難しい式は後回しにして、まずは撮りながら理解しましょう。</p><nav aria-label="記事の目次" className="academy-toc"><h2 className="mb-3 font-bold">この記事でわかること</h2><ol className="space-y-2">{sections.map(s=><li key={s.id}><a href={`#${s.id}`} >{s.title}</a></li>)}</ol></nav><ExposureLab/><article>{sections.map(s=><section key={s.id} id={s.id} className="academy-section"><span className="academy-section-number">LESSON {String(sections.indexOf(s)+1).padStart(2,"0")}</span><h2>{s.title}</h2><p >{s.body}</p></section>)}</article><div className="academy-deep-guides">{fieldGuides.map((g,i)=><section key={g.title} className="academy-section"><span className="academy-section-number">PRACTICAL GUIDE {String(i+1).padStart(2,"0")}</span><h2>{g.title}</h2><ul className="academy-bullet-list">{g.items.map(item=><li key={item}>{item}</li>)}</ul></section>)}</div><section className="academy-section"><h2>よくある質問</h2><div className="academy-faq">{questions.map(q=><details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}</div></section><aside className="academy-next"><h2 className="text-xl font-semibold">次に読みたい記事</h2><Link href="/learn/camera-brands" className="mt-3 inline-block text-amber-300 underline">自分に合うカメラメーカーを探す →</Link></aside></main>}
