// lib/learn/inlineLinks.ts
//
// **教科書（/learn）の本文の中のリンク**（2026-11-11・札 rymaruta/journey.photo-ios#527）。
//
// 教科書の 14 頁から撮影スポットの頁へのリンクが 0 だった（フッターと章の終わりの「関連」だけ）。
// 本文の文の中に、その章の内容に合う撮影スポット・テーマの頁へのリンクを置けるようにする。
// 書き方は本文の文字列の中に `[見える文字](/spots/…)`。**サイトの中の頁（`/` で始まる道）だけ**を拾い、
// それ以外の `[…](…)` は文字のまま残す（外のサイトへのリンクを本文に紛れ込ませない）。
// 張った先が在る頁か（公開済みのスポット・作られるテーマの頁）は `lib/learn/__tests__/inlineLinks.test.ts` が見張る。

export type InlineSegment = string | { label: string; href: string };

const LINK = /\[([^\]\n]+)\]\((\/[^)\s]*)\)/g;

/** 本文の文字列を、文字とリンクの並びに分ける */
export function inlineSegments(text: string): InlineSegment[] {
    const out: InlineSegment[] = [];
    let last = 0;
    for (const m of text.matchAll(LINK)) {
        const i = m.index ?? 0;
        if (i > last) out.push(text.slice(last, i));
        out.push({ label: m[1], href: m[2] });
        last = i + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

/** 本文の中のリンク先（道）を全部 */
export function inlineHrefs(text: string): string[] {
    return inlineSegments(text).flatMap((s) => (typeof s === "string" ? [] : [s.href]));
}

/** リンクの印を外した、読むための文字だけ（`key` や数えるとき） */
export function stripInlineLinks(text: string): string {
    return text.replace(LINK, "$1");
}
