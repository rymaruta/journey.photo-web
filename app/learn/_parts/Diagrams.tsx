// app/learn/_parts/Diagrams.tsx（サーバーコンポーネント）
//
// **教科書の図（SVG）**（2026-11-04）。章のデータ（`Block.t === "diagram"`）が id で指す。
// 色は黒地に合わせる: 真鍮 #C9A66B（強調）・白（主）・#9A9A9A（補助）・白 12%（線）。
// 数値はすべて**目安**（図の下の説明に「目安」と書く）。装飾の図は読み上げに出さず、`role="img"` と
// `aria-label` で内容を伝える。

import React from "react";
import type { DiagramId } from "@/lib/data/learn/diagramIds";

const BRASS = "#C9A66B";
const WHITE = "#F0F0F0";
const DIM = "#9A9A9A";
const LINE = "rgba(255,255,255,0.14)";
const FONT = "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif";

function Frame({ label, w = 640, h, children }: { label: string; w?: number; h: number; children: React.ReactNode }) {
    return (
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="block w-full h-auto" style={{ fontFamily: FONT }}>
            <title>{label}</title>
            {children}
        </svg>
    );
}

const T = ({ x, y, children, size = 14, fill = WHITE, anchor = "middle", weight = 400 }: {
    x: number; y: number; children: React.ReactNode; size?: number; fill?: string; anchor?: "start" | "middle" | "end"; weight?: number;
}) => <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={weight}>{children}</text>;

/** F値ごとの絞りの穴。直径は F値に反比例（面積は F値の2乗に反比例＝1段ごとに半分） */
function ApertureSizes() {
    const fs = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
    const base = 88; // F1.4 の直径（px）
    return (
        <Frame label="F値ごとの絞りの穴の大きさ。F値が小さいほど穴が大きく、1段ごとに光の量は半分になる" h={230}>
            {fs.map((f, i) => {
                const d = (base * 1.4) / f;
                const cx = 58 + i * 78;
                return (
                    <g key={f}>
                        <circle cx={cx} cy={92} r={d / 2} fill={i < 3 ? BRASS : "none"} fillOpacity={i < 3 ? 0.18 : 0} stroke={BRASS} strokeWidth={1.6} />
                        <T x={cx} y={178} size={16} weight={600}>F{f}</T>
                    </g>
                );
            })}
            <T x={44} y={206} size={12} fill={DIM} anchor="start">← 穴が大きい・光が多い・背景がぼける</T>
            <T x={596} y={206} size={12} fill={DIM} anchor="end">穴が小さい・光が少ない・くっきり →</T>
        </Frame>
    );
}

/** ピントの合う奥行き（被写界深度）の浅い／深い */
function DepthOfField() {
    const panel = (x: number, title: string, sub: string, near: number, far: number, blur: string) => (
        <g transform={`translate(${x},0)`}>
            <T x={150} y={26} size={15} weight={600}>{title}</T>
            <T x={150} y={46} size={12} fill={DIM}>{sub}</T>
            <rect x={near} y={66} width={far - near} height={96} fill={BRASS} fillOpacity={0.16} />
            <line x1={near} y1={66} x2={near} y2={162} stroke={BRASS} strokeDasharray="4 4" />
            <line x1={far} y1={66} x2={far} y2={162} stroke={BRASS} strokeDasharray="4 4" />
            <line x1={0} y1={162} x2={300} y2={162} stroke={LINE} />
            {/* カメラ */}
            <rect x={6} y={100} width={26} height={30} rx={4} fill="none" stroke={WHITE} strokeWidth={1.4} />
            <circle cx={36} cy={115} r={6} fill="none" stroke={WHITE} strokeWidth={1.4} />
            {/* 被写体（ピントの位置） */}
            <circle cx={150} cy={115} r={12} fill={WHITE} />
            <T x={150} y={188} size={12} fill={DIM}>ピントを合わせた所</T>
            <T x={150} y={208} size={12} fill={BRASS}>{blur}</T>
        </g>
    );
    return (
        <Frame label="ピントが合って見える範囲（被写界深度）。左は浅く背景が大きくぼける。右は深く奥まで見える" h={228}>
            {panel(10, "浅い", "F値が小さい・近づく・望遠", 126, 174, "ここだけシャープ・前後はぼける")}
            {panel(330, "深い", "F値が大きい・離れる・広角", 70, 260, "広い範囲がシャープ")}
            <line x1={320} y1={20} x2={320} y2={210} stroke={LINE} />
        </Frame>
    );
}

/** シャッタースピードと動きの写り方 */
function ShutterMotion() {
    const items = [
        { t: "1/1000 秒", s: "止める", trail: 0 },
        { t: "1/60 秒", s: "少し流れる", trail: 34 },
        { t: "1/4 秒", s: "大きく流れる", trail: 110 },
    ];
    return (
        <Frame label="同じ速さで動く被写体のシャッタースピード別の写り方。速いと止まり、遅いと流れた線になる" h={196}>
            <defs>
                <linearGradient id="trail" x1="1" x2="0">
                    <stop offset="0" stopColor={WHITE} stopOpacity="0.85" />
                    <stop offset="1" stopColor={WHITE} stopOpacity="0" />
                </linearGradient>
            </defs>
            {items.map((it, i) => {
                const x0 = 18 + i * 208;
                return (
                    <g key={it.t}>
                        <rect x={x0} y={30} width={196} height={96} rx={10} fill="none" stroke={LINE} />
                        {it.trail > 0 && <rect x={x0 + 150 - it.trail} y={68} width={it.trail} height={20} fill="url(#trail)" />}
                        <circle cx={x0 + 150} cy={78} r={10} fill={WHITE} />
                        <T x={x0 + 98} y={156} size={15} weight={600}>{it.t}</T>
                        <T x={x0 + 98} y={178} size={12} fill={BRASS}>{it.s}</T>
                    </g>
                );
            })}
            <T x={320} y={18} size={12} fill={DIM}>右へ動く被写体（目安）</T>
        </Frame>
    );
}

/** 露出の3要素と「段」の梯子。右へ1つ動くと1段（光の量が2倍／半分） */
function ExposureLadder() {
    const rows: { name: string; vals: string[] }[] = [
        { name: "F値", vals: ["F8", "F5.6", "F4", "F2.8", "F2"] },
        { name: "シャッター", vals: ["1/125", "1/250", "1/500", "1/1000", "1/2000"] },
        { name: "ISO", vals: ["800", "400", "200", "100", "50"] },
    ];
    return (
        <Frame label="露出の梯子。F値・シャッター・ISO を1つ隣へ動かすと、光の量が2倍または半分になる（1段）" h={262}>
            <T x={320} y={22} size={13} fill={DIM}>左ほど暗い　→　右ほど明るく写る（F値は小さいほど明るい）</T>
            {rows.map((r, ri) => (
                <g key={r.name} transform={`translate(0,${44 + ri * 70})`}>
                    <T x={14} y={32} size={14} weight={600} anchor="start" fill={BRASS}>{r.name}</T>
                    {r.vals.map((v, i) => (
                        <g key={v}>
                            <rect x={110 + i * 100} y={8} width={92} height={40} rx={8} fill="none" stroke={LINE} />
                            <T x={110 + i * 100 + 46} y={34} size={15}>{v}</T>
                            {i > 0 && <T x={110 + i * 100 - 4} y={60} size={11} fill={DIM}>＋1段</T>}
                        </g>
                    ))}
                </g>
            ))}
        </Frame>
    );
}

/** ヒストグラムの形（暗い・標準・明るい・コントラストが高い） */
function HistogramShapes() {
    const shapes: { t: string; s: string; pts: string }[] = [
        { t: "暗い（アンダー）", s: "左に寄る", pts: "0,70 10,18 28,10 50,30 80,56 120,70" },
        { t: "標準", s: "山が中ほど", pts: "0,70 20,60 45,28 62,14 80,28 105,60 120,70" },
        { t: "明るい（オーバー）", s: "右に寄る", pts: "0,70 40,56 70,30 92,10 110,18 120,70" },
        { t: "コントラスト高", s: "両端に山", pts: "0,70 8,16 22,36 40,62 60,66 82,62 100,36 112,16 120,70" },
    ];
    return (
        <Frame label="ヒストグラムの4つの形。左が暗い部分、右が明るい部分。山が左に寄れば暗く、右に寄れば明るい" h={222}>
            {shapes.map((sh, i) => {
                const x0 = 14 + i * 156;
                return (
                    <g key={sh.t} transform={`translate(${x0},20)`}>
                        <rect x={0} y={0} width={140} height={84} rx={6} fill="none" stroke={LINE} />
                        <g transform="translate(10,6)">
                            <polygon points={sh.pts} fill={BRASS} fillOpacity={0.28} stroke={BRASS} strokeWidth={1.5} />
                        </g>
                        <T x={70} y={116} size={14} weight={600}>{sh.t}</T>
                        <T x={70} y={136} size={12} fill={DIM}>{sh.s}</T>
                    </g>
                );
            })}
            <T x={20} y={190} size={12} fill={DIM} anchor="start">左端＝真っ黒</T>
            <T x={620} y={190} size={12} fill={DIM} anchor="end">右端＝真っ白（白飛び）</T>
            <line x1={150} y1={186} x2={410} y2={186} stroke={LINE} />
            <T x={280} y={206} size={12} fill={DIM}>横軸＝明るさ　縦軸＝その明るさの量</T>
        </Frame>
    );
}

/** 色温度の目盛り（目安） */
function ColorTemperature() {
    const stops: { k: string; l: string; x: number }[] = [
        { k: "約2000K", l: "ろうそく", x: 40 },
        { k: "約3000K", l: "電球", x: 150 },
        { k: "約4000K", l: "朝夕の日の光", x: 260 },
        { k: "約5500K", l: "昼の日なた", x: 370 },
        { k: "約6500K", l: "くもり", x: 480 },
        { k: "約8000K", l: "日陰", x: 590 },
    ];
    return (
        <Frame label="光の色温度の目安。低いほどオレンジ、高いほど青っぽい" h={190}>
            <defs>
                <linearGradient id="kelvin" x1="0" x2="1">
                    <stop offset="0" stopColor="#FF8A2B" />
                    <stop offset="0.3" stopColor="#FFC27A" />
                    <stop offset="0.55" stopColor="#FFF6EA" />
                    <stop offset="0.8" stopColor="#CFE0FF" />
                    <stop offset="1" stopColor="#8DB4FF" />
                </linearGradient>
            </defs>
            <rect x={20} y={40} width={600} height={28} rx={14} fill="url(#kelvin)" />
            {stops.map((s) => (
                <g key={s.k}>
                    <line x1={s.x} y1={68} x2={s.x} y2={82} stroke={LINE} />
                    <T x={s.x} y={102} size={13} weight={600}>{s.k}</T>
                    <T x={s.x} y={122} size={12} fill={DIM}>{s.l}</T>
                </g>
            ))}
            <T x={20} y={28} size={12} fill={DIM} anchor="start">オレンジっぽい（低い）</T>
            <T x={620} y={28} size={12} fill={DIM} anchor="end">青っぽい（高い）</T>
            <T x={320} y={160} size={12} fill={BRASS}>ホワイトバランスは、この色を「白」に見えるよう打ち消す設定</T>
        </Frame>
    );
}

/** 焦点距離と画角（フルサイズ換算の目安） */
function FocalAngles() {
    const lenses: { mm: number; deg: number; c: string }[] = [
        { mm: 24, deg: 84, c: "広い" },
        { mm: 50, deg: 47, c: "標準" },
        { mm: 85, deg: 29, c: "中望遠" },
        { mm: 200, deg: 12, c: "望遠" },
    ];
    const ox = 230, oy = 214, len = 190;
    return (
        <Frame label="焦点距離と画角（フルサイズ換算の目安）。24mmは約84度、50mmは約47度、85mmは約29度、200mmは約12度" h={236}>
            {lenses.map((l, i) => {
                const a = (l.deg / 2) * Math.PI / 180;
                const x1 = ox - Math.sin(a) * len, x2 = ox + Math.sin(a) * len, y = oy - Math.cos(a) * len;
                return (
                    <g key={l.mm}>
                        <polygon points={`${ox},${oy} ${x1},${y} ${x2},${y}`} fill={BRASS} fillOpacity={0.07 + i * 0.02} stroke={BRASS} strokeOpacity={0.5 + i * 0.15} />
                        <circle cx={470} cy={64 + i * 34} r={5} fill={BRASS} fillOpacity={0.4 + i * 0.2} />
                        <T x={486} y={69 + i * 34} size={14} weight={600} anchor="start">{l.mm}mm　約{l.deg}°　{l.c}</T>
                    </g>
                );
            })}
            <circle cx={ox} cy={oy} r={7} fill={WHITE} />
            <T x={ox} y={232} size={12} fill={DIM}>カメラ</T>
        </Frame>
    );
}

/** 光の向き（順光・サイド光・逆光）を上から見た図 */
function LightDirection() {
    const items = [
        { t: "順光", s: "後ろから当たる", sun: [150, 150] as const },
        { t: "サイド光", s: "横から当たる", sun: [30, 70] as const },
        { t: "逆光", s: "向こうから当たる", sun: [150, 10] as const },
    ];
    return (
        <Frame label="光の向き。順光は被写体の正面、サイド光は横、逆光は後ろから光が当たる" h={252}>
            {items.map((it, i) => {
                const x0 = 12 + i * 208;
                const [sx, sy] = it.sun;
                const subj = { x: 100, y: 80 };
                return (
                    <g key={it.t} transform={`translate(${x0},14)`}>
                        <rect x={0} y={0} width={196} height={170} rx={10} fill="none" stroke={LINE} />
                        <circle cx={subj.x} cy={subj.y} r={16} fill={WHITE} />
                        <circle cx={sx + 20} cy={sy + 8} r={10} fill={BRASS} />
                        <line x1={sx + 20} y1={sy + 8} x2={subj.x} y2={subj.y} stroke={BRASS} strokeDasharray="3 4" />
                        <rect x={86} y={134} width={28} height={22} rx={4} fill="none" stroke={WHITE} strokeWidth={1.4} />
                        <T x={100} y={196} size={15} weight={600}>{it.t}</T>
                        <T x={100} y={216} size={12} fill={DIM}>{it.s}</T>
                    </g>
                );
            })}
        </Frame>
    );
}

/** 時間帯と光の色・影（目安） */
function TimeOfDay() {
    const slots = [
        { t: "朝", c: "#9DB7E8", s: "青っぽい→金色", sh: "影は長い" },
        { t: "午前", c: "#F6EBD5", s: "白っぽく明るい", sh: "影は短め" },
        { t: "昼", c: "#FFFFFF", s: "強く硬い光", sh: "影は真下・濃い" },
        { t: "夕方", c: "#F2B66B", s: "金色〜オレンジ", sh: "影は長い" },
        { t: "夜", c: "#3E5A99", s: "人工光と青い空", sh: "—" },
    ];
    return (
        <Frame label="時間帯ごとの光の目安。朝夕は金色で影が長く、昼は強く硬い光で影が短い" h={196}>
            {slots.map((s, i) => {
                const x0 = 12 + i * 124;
                return (
                    <g key={s.t} transform={`translate(${x0},16)`}>
                        <rect x={0} y={0} width={112} height={72} rx={10} fill={s.c} fillOpacity={0.9} />
                        <T x={56} y={44} size={20} weight={700} fill="#111">{s.t}</T>
                        <T x={56} y={108} size={13} weight={600}>{s.s}</T>
                        <T x={56} y={130} size={12} fill={DIM}>{s.sh}</T>
                    </g>
                );
            })}
            <T x={320} y={186} size={12} fill={BRASS}>日の出・日の入りの前後 約1時間が「ゴールデンアワー」（季節・緯度で変わる）</T>
        </Frame>
    );
}

/** 手ぶれしにくい目安（焦点距離とシャッタースピード） */
function HandheldRule() {
    const rows = [
        { mm: "24mm", ss: "1/30 秒", w: 40 },
        { mm: "50mm", ss: "1/60 秒", w: 80 },
        { mm: "100mm", ss: "1/125 秒", w: 160 },
        { mm: "200mm", ss: "1/250 秒", w: 320 },
    ];
    return (
        <Frame label="手持ちで手ぶれしにくいシャッタースピードの目安。焦点距離の分の1秒より速く（フルサイズ換算）" h={226}>
            <T x={20} y={24} size={12} fill={DIM} anchor="start">焦点距離（フルサイズ換算）と、手持ちの目安シャッター（これより速く）</T>
            {rows.map((r, i) => (
                <g key={r.mm} transform={`translate(0,${40 + i * 44})`}>
                    <T x={20} y={22} size={15} weight={600} anchor="start">{r.mm}</T>
                    <rect x={110} y={6} width={r.w} height={22} rx={6} fill={BRASS} fillOpacity={0.5} />
                    <T x={118 + r.w} y={22} size={14} anchor="start">{r.ss}</T>
                </g>
            ))}
            <T x={320} y={216} size={12} fill={DIM}>手ぶれ補正があれば数段ぶん余裕がある（効き方は機種で違う）</T>
        </Frame>
    );
}


/** 同じ大きさの人物を、広角で近づく／望遠で離れて撮ったときの背景の違い */
function PerspectiveCompression() {
    const panel = (x: number, title: string, sub: string, mount: number, person: number, dist: string) => (
        <g transform={`translate(${x},0)`}>
            <rect x={0} y={24} width={290} height={150} rx={10} fill="none" stroke={LINE} />
            <polygon points={`0,174 ${60},${174 - mount} 120,174`} fill={DIM} fillOpacity={0.35} />
            <polygon points={`80,174 ${170},${174 - mount * 1.15} 260,174`} fill={DIM} fillOpacity={0.45} />
            <circle cx={145} cy={174 - person - 12} r={12} fill={WHITE} />
            <rect x={135} y={174 - person} width={20} height={person} rx={4} fill={WHITE} />
            <T x={145} y={204} size={15} weight={600}>{title}</T>
            <T x={145} y={224} size={12} fill={DIM}>{sub}</T>
            <T x={145} y={244} size={12} fill={BRASS}>{dist}</T>
        </g>
    );
    return (
        <Frame label="同じ大きさの人物を撮るとき、広角で近づくと背景は小さく遠く、望遠で離れると背景は大きく迫って見える" h={262}>
            {panel(20, "広角（24mm）で近づく", "背景が小さく、遠くに見える", 34, 66, "人物との距離 近い")}
            {panel(330, "望遠（135mm）で離れる", "背景が大きく、迫って見える", 98, 66, "人物との距離 遠い")}
        </Frame>
    );
}

/** センサーの大きさ（同じ像の円の上に重ねた実寸比） */
function CropFactor() {
    const k = 12; // 1mm = 12px
    const boxes = [
        { w: 36 * k, h: 24 * k, t: "フルサイズ 36×24mm", s: "換算 1倍", c: WHITE },
        { w: 23.6 * k, h: 15.7 * k, t: "APS-C 23.6×15.7mm", s: "換算 約1.5倍", c: BRASS },
        { w: 17.3 * k, h: 13 * k, t: "マイクロフォーサーズ 17.3×13mm", s: "換算 約2倍", c: "#9DB7E8" },
    ];
    const cx = 236, cy = 150;
    return (
        <Frame label="センサーの大きさの比較。フルサイズが最も大きく、APS-Cは約1.5倍、マイクロフォーサーズは約2倍の換算になる" w={720} h={300}>
            {boxes.map((b) => (
                <rect key={b.t} x={cx - b.w / 2} y={cy - b.h / 2} width={b.w} height={b.h} fill="none" stroke={b.c} strokeWidth={2} />
            ))}
            {boxes.map((b, i) => (
                <g key={b.t}>
                    <rect x={470} y={54 + i * 68} width={14} height={14} fill="none" stroke={b.c} strokeWidth={2} />
                    <T x={494} y={66 + i * 68} size={14} weight={600} anchor="start">{b.t}</T>
                    <T x={494} y={86 + i * 68} size={12} fill={DIM} anchor="start">{b.s}</T>
                </g>
            ))}
        </Frame>
    );
}

/** トーンカーブの4つの形 */
function ToneCurve() {
    const panels: { t: string; s: string; d: string }[] = [
        { t: "直線", s: "変化なし", d: "M0,100 L100,0" },
        { t: "S字", s: "メリハリが出る", d: "M0,100 C30,100 30,70 50,50 C70,30 70,0 100,0" },
        { t: "逆S字", s: "やわらかくなる", d: "M0,100 C0,70 30,65 50,50 C70,35 100,30 100,0" },
        { t: "黒を持ち上げ", s: "しっとり・淡い", d: "M0,78 L100,0" },
    ];
    return (
        <Frame label="トーンカーブの形。S字はメリハリが出て、逆S字はやわらかく、黒を持ち上げるとしっとり淡くなる" h={226}>
            {panels.map((p, i) => (
                <g key={p.t} transform={`translate(${24 + i * 154},18)`}>
                    <rect x={0} y={0} width={110} height={110} fill="none" stroke={LINE} />
                    <line x1={0} y1={110} x2={110} y2={0} stroke={LINE} strokeDasharray="3 4" />
                    <g transform="translate(5,5) scale(1,1)"><svg x={0} y={0} width={100} height={100} viewBox="0 0 100 100"><path d={p.d} fill="none" stroke={BRASS} strokeWidth={2.4} /></svg></g>
                    <T x={55} y={140} size={14} weight={600}>{p.t}</T>
                    <T x={55} y={160} size={12} fill={DIM}>{p.s}</T>
                </g>
            ))}
            <T x={320} y={208} size={12} fill={DIM}>横＝もとの明るさ（左が暗い・右が明るい）　縦＝仕上がりの明るさ</T>
        </Frame>
    );
}

/** 現像の順番 */
function DevelopOrder() {
    const steps = ["選ぶ", "切り抜き・傾き", "色（WB）", "明るさ・コントラスト", "部分補正", "細部（シャープ・ノイズ）", "書き出し"];
    return (
        <Frame label="現像の順番。選ぶ、切り抜きと傾き、色、明るさとコントラスト、部分補正、細部、書き出し" h={196}>
            {steps.map((s, i) => {
                const col = i % 4, row = Math.floor(i / 4);
                const x = 20 + col * 154, y = 22 + row * 84;
                return (
                    <g key={s}>
                        <rect x={x} y={y} width={138} height={60} rx={10} fill="none" stroke={i === steps.length - 1 ? BRASS : LINE} />
                        <T x={x + 14} y={y + 24} size={12} fill={BRASS} anchor="start">{i + 1}</T>
                        <T x={x + 69} y={y + 44} size={13} weight={600}>{s}</T>
                    </g>
                );
            })}
            <T x={320} y={186} size={12} fill={DIM}>大きな直しから、細かい直しへ（目安）</T>
        </Frame>
    );
}

/** フラッシュの直当てとバウンス */
function FlashBounce() {
    return (
        <Frame label="フラッシュの直当てとバウンス。直当ては硬い影、天井や壁に当てるバウンスは光が広がってやわらかい" h={236}>
            <g transform="translate(10,0)">
                <T x={150} y={24} size={15} weight={600}>直当て</T>
                <line x1={20} y1={170} x2={290} y2={170} stroke={LINE} />
                <circle cx={150} cy={140} r={14} fill={WHITE} />
                <rect x={30} y={120} width={22} height={28} rx={4} fill="none" stroke={WHITE} strokeWidth={1.4} />
                <line x1={52} y1={132} x2={134} y2={138} stroke={BRASS} strokeWidth={2} />
                <ellipse cx={186} cy={165} rx={26} ry={5} fill={WHITE} fillOpacity={0.35} />
                <T x={150} y={198} size={12} fill={DIM}>光が正面から一方向</T>
                <T x={150} y={218} size={12} fill={BRASS}>影が硬く、背後にくっきり出る</T>
            </g>
            <g transform="translate(330,0)">
                <T x={150} y={24} size={15} weight={600}>バウンス（天井・壁に当てる）</T>
                <line x1={20} y1={50} x2={290} y2={50} stroke={WHITE} strokeWidth={2} />
                <line x1={20} y1={170} x2={290} y2={170} stroke={LINE} />
                <circle cx={150} cy={140} r={14} fill={WHITE} />
                <rect x={30} y={120} width={22} height={28} rx={4} fill="none" stroke={WHITE} strokeWidth={1.4} />
                <line x1={52} y1={120} x2={110} y2={52} stroke={BRASS} strokeWidth={2} />
                <line x1={110} y1={52} x2={140} y2={126} stroke={BRASS} strokeWidth={2} strokeDasharray="4 3" />
                <line x1={110} y1={52} x2={170} y2={124} stroke={BRASS} strokeWidth={2} strokeDasharray="4 3" />
                <T x={150} y={198} size={12} fill={DIM}>光が広い面で反射してから当たる</T>
                <T x={150} y={218} size={12} fill={BRASS}>影がやわらかい（天井が白いとき）</T>
            </g>
            <line x1={320} y1={16} x2={320} y2={226} stroke={LINE} />
        </Frame>
    );
}

/** 青空を絞って撮ると、センサーのゴミが点で写る */
function SensorDustTest() {
    const dots = [[120, 80], [210, 112], [330, 70], [420, 130], [500, 92], [260, 150]];
    return (
        <Frame label="センサーのゴミの見つけ方。F11以上に絞って青空や白い壁を撮ると、ゴミが暗い点として写る" h={236}>
            <rect x={24} y={22} width={440} height={170} rx={10} fill="#8DB4FF" fillOpacity={0.5} />
            {dots.slice(0, 5).map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={4} fill="#0E0E0F" fillOpacity={0.75} />)}
            <T x={244} y={214} size={12} fill={DIM}>絞り F11〜F16・ピントはぼかす・無地の明るい面で撮る</T>
            <text x={490} y={64} fontSize={13} fill={WHITE} fontWeight={600}>写真の中の暗い点</text>
            <text x={490} y={86} fontSize={12} fill={DIM}>＝ゴミが写った所</text>
            <text x={490} y={116} fontSize={12} fill={BRASS}>同じ位置に出るなら</text>
            <text x={490} y={134} fontSize={12} fill={BRASS}>センサー側のゴミ</text>
        </Frame>
    );
}

/** バックアップの 3-2-1 */
function Backup321() {
    const boxes = [
        { t: "元のデータ", s: "カメラ・パソコン", n: "1つ目" },
        { t: "もう1つのコピー", s: "外付けディスクなど（別の種類）", n: "2つ目" },
        { t: "別の場所のコピー", s: "クラウドや、別の家に置く", n: "3つ目" },
    ];
    return (
        <Frame label="バックアップの3-2-1。コピーを3つ、2種類の媒体に、1つは別の場所に置く" h={196}>
            {boxes.map((b, i) => (
                <g key={b.t} transform={`translate(${20 + i * 208},24)`}>
                    <rect x={0} y={0} width={192} height={96} rx={12} fill="none" stroke={i === 2 ? BRASS : LINE} />
                    <T x={96} y={30} size={12} fill={BRASS}>{b.n}</T>
                    <T x={96} y={56} size={15} weight={600}>{b.t}</T>
                    <T x={96} y={78} size={11} fill={DIM}>{b.s}</T>
                </g>
            ))}
            <T x={320} y={150} size={14} weight={600}>3つのコピー ・ 2種類の媒体 ・ 1つは別の場所</T>
            <T x={320} y={172} size={12} fill={DIM}>火事・盗難・故障が、1か所で全部のコピーを失わせないための考え方</T>
        </Frame>
    );
}

/** 星が点で写るシャッター秒数の目安（500 ルール） */
function StarTrailRule() {
    const rows = [
        { mm: "14mm", s: 35, t: "約35秒" },
        { mm: "24mm", s: 20, t: "約20秒" },
        { mm: "35mm", s: 14, t: "約14秒" },
        { mm: "50mm", s: 10, t: "約10秒" },
    ];
    return (
        <Frame label="星を点で写すシャッター秒数の目安（500ルール）。焦点距離が長いほど短くする" h={236}>
            <T x={20} y={22} size={12} fill={DIM} anchor="start">フルサイズ換算の焦点距離と、星が点で写りやすい秒数の目安（500 ÷ 焦点距離）</T>
            {rows.map((r, i) => (
                <g key={r.mm} transform={`translate(0,${40 + i * 40})`}>
                    <T x={20} y={22} size={15} weight={600} anchor="start">{r.mm}</T>
                    <rect x={100} y={6} width={r.s * 12} height={22} rx={6} fill={BRASS} fillOpacity={0.5} />
                    <T x={108 + r.s * 12} y={22} size={14} anchor="start">{r.t}</T>
                </g>
            ))}
            <T x={320} y={226} size={12} fill={DIM}>高画素のカメラでは、これより短めにすると星が点になりやすい（機種で違う）</T>
        </Frame>
    );
}

/** 料理を撮る角度 */
function ShootingAngle() {
    const items = [
        { t: "真上", s: "皿の模様・盛りつけの全体", ex: "ピザ・弁当・テーブル全体", k: 0 },
        { t: "斜め45度", s: "立体感と全体が両立する定番", ex: "パスタ・丼・デザート", k: 45 },
        { t: "真横", s: "高さ・層を見せる", ex: "ハンバーガー・パフェ・ケーキ", k: 90 },
    ];
    return (
        <Frame label="料理を撮る角度。真上は皿全体、斜め45度は立体感、真横は高さや層を見せる" h={232}>
            {items.map((it, i) => {
                const x0 = 12 + i * 208;
                const a = (it.k * Math.PI) / 180;
                return (
                    <g key={it.t} transform={`translate(${x0},14)`}>
                        <rect x={0} y={0} width={196} height={110} rx={10} fill="none" stroke={LINE} />
                        <ellipse cx={98} cy={74} rx={50} ry={Math.max(8, 30 * Math.cos(a))} fill={WHITE} fillOpacity={0.12} stroke={WHITE} />
                        <circle cx={98} cy={74 - Math.max(0, 14 * Math.sin(a))} r={14 - 3 * Math.sin(a)} fill={BRASS} fillOpacity={0.55} />
                        <T x={98} y={138} size={15} weight={600}>{it.t}</T>
                        <T x={98} y={158} size={12} fill={DIM}>{it.s}</T>
                        <T x={98} y={178} size={12} fill={BRASS}>{it.ex}</T>
                    </g>
                );
            })}
        </Frame>
    );
}

/** 雪・白い壁は露出補正を＋にする */
function ExposureCompensationSnow() {
    const items = [
        { t: "補正 0", s: "雪がグレーに写る", c: "#9A9A9A" },
        { t: "＋0.7", s: "少し明るい", c: "#CFCFCF" },
        { t: "＋1.3", s: "白に近い（目安）", c: "#F3F3F3" },
    ];
    return (
        <Frame label="雪や白い壁は、露出補正が0だとグレーに写りやすい。プラスにすると白に近づく" h={224}>
            {items.map((it, i) => (
                <g key={it.t} transform={`translate(${24 + i * 204},20)`}>
                    <rect x={0} y={0} width={188} height={100} rx={10} fill={it.c} />
                    <T x={94} y={138} size={15} weight={600}>{it.t}</T>
                    <T x={94} y={158} size={12} fill={DIM}>{it.s}</T>
                </g>
            ))}
            <T x={320} y={208} size={12} fill={BRASS}>カメラは「画面全体が平均的な明るさ」になるよう決めるので、白一色を暗く写しがち</T>
        </Frame>
    );
}

const DIAGRAMS: Record<DiagramId, () => React.ReactElement> = {
    "aperture-sizes": ApertureSizes,
    "depth-of-field": DepthOfField,
    "shutter-motion": ShutterMotion,
    "exposure-ladder": ExposureLadder,
    "histogram-shapes": HistogramShapes,
    "color-temperature": ColorTemperature,
    "focal-angles": FocalAngles,
    "light-direction": LightDirection,
    "time-of-day": TimeOfDay,
    "handheld-rule": HandheldRule,
    "perspective-compression": PerspectiveCompression,
    "crop-factor": CropFactor,
    "tone-curve": ToneCurve,
    "develop-order": DevelopOrder,
    "flash-bounce": FlashBounce,
    "sensor-dust-test": SensorDustTest,
    "backup-3-2-1": Backup321,
    "star-trail-rule": StarTrailRule,
    "shooting-angle": ShootingAngle,
    "exposure-compensation-snow": ExposureCompensationSnow,
};

export function Diagram({ id, caption }: { id: DiagramId; caption: string }) {
    const Fig = DIAGRAMS[id];
    return (
        <figure className="m-0 mt-6 rounded-2xl bg-surface ring-1 ring-line p-4 sm:p-5" data-testid="learn-diagram">
            {/* 電話の幅では図の字が小さくなるので、図は 560 の幅を保って横に動かせる（頁は横に動かさない） */}
            <div className="overflow-x-auto -mx-1 px-1" role="group" aria-label="図（横に動かせます）" tabIndex={0}>
                <div style={{ minWidth: 560 }}><Fig /></div>
            </div>
            <figcaption className="mt-3 text-text-2" style={{ fontSize: "13px", lineHeight: "20px" }}>{caption}</figcaption>
        </figure>
    );
}
