import TERMS from "./data/blockedTerms.json";
import { jsonError } from "./http";

/**
 * 投稿される前に、ひどい言葉を止める（App Store の審査 1.2「不適切な物を取り除く仕組み」）。
 *
 * それまでは通報とブロックだけで、保存の前の判定が無かった。利用者が書いて他人に見える文
 * （コメント・写真の題と説明・プロフィール・DM・ストーリーの文と返信・旅行プランの会話など）を
 * 保存する口は、保存の前に `rejectBlockedText(...)` を通す。当たったら保存せずに
 * **400 `{ error, code: "content_rejected" }`** を返す（アプリは `code` で見分ける）。
 *
 * - **費用0円。** AWS の有料の判定（Rekognition・Comprehend）は使わない。言葉の一覧
 *   （`data/blockedTerms.json`）との突き合わせだけ
 * - 当てる前に `normalize` で形をそろえる: NFKC（全角英数と半角カナをそろえる）、小文字、
 *   カタカナをひらがなへ、見えない字と制御文字を落とす
 * - **日本語**（`ja`）は空白と記号を除いた文の中の部分一致（「死 ね」「死・ね」も当たる）。
 *   ふつうの語に含まれる部分では当てないため、先に `allow` の語（パチンコ・グレイプなど）を伏せる
 * - **英語**（`en`）は単語の並びで当てる（Scunthorpe・Essex・cocktail は当たらない）。
 *   `@`→a・`$`→s と、字を含む語の中の数字（0→o・1→i・3→e・4→a・5→s・7→t）を読み替える
 * - どの語に当たったかは返さない（言い換えの手がかりを渡さない）
 */

const KATA_START = 0x30a1;
const KATA_END = 0x30f6;

/** 見えない字（ゼロ幅・方向制御・ソフトハイフン）と制御文字 */
const INVISIBLE_OR_CONTROL = /[\u0000-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁩﻿]/g;

/** 形をそろえる（小文字・NFKC・カタカナ→ひらがな・見えない字を落とす） */
export function normalize(s: string): string {
    let t = s.normalize("NFKC").toLowerCase().replace(INVISIBLE_OR_CONTROL, "");
    let out = "";
    for (const ch of t) {
        const c = ch.codePointAt(0)!;
        out += c >= KATA_START && c <= KATA_END ? String.fromCodePoint(c - 0x60) : ch;
    }
    t = out;
    return t;
}

/** 日本語の部分一致用: 空白・記号・句読点を除く（字・数字・かな・漢字だけを残す） */
function compact(s: string): string {
    return s.replace(/[^\p{L}\p{N}]/gu, "");
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" };

/** 英語の単語の並び。`'` は語を分ける（i'll → i ll） */
function tokens(s: string): string[] {
    const t = s.replace(/@/g, "a").replace(/\$/g, "s");
    return (t.match(/[a-z0-9]+/g) ?? []).map((w) =>
        /[a-z]/.test(w) ? w.replace(/[013457]/g, (d) => LEET[d]) : w);
}

const JA_TERMS: readonly string[] = [...new Set((TERMS.ja as string[]).map((w) => compact(normalize(w))).filter(Boolean))];
const JA_ALLOW: readonly string[] = [...new Set((TERMS.allow as string[]).map((w) => compact(normalize(w))).filter(Boolean))]
    // 長い語から伏せる（短い語が先に一部だけ伏せて、長い語が見つからなくなるのを避ける）
    .sort((a, b) => b.length - a.length);
const EN_TERMS: readonly (readonly string[])[] = (TERMS.en as string[])
    .map((w) => tokens(normalize(w)))
    .filter((t) => t.length > 0);

/** 一覧の語数（報告と試験に使う） */
export const BLOCKED_TERM_COUNTS = { ja: JA_TERMS.length, en: EN_TERMS.length, allow: JA_ALLOW.length };

/** 同じ字が3つ以上続くのを1つに縮めた形も見る（fuuuuck → fuck は見ない。fuckkkk → fuck は見る） */
const squeeze = (w: string) => w.replace(/(.)\1{2,}/g, "$1");

function matchesEnglish(words: string[]): boolean {
    if (words.length === 0) return false;
    const variants = [words, words.map(squeeze)];
    for (const ws of variants) {
        for (const term of EN_TERMS) {
            if (term.length > ws.length) continue;
            outer: for (let i = 0; i + term.length <= ws.length; i++) {
                for (let j = 0; j < term.length; j++) {
                    if (ws[i + j] !== term[j]) continue outer;
                }
                return true;
            }
        }
    }
    return false;
}

function matchesJapanese(norm: string): boolean {
    let c = compact(norm);
    if (!c) return false;
    // ふつうの語を伏せる。伏せ字は語の境目にならない「\u0000」（compact 後には現れない）
    for (const a of JA_ALLOW) {
        if (c.includes(a)) c = c.split(a).join("\u0000");
    }
    return JA_TERMS.some((t) => c.includes(t));
}

/** 1つの文がひどい言葉を含むか */
export function containsBlockedText(s: string): boolean {
    if (typeof s !== "string" || s.length === 0) return false;
    const norm = normalize(s);
    return matchesJapanese(norm) || matchesEnglish(tokens(norm));
}

/**
 * 値の中の文字列を全部見る（配列・オブジェクトの中も。言語ごとの `{ ja, en }` の題や、
 * タグの配列、ストーリーの文の配列をそのまま渡せる）。深さと数に上限を付ける。
 */
export function anyBlockedText(...values: unknown[]): boolean {
    let budget = 2000;
    const walk = (v: unknown, depth: number): boolean => {
        if (budget-- <= 0) return false;
        if (typeof v === "string") return containsBlockedText(v);
        if (depth > 5 || v === null || typeof v !== "object") return false;
        const items = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
        for (const it of items) if (walk(it, depth + 1)) return true;
        return false;
    };
    return values.some((v) => walk(v, 0));
}

export const CONTENT_REJECTED_CODE = "content_rejected";
export const CONTENT_REJECTED_MESSAGE = "不適切な言葉が含まれているため、保存できませんでした。言葉を変えてもう一度お試しください";

/** 当たったら 400 `content_rejected` の応答、当たらなければ null */
export function rejectBlockedText(...values: unknown[]) {
    return anyBlockedText(...values) ? jsonError(400, CONTENT_REJECTED_MESSAGE, CONTENT_REJECTED_CODE) : null;
}
