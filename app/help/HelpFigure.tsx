// app/help/HelpFigure.tsx（サーバーコンポーネント）
//
// **使い方の頁の絵**（2026-11-12・札 journey.photo-ios#517）。1頁に1枚。
//
// 本物の画面写真は使わない（人の写真や名前が写る・言葉を直しても絵が古いまま残る）。
// デザインの板「黒塗りの真鍮」（DesignSystem・PassSettings・Settings・Report・TravelTrunk の板）の色で、
// 画面の形だけを簡単に描く:
//   - 地は黒、札は surface（#0E0E0F）に白8% の縁、入力やシートは surface-2（#161617）
//   - 真鍮（#C9A66B）は**黒い地の上だけ**（押す所の印・地図のピン・硬貨）。写真の上には置かない
//   - 写真の部分は**抽象の色面**（グラデーション）。利用者の写真は使わない（2026-11-12 owner「他人の写真は、その人のもの」）
//   - 危険の色は #F0565A（ブロック・通報の行）
//   - 字は 12 以上（絵の座標で 12。頁の幅では 12 より大きく出る）。目次の札の小さい絵では字を隠す（`.fig-text`）

import React from "react";

const C = {
    bg: "#000000",
    s1: "#0E0E0F",
    s2: "#161617",
    s5: "#1E1E20",
    hair: "rgba(255,255,255,0.08)",
    line: "rgba(255,255,255,0.14)",
    outline: "#666666",
    text: "#F0F0F0",
    text2: "#B8B8B8",
    text3: "#9A9A9A",
    brass: "#C9A66B",
    brassFill: "#B8955A",
    brassDeep: "#796440",
    brassHi: "#F3DCA6",
    brassLo: "#9A7A45",
    danger: "#F0565A",
    ink: "#07090A",
};

/** 写真の代わりの色面（夕焼け・空・森・夜・霧・紅葉）。人の写真は使わない */
const PHOTO_GRADIENTS: Array<[string, string]> = [
    ["#2a1838", "#d4683f"],
    ["#9fc8e8", "#2f6f9a"],
    ["#5f8a4c", "#2c4a25"],
    ["#05081a", "#1d2f5c"],
    ["#bcd0e2", "#4d4035"],
    ["#7a3a1c", "#e9a548"],
];

function PhotoDefs({ id }: { id: string }) {
    return (
        <defs>
            {PHOTO_GRADIENTS.map(([a, b], i) => (
                <linearGradient key={i} id={`${id}-p${i}`} x1="0" y1="0" x2="0.35" y2="1">
                    <stop offset="0" stopColor={a} />
                    <stop offset="1" stopColor={b} />
                </linearGradient>
            ))}
            <linearGradient id={`${id}-coin`} x1="0" y1="0" x2="0.5" y2="1">
                <stop offset="0" stopColor={C.brassHi} />
                <stop offset="0.55" stopColor={C.brass} />
                <stop offset="1" stopColor={C.brassLo} />
            </linearGradient>
        </defs>
    );
}

const photo = (id: string, i: number) => `url(#${id}-p${i % PHOTO_GRADIENTS.length})`;

/** 絵の中の字（目次の小さい絵では隠す） */
function T({ x, y, children, fill = C.text3, size = 12, anchor = "middle", weight }: {
    x: number; y: number; children: React.ReactNode; fill?: string; size?: number; anchor?: "start" | "middle" | "end"; weight?: number;
}) {
    return (
        <text className="fig-text" x={x} y={y} fill={fill} fontSize={size} textAnchor={anchor} fontWeight={weight}>
            {children}
        </text>
    );
}

/** 押す所の印（真鍮の輪）。黒地の上だけに置く */
const Ring = ({ cx, cy, r = 17 }: { cx: number; cy: number; r?: number }) => (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.brass} strokeWidth={2} />
);

function Pass({ id }: { id: string }) {
    return (
        <>
            {[30, 226].map((x, i) => (
                <g key={x}>
                    <rect x={x} y={30} width={64} height={128} rx={14} fill={C.s2} stroke={C.outline} />
                    <rect x={x + 14} y={58} width={36} height={52} rx={4} fill={photo(id, i === 0 ? 0 : 1)} stroke={i === 0 ? C.brass : C.line} />
                    <rect x={x + 14} y={118} width={36} height={6} rx={3} fill={C.line} />
                </g>
            ))}
            <path d="M104 80 H216" stroke={C.brass} strokeWidth={2} strokeDasharray="4 5" fill="none" />
            <path d="M210 74 L218 80 L210 86" stroke={C.brass} strokeWidth={2} fill="none" />
            <path d="M104 110 H216" stroke={C.text2} strokeWidth={2} strokeDasharray="4 5" fill="none" />
            <path d="M110 104 L102 110 L110 116" stroke={C.text2} strokeWidth={2} fill="none" />
            <T x={160} y={66}>近くにいるだけ</T>
            <T x={160} y={136}>写真1枚ずつ</T>
            <T x={160} y={186}>届いたカードは、すれちがい帳に残る</T>
        </>
    );
}

function Messages({ id }: { id: string }) {
    return (
        <>
            <rect x={60} y={14} width={200} height={172} rx={16} fill={C.s1} stroke={C.hair} />
            <T x={78} y={44} fill={C.text} size={15} anchor="start" weight={600}>メッセージ</T>
            {/* 見出しの右の鉛筆（新しいメッセージ） */}
            <g transform="translate(228 38)">
                <Ring cx={0} cy={0} r={15} />
                <path d="M-6 5 L-6 1 L3 -8 L7 -4 L-2 5 Z" fill="none" stroke={C.text} strokeWidth={1.6} strokeLinejoin="round" />
            </g>
            {/* リクエストの行 */}
            <rect x={72} y={62} width={176} height={34} rx={10} fill={C.s2} />
            <T x={86} y={84} fill={C.text} size={13} anchor="start">リクエスト</T>
            <circle cx={226} cy={79} r={10} fill={C.brass} stroke={C.bg} strokeWidth={2} />
            <T x={226} y={83} fill={C.ink} size={12} weight={700}>2</T>
            {/* 会話の行 */}
            {[0, 1].map((i) => (
                <g key={i}>
                    <circle cx={92} cy={122 + i * 40} r={13} fill={photo(id, i + 2)} />
                    <rect x={114} y={113 + i * 40} width={80} height={7} rx={3.5} fill={C.text2} />
                    <rect x={114} y={126 + i * 40} width={118} height={6} rx={3} fill={C.line} />
                </g>
            ))}
        </>
    );
}

function Trunk({ id }: { id: string }) {
    return (
        <>
            {/* 硬貨 */}
            <circle cx={48} cy={92} r={22} fill={`url(#${id}-coin)`} />
            <circle cx={48} cy={92} r={16} fill="none" stroke="#6B5126" strokeWidth={1.2} />
            <path d="M80 92 H108" stroke={C.text2} strokeWidth={2} fill="none" />
            <path d="M102 86 L110 92 L102 98" stroke={C.text2} strokeWidth={2} fill="none" />
            {/* カプセルの機械 */}
            <circle cx={160} cy={70} r={34} fill={C.s2} stroke={C.outline} />
            <circle cx={148} cy={64} r={9} fill="#C8323A" />
            <circle cx={170} cy={58} r={9} fill="#9CC3E6" />
            <circle cx={166} cy={80} r={9} fill="#E7B38C" />
            <rect x={128} y={100} width={64} height={52} rx={8} fill={C.s2} stroke={C.outline} />
            <circle cx={160} cy={124} r={11} fill="none" stroke={C.brass} strokeWidth={2} />
            <path d="M160 116 V132" stroke={C.brass} strokeWidth={2} />
            <path d="M212 92 H240" stroke={C.text2} strokeWidth={2} fill="none" />
            <path d="M234 86 L242 92 L234 98" stroke={C.text2} strokeWidth={2} fill="none" />
            {/* 部品（持ち手） */}
            <path d="M256 104 V88 a12 12 0 0 1 12 -12 h12 a12 12 0 0 1 12 12 V104" fill="none" stroke="#6B4A2C" strokeWidth={7} strokeLinecap="round" />
            <rect x={250} y={100} width={14} height={9} rx={2} fill={C.brass} />
            <rect x={286} y={100} width={14} height={9} rx={2} fill={C.brass} />
            <T x={48} y={136}>硬貨1枚</T>
            <T x={160} y={176}>カプセルの機械</T>
            <T x={274} y={136}>部品</T>
        </>
    );
}

function Safety({ id }: { id: string }) {
    return (
        <>
            <rect x={40} y={14} width={240} height={172} rx={16} fill={C.s1} stroke={C.hair} />
            <circle cx={78} cy={52} r={20} fill={photo(id, 4)} />
            <rect x={108} y={42} width={70} height={8} rx={4} fill={C.text2} />
            <rect x={108} y={56} width={48} height={6} rx={3} fill={C.line} />
            {/* 右上の「…」 */}
            <Ring cx={250} cy={40} r={15} />
            {[-6, 0, 6].map((d) => <circle key={d} cx={250 + d} cy={40} r={1.8} fill={C.text} />)}
            {/* 開いたメニュー */}
            <rect x={126} y={72} width={140} height={84} rx={12} fill={C.s5} stroke={C.line} />
            <T x={142} y={102} fill={C.text} size={13} anchor="start">通報する</T>
            <path d="M126 114 H266" stroke={C.hair} />
            <T x={142} y={140} fill={C.danger} size={13} anchor="start">この人をブロック</T>
            <rect x={56} y={88} width={56} height={56} rx={6} fill={photo(id, 2)} opacity={0.55} />
        </>
    );
}

function Post({ id }: { id: string }) {
    return (
        <>
            {/* 出てくる選択 */}
            <rect x={50} y={12} width={220} height={108} rx={16} fill={C.s2} stroke={C.line} />
            <rect x={66} y={26} width={30} height={30} rx={6} fill={photo(id, 0)} />
            <T x={108} y={46} fill={C.text} size={14} anchor="start">写真を投稿</T>
            <path d="M66 66 H254" stroke={C.hair} />
            <circle cx={81} cy={91} r={15} fill="none" stroke={C.brass} strokeWidth={2} strokeDasharray="5 3" />
            <T x={108} y={96} fill={C.text} size={14} anchor="start">ストーリーを投稿</T>
            {/* 下のタブ */}
            <rect x={20} y={140} width={280} height={50} rx={14} fill={C.s1} stroke={C.hair} />
            {[52, 106, 214, 268].map((x) => <circle key={x} cx={x} cy={160} r={7} fill="none" stroke={C.text3} strokeWidth={1.6} />)}
            <rect x={150} y={150} width={20} height={20} rx={5} fill="none" stroke={C.text} strokeWidth={1.8} />
            <path d="M160 155 V165 M155 160 H165" stroke={C.text} strokeWidth={1.8} />
            <Ring cx={160} cy={160} r={18} />
            <T x={160} y={186} fill={C.text} size={12}>投稿</T>
        </>
    );
}

function Stories({ id }: { id: string }) {
    return (
        <>
            <rect x={90} y={8} width={140} height={184} rx={16} fill={photo(id, 5)} />
            {/* 進み具合の線 */}
            <rect x={100} y={18} width={58} height={3} rx={1.5} fill="#FFFFFF" />
            <rect x={162} y={18} width={58} height={3} rx={1.5} fill="rgba(255,255,255,0.4)" />
            {/* 左の3分の1 */}
            <path d={`M${90 + 140 / 3} 30 V182`} stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} strokeDasharray="4 4" />
            <rect x={96} y={96} width={34} height={22} rx={11} fill="rgba(0,0,0,0.55)" />
            <T x={113} y={111} fill="#FFFFFF" size={12}>前へ</T>
            <rect x={172} y={96} width={40} height={22} rx={11} fill="rgba(0,0,0,0.55)" />
            <T x={192} y={111} fill="#FFFFFF" size={12}>次へ</T>
            {/* 黒地の上の輪（ホームのいちばん上の丸いアイコン） */}
            <circle cx={40} cy={60} r={20} fill="none" stroke={C.brass} strokeWidth={2.5} />
            <circle cx={40} cy={60} r={15} fill={photo(id, 1)} />
            <circle cx={40} cy={112} r={20} fill="none" stroke={C.outline} strokeWidth={1.5} />
            <circle cx={40} cy={112} r={15} fill={photo(id, 2)} />
            <T x={280} y={100} fill={C.text3}>24時間で</T>
            <T x={280} y={118} fill={C.text3}>消える</T>
        </>
    );
}

function WantToGo({ id }: { id: string }) {
    return (
        <>
            <rect x={18} y={20} width={130} height={160} rx={14} fill={C.s1} stroke={C.hair} />
            <rect x={18} y={20} width={130} height={86} rx={14} fill={photo(id, 2)} />
            <rect x={30} y={116} width={80} height={8} rx={4} fill={C.text2} />
            <rect x={30} y={138} width={106} height={30} rx={15} fill="none" stroke={C.brass} strokeWidth={1.5} />
            <T x={83} y={158} fill={C.brass} size={13}>行きたい</T>
            <path d="M160 100 H184" stroke={C.text2} strokeWidth={2} fill="none" />
            <path d="M178 94 L186 100 L178 106" stroke={C.text2} strokeWidth={2} fill="none" />
            {/* 地図 */}
            <rect x={194} y={20} width={110} height={160} rx={14} fill={C.s2} stroke={C.hair} />
            <path d="M200 70 C230 60 250 90 298 80 M200 130 C220 120 260 150 298 136 M240 26 C236 80 256 120 248 176" stroke={C.line} strokeWidth={6} fill="none" />
            {[[226, 62], [270, 104], [238, 146]].map(([x, y]) => (
                <g key={`${x}-${y}`}>
                    <path d={`M${x} ${y} c-7 -9 -10 -14 -10 -18 a10 10 0 0 1 20 0 c0 4 -3 9 -10 18 z`} fill={C.brass} stroke={C.bg} strokeWidth={1.5} />
                    <circle cx={x} cy={y - 18} r={3.5} fill={C.ink} />
                </g>
            ))}
        </>
    );
}

function Spots({ id }: { id: string }) {
    return (
        <>
            <rect x={60} y={8} width={200} height={184} rx={16} fill={C.s1} stroke={C.hair} />
            <rect x={60} y={8} width={200} height={84} rx={16} fill={photo(id, 5)} />
            <rect x={74} y={104} width={110} height={10} rx={5} fill={C.text2} />
            {["春", "夏", "秋", "冬"].map((s, i) => (
                <g key={s}>
                    <rect x={74 + i * 44} y={124} width={38} height={24} rx={12}
                          fill={i === 2 ? "#1C170E" : "rgba(255,255,255,0.07)"} stroke={i === 2 ? C.brass : C.hair} />
                    <T x={93 + i * 44} y={140} fill={i === 2 ? C.brass : C.text2} size={12}>{s}</T>
                </g>
            ))}
            <rect x={70} y={158} width={62} height={26} rx={13} fill="none" stroke={C.line} />
            <T x={101} y={175} fill={C.text} size={12}>行きたい</T>
            <rect x={136} y={158} width={120} height={26} rx={13} fill="none" stroke={C.line} />
            <T x={196} y={175} fill={C.text} size={12}>旅行プランに入れる</T>
        </>
    );
}

function Albums({ id }: { id: string }) {
    return (
        <>
            {/* アルバム（重なった写真） */}
            <rect x={128} y={54} width={74} height={92} rx={8} fill={photo(id, 3)} transform="rotate(-8 165 100)" />
            <rect x={124} y={50} width={74} height={92} rx={8} fill={photo(id, 4)} transform="rotate(5 161 96)" />
            <rect x={122} y={52} width={76} height={94} rx={8} fill={photo(id, 0)} stroke={C.bg} strokeWidth={2} />
            {/* 仲間 */}
            {[[44, 60], [44, 140], [276, 100]].map(([x, y], i) => (
                <g key={i}>
                    <circle cx={x} cy={y} r={18} fill={C.s2} stroke={C.outline} />
                    <circle cx={x} cy={y - 5} r={6} fill={C.text3} />
                    <path d={`M${x - 10} ${y + 11} a10 8 0 0 1 20 0`} fill={C.text3} />
                </g>
            ))}
            <path d="M66 66 L116 86 M66 134 L116 114 M254 100 H208" stroke={C.brass} strokeWidth={1.8} strokeDasharray="4 4" fill="none" />
            {/* 招待リンクの印 */}
            <g transform="translate(160 176)">
                <rect x={-50} y={-14} width={100} height={26} rx={13} fill="#1C170E" stroke={C.brass} />
                <T x={0} y={4} fill={C.brass} size={12}>招待リンク</T>
            </g>
        </>
    );
}

const FIGURES: Record<string, (p: { id: string }) => React.ReactElement> = {
    pass: Pass,
    messages: Messages,
    trunk: Trunk,
    safety: Safety,
    post: Post,
    stories: Stories,
    "want-to-go": WantToGo,
    "tourist-spots": Spots,
    albums: Albums,
};

/** 絵がある頁か（台帳の全頁に絵があることは試験が見る） */
export function hasHelpFigure(slug: string): boolean {
    return slug in FIGURES;
}

/**
 * 1枚の絵。`compact` は目次の札の小さい絵（字を隠して、読み上げからも外す——札の題が同じことを言う）。
 * `idPrefix` は同じ頁に何枚も描くときに、グラデーションの id がぶつからないようにする
 */
export default function HelpFigure({ slug, label, compact = false, idPrefix = "help" }: {
    slug: string; label: string; compact?: boolean; idPrefix?: string;
}) {
    const Figure = FIGURES[slug];
    if (!Figure) return null;
    const id = `${idPrefix}-${slug}`;
    return (
        <svg
            viewBox="0 0 320 200"
            width="100%"
            className={compact ? "block [&_.fig-text]:hidden" : "block"}
            style={{ fontFamily: "inherit" }}
            {...(compact ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
            data-testid="help-figure"
        >
            <PhotoDefs id={id} />
            <Figure id={id} />
        </svg>
    );
}
