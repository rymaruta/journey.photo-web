// XML に入れてよい形にする（`app/sitemap-images.xml/route.ts` から移した。サイトマップ各種が共用する）

/**
 * XML に入れてよい形にする。
 *
 * **記号を実体参照にするだけでは足りない。** XML 1.0 は C0 制御文字
 * （タブ・改行・復帰を除く U+0000-001F）を**文字参照でも書けない**ので、
 * 1文字混ざると `sitemap-images.xml` が**丸ごと** parse error になる
 * （その1件だけでなく30枚ぶんの `<image:loc>` が全部読めなくなる）。
 * HTML と JSON-LD は `JSON.stringify` が `\u000b` に逃がすので無事——
 * つまり**画面のどこにも症状が出ない**。
 *
 * 入口（`api-user/src/sanitize.ts`）にも除去は無く、API を直接叩けば確実に
 * 入る。Word や表計算からの貼り付けはセル内改行が U+000B になるので、
 * 説明文の貼り付けでも入りうる。
 */
export function esc(s: string): string {
    return s
        // XML 1.0 が許さない文字は落とす。1文字混ざるだけで**この XML が
        // 丸ごと** parse error になる（その1件ではなく全件が読めなくなる）。
        // 規定は `#x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | …` で、
        // **C0 制御文字だけでは足りない**——`U+FFFE` / `U+FFFF` も入って
        // いない（実測: expat が両方で parse error）。逆に C1（U+0085 など）と
        // 非文字（U+FDD0）は XML 1.0 では合法なので落とさない。
        // タブ・改行・復帰は残す。**ここは XML として壊さないための除去**で、
    // 合法な空白まで落とす仕事ではない。caption を1行に均すのは
    // `metaText` の側（`captionOf`）——2つを混ぜると、除去を広げた
    // 変異が「見せ方が同じだから」で素通りする。
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
