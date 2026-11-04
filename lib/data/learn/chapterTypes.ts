// lib/data/learn/chapterTypes.ts
//
// **教科書の「章」の形**（2026-11-04）。1章 = 1ページ（`/learn/[slug]`）。中身は `lib/data/learn/chapters/<slug>.ts`。
//
// 書き方の決まり（`docs/learn-authoring.md`）:
// - 数値は**目安**として書く（光・レンズ・機種で変わる）。断定できない一般論は「〜ことがある」
// - 値段・発売日・型番の性能・特定の商品の優劣は書かない（すぐ古くなる・誤りやすい）
// - 1つの節は「要点1行 → 本文（短い段落）→ 図や表 → 実例 → よくある失敗」。長い段落を作らない
// - 専門用語は初出で言い換える（「被写界深度（ピントが合って見える奥行き）」）
// - 各章の終わりに「まとめ → 練習 → 確認クイズ」を置く

import type { DiagramId } from "./diagramIds";

export type Block =
    | { t: "p"; text: string }
    /** 節の中の小見出し（「準備」「設定の目安」など） */
    | { t: "h"; text: string }
    | { t: "list"; items: string[]; ordered?: boolean }
    | { t: "table"; caption: string; head: string[]; rows: string[][] }
    /** tip＝コツ（真鍮）・warn＝失敗しやすい所（赤ではなく白縁）・memo＝補足 */
    | { t: "callout"; kind: "tip" | "warn" | "memo"; title?: string; text: string }
    | { t: "steps"; items: { title: string; text: string }[] }
    | { t: "diagram"; id: DiagramId; caption: string }
    /** このサイトの実例（`EXAMPLE_RULES` の id）。合う写真が無ければ出さない */
    | { t: "example"; rule: string };

export type Section = {
    /** 頁内リンクの id（半角英数とハイフン） */
    id: string;
    title: string;
    /** 要点1行（この節で持ち帰ること） */
    point: string;
    blocks: Block[];
    pitfalls?: string[];
};

export type QuizItem = {
    q: string;
    choices: string[];
    /** 正しい選択肢の番号（0 始まり） */
    answer: number;
    /** 答えの理由（正解でも不正解でも出す） */
    why: string;
};

export type Chapter = {
    slug: string;
    /** 一覧の並び・「第N章」 */
    number: number;
    title: string;
    /** 一覧のカードの眉 */
    eyebrow: string;
    /** meta description 兼 一覧の説明（80〜130字） */
    description: string;
    /** 頁の導入（2〜3文） */
    lead: string;
    /** 読む時間の目安（分） */
    minutes: number;
    level: "入門" | "基礎" | "応用" | "仕上げ";
    /** 「この章を読む前に」（任意）: 前提になる章の slug や href */
    prerequisites?: string[];
    sections: Section[];
    /** 章のまとめ（3〜6点） */
    summary: string[];
    /** 練習（外で撮ってみる課題）。2〜4つ */
    drills: { title: string; text: string }[];
    /** 確認クイズ（3〜5問） */
    quiz: QuizItem[];
    faq?: { q: string; a: string }[];
    /** 次に読む（slug か href） */
    next: string[];
    published: string;
    modified: string;
};
