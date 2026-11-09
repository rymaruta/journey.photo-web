// lib/data/prefectureLabels.ts（**生成物**・手で直さない）
//
// ホームの日本地図（`app/components/HomeJapanMap.tsx`）の県名の置き場。作り方と判断は
// `scripts/generate-prefecture-labels.ts`（`npx tsx scripts/generate-prefecture-labels.ts > lib/data/prefectureLabels.ts`）。
// 字は画面で 12px（部品が 12 ÷ 画面の px/単位 で描く）。設計の縮尺は 0.9px/単位（幅およそ 324px の地図）。
//
// label = [スラッグ, 字, 向き（h=横書き・v=縦書き）, 字の中心 x, y, 引き出し先の点 x, y（県の中に置いた字は null, null）]。単位は viewBox。
// 沖縄は枠の「沖縄県」の字（部品が描く）なのでここには無い。

export const LABEL_DESIGN_PX = 0.9;
export const LABEL_FONT_PX = 12;

export type PrefectureLabel = readonly [
    slug: string, text: string, orient: "h" | "v", x: number, y: number, ax: number | null, ay: number | null,
];

export const PREFECTURE_LABELS: readonly PrefectureLabel[] = [
    ["hokkaido", "北海道", "h", 295.4, 53.5, null, null],
    ["aomori", "青森", "h", 255.3, 119.8, null, null],
    ["iwate", "岩手", "h", 269, 158.3, null, null],
    ["miyagi", "宮城", "h", 265.4, 181.2, null, null],
    ["akita", "秋田", "h", 242.9, 139.1, null, null],
    ["yamagata", "山形", "h", 235.3, 176.4, null, null],
    ["fukushima", "福島", "h", 246.6, 207.6, null, null],
    ["ibaraki", "茨城", "h", 266, 241.9, 249, 245.9],
    ["tochigi", "栃木", "h", 234.7, 225.9, null, null],
    ["gunma", "群馬", "h", 195.8, 207.5, 219.3, 223],
    ["saitama", "埼玉", "h", 223.6, 245.3, null, null],
    ["chiba", "千葉", "h", 254.6, 260.8, null, null],
    ["tokyo", "東京", "h", 232.7, 317, 223.7, 254],
    ["kanagawa", "神奈川", "h", 241.3, 279.3, 220.3, 261.8],
    ["niigata", "新潟", "v", 220.4, 201.6, null, null],
    ["toyama", "富山", "h", 177, 227.1, null, null],
    ["ishikawa", "石川", "h", 165.9, 208.3, 167.4, 234.3],
    ["fukui", "福井", "h", 143.5, 227, 159, 243.5],
    ["yamanashi", "山梨", "v", 209.5, 269.9, null, null],
    ["nagano", "長野", "h", 173.8, 188.6, 195.3, 226.6],
    ["gifu", "岐阜", "h", 175.5, 254.2, null, null],
    ["shizuoka", "静岡", "h", 232.3, 297.9, 215.3, 276.4],
    ["aichi", "愛知", "v", 179.7, 278.7, null, null],
    ["mie", "三重", "h", 201.5, 303.7, 167.5, 286.7],
    ["shiga", "滋賀", "h", 142.3, 245.7, 158.3, 260.2],
    ["kyoto", "京都", "h", 111.9, 237.2, 137.9, 260.7],
    ["osaka", "大阪", "h", 134.5, 285.7, 144.5, 284.7],
    ["hyogo", "兵庫", "h", 112.7, 218.8, 124.2, 257.3],
    ["nara", "奈良", "h", 171.1, 305.4, 154.1, 293.9],
    ["wakayama", "和歌山", "h", 167, 324.4, 148, 307.9],
    ["tottori", "鳥取", "h", 110.1, 256.7, null, null],
    ["shimane", "島根", "h", 81.1, 234.5, 94.1, 260],
    ["okayama", "岡山", "h", 80, 253.3, 102.5, 270.3],
    ["hiroshima", "広島", "v", 79.9, 292.6, null, null],
    ["yamaguchi", "山口", "h", 52, 285.3, null, null],
    ["tokushima", "徳島", "h", 130, 311, 116.5, 302],
    ["kagawa", "香川", "h", 104.1, 292.7, 110.6, 292.2],
    ["ehime", "愛媛", "h", 122.8, 342.9, 85.3, 314.9],
    ["kochi", "高知", "h", 99.4, 324.2, null, null],
    ["fukuoka", "福岡", "h", 47.5, 304.9, null, null],
    ["saga", "佐賀", "h", 17.5, 306.6, 29.2, 315.1],
    ["nagasaki", "長崎", "v", 13, 330.9, 35, 328.4],
    ["kumamoto", "熊本", "h", 37, 338.7, null, null],
    ["oita", "大分", "h", 68.5, 324.4, null, null],
    ["miyazaki", "宮崎", "h", 67, 343.4, null, null],
    ["kagoshima", "鹿児島", "h", 31, 363.5, null, null],
];

