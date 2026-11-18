import { truncate } from "./sanitize";

/**
 * 写真の持ち主へのコメントの知らせに添える、本文の抜粋（2026-11-18・案 B4、owner 採用）。
 *
 * ベルの行に「〇〇 がコメントしました：「稜線の色がきれいですね」」と1行で出す（板 Notifications）。
 * 行は1行で切れるので、保存するのは頭の {@link COMMENT_EXCERPT_MAX} 字だけ
 * （通知の文書は 50 件で 1 アイテム 400KB の上限を分け合う。本文 500 字をそのまま積まない）。
 * 改行・続く空白は1つの空白に寄せる（1行に出すため）。切ったら「…」を付ける。
 * 字の切れ目は `truncate`（書記素で切る・絵文字を割らない）
 */
export const COMMENT_EXCERPT_MAX = 80;

export function commentExcerpt(text: string): string {
    const flat = text.replace(/\s+/gu, " ").trim();
    const cut = truncate(flat, COMMENT_EXCERPT_MAX);
    return cut.length < flat.length ? `${cut.trimEnd()}…` : cut;
}
