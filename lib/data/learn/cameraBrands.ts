// lib/data/learn/cameraBrands.ts
//
// **カメラメーカーの特徴を比較（/learn/camera-brands）の中身**（2026-11-04）。
//
// 書く決まり:
// - マウント・センサーの大きさ・シリーズの名前のように**長く変わらない事実**だけを書く。
//   値段・発売日・型番ごとの性能は書かない（すぐ古くなる。比べるなら公式で）
// - 「気をつけたい点」は、そのメーカーの仕組みから必ず言える一般論だけ
// - 公式サイトの URL は 2026-11-04 に開けることを確かめた（Nikon は nij.nikon.com・OM SYSTEM は
//   jp.omsystem.com。古い URL は転送か 404 だった）
// - `cameraPrefixes` は、このサイトの写真の機種名（EXIF）の頭と比べる言葉（小文字）。
//   メーカーの頁から `/camera/<機種>` の写真へ繋ぐのに使う

export type Brand = {
    id: string;
    name: string;
    /** 代表的なシリーズの名前 */
    series: string;
    mounts: string;
    sensors: string;
    character: string;
    detail: string;
    forWhom: string;
    caution: string;
    official: string;
    cameraPrefixes: string[];
};

export const BRANDS_LEAD =
    "どのメーカーが「一番いい」かではなく、どんな写真を撮りたいかが大切です。同じメーカーでも機種によって得意なことは変わります。ここではメーカーの傾向を入口に、自分に合う一台の探し方をまとめました。";

export const BRANDS: Brand[] = [
    {
        id: "sony",
        name: "SONY",
        series: "α（アルファ）",
        mounts: "E マウント",
        sensors: "フルサイズ・APS-C",
        character: "小さなフルサイズから動画向けまで、選べる幅が広い",
        detail: "ミラーレスの α を中心に、写真向け・動画向け・小型の機種をそろえています。E マウントはソニー以外のレンズメーカーの製品も多く、レンズの選び方の幅が広いマウントです。",
        forWhom: "写真も動画も楽しみたい人、レンズを幅広く選びたい人",
        caution: "本体が小さい機種でも、フルサイズ用のレンズは大きく重いことがあります。レンズを付けた重さで比べましょう。",
        official: "https://www.sony.jp/ichigan/",
        cameraPrefixes: ["sony"],
    },
    {
        id: "canon",
        name: "Canon",
        series: "EOS R",
        mounts: "RF マウント",
        sensors: "フルサイズ・APS-C",
        character: "わかりやすい操作と、人物・家族写真に強い機種の幅",
        detail: "ミラーレスの EOS R シリーズを、入門機から仕事向けまで展開しています。APS-C の機種向けには、小さく軽い RF-S レンズもあります。",
        forWhom: "人物・家族・旅行の写真から始めたい人",
        caution: "APS-C 用の RF-S レンズをフルサイズの機種に付けると、写る範囲が狭くなります（クロップ）。レンズの名前の「RF」と「RF-S」を見分けましょう。",
        official: "https://personal.canon.jp/product/camera",
        cameraPrefixes: ["canon"],
    },
    {
        id: "nikon",
        name: "Nikon",
        series: "Z",
        mounts: "Z マウント",
        sensors: "フルサイズ・APS-C",
        character: "堅実な操作と、静止画も動画もこなす Z シリーズ",
        detail: "ミラーレスの Z シリーズを中心に、風景・野鳥・スポーツまで幅広い機種があります。握りやすさとボタンの配置に定評があります。",
        forWhom: "風景や動きものを、じっくり撮りたい人",
        caution: "フルサイズ用のレンズは「FX」、APS-C 用は「DX」と呼びます。レンズを選ぶときは、この印を見て組み合わせを確かめましょう。",
        official: "https://nij.nikon.com/products/",
        cameraPrefixes: ["nikon"],
    },
    {
        id: "fujifilm",
        name: "FUJIFILM",
        series: "X・GFX",
        mounts: "X マウント・G マウント",
        sensors: "APS-C（X）・中判（GFX）",
        character: "色づくりと、ダイヤルで撮る楽しさ",
        detail: "フィルムシミュレーションで、撮った時点の色の雰囲気を選べます。APS-C の X シリーズと、より大きな中判センサーの GFX シリーズがあり、大きさも用途も大きく違います。",
        forWhom: "撮ってすぐの JPEG の色を楽しみたい人、街のスナップが好きな人",
        caution: "X と GFX はマウントが別で、レンズは共通ではありません。どちらで始めるかを先に決めましょう。",
        official: "https://www.fujifilm-x.com/ja-jp/",
        cameraPrefixes: ["fujifilm"],
    },
    {
        id: "leica",
        name: "Leica",
        series: "M・SL・Q",
        mounts: "M マウント・L マウント（SL）、Q はレンズ一体",
        sensors: "フルサイズ（主な機種）",
        character: "シンプルな操作と、撮ることそのものを味わう体験",
        detail: "レンジファインダーの M、ミラーレスの SL、レンズ一体型の Q と、製品ごとに撮る体験がまったく違います。",
        forWhom: "街歩きや、撮る時間そのものを楽しみたい人",
        caution: "M 型はピントを手で合わせます（オートフォーカスではありません）。AF に慣れている人は、店で試してから選びましょう。",
        official: "https://leica-camera.com/ja-JP",
        cameraPrefixes: ["leica"],
    },
    {
        id: "hasselblad",
        name: "Hasselblad",
        series: "X システム",
        mounts: "XCD マウント",
        sensors: "中判",
        character: "大きなセンサーを活かした、細やかで階調豊かな写り",
        detail: "フルサイズより大きい中判センサーで、細部の描写と色のなめらかさが持ち味です。レンズは XCD シリーズ。",
        forWhom: "風景や作品を、時間をかけて丁寧に撮りたい人",
        caution: "中判は本体もレンズも大きく、価格も高めです。連写や動きの速い被写体より、じっくり撮る撮り方に向きます。",
        official: "https://www.hasselblad.com/ja-jp/",
        cameraPrefixes: ["hasselblad"],
    },
    {
        id: "omsystem",
        name: "OM SYSTEM",
        series: "OM",
        mounts: "マイクロフォーサーズ",
        sensors: "フォーサーズ（マイクロフォーサーズ規格）",
        character: "小さく軽い望遠と、屋外での強さ",
        detail: "マイクロフォーサーズはセンサーが小さいぶん、同じ写る範囲のレンズを小さく作れます。望遠を持ち歩きやすく、防塵防滴に力を入れた機種もあります。マイクロフォーサーズは共通の規格で、Panasonic の G シリーズとレンズを付け合えます。",
        forWhom: "登山・野鳥・旅行で、荷物を軽くしたい人",
        caution: "センサーが小さいぶん、フルサイズほど背景をぼかしにくくなります。ぼかしたいときは、F値の小さい明るいレンズで補います。",
        official: "https://jp.omsystem.com/",
        cameraPrefixes: ["om digital", "om system", "olympus"],
    },
    {
        id: "panasonic",
        name: "Panasonic LUMIX",
        series: "S・G",
        mounts: "L マウント（S）・マイクロフォーサーズ（G）",
        sensors: "フルサイズ（S）・フォーサーズ（G）",
        character: "動画に強く、写真と動画を一台でこなす",
        detail: "フルサイズの S シリーズ（L マウント）と、小型の G シリーズ（マイクロフォーサーズ）があります。L マウントは Leica・SIGMA と共通の規格です。",
        forWhom: "写真と一緒に、動画も本格的に撮りたい人",
        caution: "S（フルサイズ）と G（マイクロフォーサーズ）でレンズは共通ではありません。動画で使うなら、記録形式や長回しでの熱の扱いを型番ごとに確かめましょう。",
        official: "https://panasonic.jp/dc/",
        cameraPrefixes: ["panasonic"],
    },
    {
        id: "ricoh",
        name: "RICOH / PENTAX",
        series: "GR・PENTAX K",
        mounts: "GR はレンズ一体、PENTAX は K マウント",
        sensors: "APS-C（GR）・APS-C とフルサイズ（PENTAX）",
        character: "ポケットに入るスナップ機と、光学ファインダーの一眼レフ",
        detail: "RICOH GR は、APS-C のセンサーを積んだ小さなスナップ用のカメラです。PENTAX は、光学ファインダーで撮る一眼レフを作り続けています。2つは向きがまったく違うので、別々に比べましょう。",
        forWhom: "身軽に街を撮りたい人、ファインダーで見たままを撮りたい人",
        caution: "GR はズームが無く、写る範囲は1つです（単焦点）。PENTAX の一眼レフは、同じクラスのミラーレスより本体が大きめになりがちです。",
        official: "https://www.ricoh-imaging.co.jp/japan/",
        cameraPrefixes: ["ricoh", "pentax"],
    },
];

/** 用途から選ぶ早見 */
export const USE_CASES: { need: string; look: string }[] = [
    { need: "旅行で軽く持ち歩きたい", look: "APS-C かマイクロフォーサーズの小さな機種、またはレンズ一体型（GR など）。レンズを付けた重さで比べる" },
    { need: "人物をきれいに撮りたい", look: "瞳 AF のある機種と、F値の小さい単焦点レンズ（50mm・85mm 前後）" },
    { need: "風景を細かく残したい", look: "画素の多いフルサイズか中判。三脚も一緒に考える" },
    { need: "動物・野鳥・スポーツ", look: "AF の追従が強い機種と望遠レンズ。マイクロフォーサーズは、写る範囲が 35mm判で焦点距離2倍のレンズに相当する（100mm なら 200mm 相当）。そのぶん望遠を軽くできる" },
    { need: "動画も撮りたい", look: "記録形式・手ぶれ補正・長回しの熱の扱いを型番ごとに確かめる（同じメーカーでも差が大きい）" },
    { need: "色を楽しみたい", look: "撮ってすぐの JPEG の色が好きなメーカーを、作例で探す（FUJIFILM のフィルムシミュレーションなど）" },
];

export type BuyingPoint = { title: string; body: string };

export const BUYING_CHECKLIST: BuyingPoint[] = [
    { title: "予算はレンズ込みで考える", body: "本体だけでなく、最初のレンズ・予備のバッテリー・記録メディア・持ち歩くバッグまで含めて決めましょう。中古を選ぶなら、保証と状態を確かめます。" },
    { title: "センサーの大きさと、持ち歩きを比べる", body: "フルサイズが常に正解ではありません。APS-C やマイクロフォーサーズは、レンズまで含めて小さくしやすい。中判は、細かさを最優先にする選び方です。" },
    { title: "レンズの選べる幅を先に見る", body: "風景なら広角、動物なら望遠、人物なら明るい単焦点。撮りたいものに要るレンズが、そのマウントで手に入るか、重さはどうかを確かめます。" },
    { title: "AF・手ぶれ補正・動画は型番ごとに", body: "同じメーカーでも、入門機と上位機で中身が大きく違います。動物の検出・手ぶれ補正・防塵防滴・動画の記録形式は、型番ごとに公式の仕様で確かめましょう。" },
    { title: "店で5つ試す", body: "① 握りやすさ ② ファインダーの見やすさ ③ メニューのわかりやすさ ④ レンズを付けた重さ ⑤ シャッターの感触。仕様表ではわからない相性があります。" },
];

export const SMARTPHONE_NOTE = [
    "まずは手元のスマートフォンで十分です。構図・光・ピントの位置は、カメラでもスマホでも同じように効きます。",
    "スマホで「背景をもっとぼかしたい」「遠くの鳥を大きく撮りたい」「暗い所でもっときれいに」と不足がはっきりしてきたら、それがカメラを選ぶいちばんの手がかりになります。",
];

export const BRANDS_FAQ: { q: string; a: string }[] = [
    { q: "初心者に一番おすすめのメーカーは？", a: "誰にとっても一番、というメーカーはありません。撮りたいもの・予算・重さ・使いたいレンズの4つで候補を絞り、店で実際に握って決めるのがおすすめです。" },
    { q: "フルサイズを買えば、写真は上達する？", a: "いいえ。上達に効くのは、構図・光・ピント・シャッタースピードの理解です。小さなセンサーのカメラやスマートフォンでも、すばらしい写真は撮れます。" },
    { q: "写真の色は、メーカーで決まる？", a: "撮ってすぐの JPEG の色づくりには各社の個性があります。ただ、光・ホワイトバランス・レンズ・RAW 現像でも色は大きく変わります。" },
    { q: "一度メーカーを決めたら、変えられない？", a: "変えられます。ただ、レンズはマウントごとに違うので、買い替えの費用がかかります。長く使うつもりなら、レンズの揃い方も重く見ましょう。" },
];

/** 写真の機種名（小文字にして比べる）が、そのメーカーのものか */
export function brandOfCamera(camera: string | undefined): Brand | undefined {
    if (!camera) return undefined;
    const c = camera.trim().toLowerCase();
    return BRANDS.find((b) => b.cameraPrefixes.some((p) => c.startsWith(p)));
}
