import { truncate } from "./sanitize";

/**
 * 利用者が書く**複数行の本文**の整え（DM・意見箱で共有する）。
 *
 * 2026-11-11 判断（札 #546）: もとは `dm.ts` の `cleanDmText` の中身。意見箱の本文も
 * 「改行は残す・見えない字を落とす・上限で切る」が同じなので、写しを作らずここへ出した。
 * `dm.ts` はこれを上限 `DM_TEXT_MAX` で呼ぶだけ（振る舞いは変えていない。`dm.test.ts` が見張る）。
 *
 * **改行は残す**（`sanitizeText` は改行まで落とすので、段落が1行に潰れる）。
 * 見えない制御文字を落とし、行の前後と3つ以上の連続する空行をまとめ、上限で切る。
 */
export function cleanMultilineText(v: unknown, max: number): string {
    if (typeof v !== "string") return "";
    const t = v
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
        // ゼロ幅・方向制御・ソフトハイフン（URL 判定をすり抜ける・見た目の無い本文を作れる）
        .replace(INVISIBLE, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return t ? truncate(t, max) : "";
}

/** U+200B-200F・202A-202E・2060・2066-2069・FEFF・00AD（見えない字なので、ソースには \u の書き方で書く） */
export const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g;
