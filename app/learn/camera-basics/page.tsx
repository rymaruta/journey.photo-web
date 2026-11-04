import "../academy.css";
import type { Metadata } from "next";
import Link from "next/link";
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
export default function CameraBasicsPage(){return <main className="academy-shell academy-article"><Link href="/learn" className="academy-back">← 教科書に戻る</Link><p className="academy-kicker">初心者向け・撮影入門</p><h1 className="academy-article-title">カメラの使い方 完全入門</h1><p className="academy-lead">カメラの数字は、覚えるためではなく「こんな写真を撮りたい」を叶えるための道具。難しい式は後回しにして、まずは撮りながら理解しましょう。</p><nav aria-label="記事の目次" className="academy-toc"><h2 className="mb-3 font-bold">この記事でわかること</h2><ol className="space-y-2">{sections.map(s=><li key={s.id}><a href={`#${s.id}`} >{s.title}</a></li>)}</ol></nav><article >{sections.map(s=><section key={s.id} id={s.id} className="academy-section"><span className="academy-section-number">LESSON {String(sections.indexOf(s)+1).padStart(2,"0")}</span><h2>{s.title}</h2><p >{s.body}</p></section>)}</article><aside className="academy-next"><h2 className="text-xl font-semibold">次に読みたい記事</h2><Link href="/learn/camera-brands" className="mt-3 inline-block text-amber-300 underline">自分に合うカメラメーカーを探す →</Link></aside></main>}
