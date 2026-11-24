// app/__tests__/hashLinks.test.ts
//
// 2026-11-09: **ハッシュだけの `<a href="#…">` を素の `<a>` で書かない**（`next/link` の `<Link>` にする）。
//
// 本番で起きたこと: ホームの「すべての県を文字で見る ›」を押す → URL が `/#home-spot-entry-list` →
// 一覧から県の頁へ → 「戻る」で、アドレスは `/#home-spot-entry-list` に戻るのに**画面は県の頁のまま**。
// 素の `<a href="#…">` が積む履歴エントリの `history.state` は null で、Next の popstate ハンドラは
// `if (e.state) {…}` で始まるため、null だと何もしない（Playwright で実測: 戻って 6 秒待っても変わらない）。
// `<Link>` は `__NA` 付きで積むので、同じ操作でホームに戻る。
//
// 見た目は同じ `<a>` なので、SSR の HTML を見るテスト（`href="#…"` を数えるもの）は素に戻しても通る。
// だからここは**ソースを読んで**縛る。

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
    }
    return out;
}

/** コメントを落とす（`<a href="#">` を説明の文に書いてあるものを拾わない） */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 素の `<a …href="#…">`（タグの中で次の `<` までに href が `#` で始まるもの）の行番号 */
function plainHashAnchors(src: string): number[] {
    const code = stripComments(src);
    const hits: number[] = [];
    const re = /<a\s[^<]*?href=(?:\{`#|\{"#|"#|'#)/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
        hits.push(code.slice(0, m.index).split("\n").length);
    }
    return hits;
}

describe("ハッシュだけのリンクは <Link>（素の <a href=\"#…\"> は戻る操作が効かなくなる）", () => {
    it("検出の部品: 素の <a> は拾い、<Link> と SVG の <use href> と文中の説明は拾わない", () => {
        expect(plainHashAnchors('<a href="#x">a</a>')).toEqual([1]);
        expect(plainHashAnchors("<a\n  className=\"c\"\n  href={`#${id}`}\n>a</a>")).toEqual([1]);
        expect(plainHashAnchors('<a onClick={() => go()} href="#x">a</a>')).toEqual([1]);
        expect(plainHashAnchors('<Link href="#x">a</Link>')).toEqual([]);
        expect(plainHashAnchors('<use href={`#${id}`} />')).toEqual([]);
        expect(plainHashAnchors('<a href="/spots">a</a>')).toEqual([]);
        expect(plainHashAnchors('// <a href="#"> は使わない\n/* <a href="#x"> */')).toEqual([]);
    });

    it("app/ と lib/ の .tsx に、素のハッシュ <a> が無い", () => {
        const bad: string[] = [];
        for (const f of [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))]) {
            for (const line of plainHashAnchors(readFileSync(f, "utf8"))) {
                bad.push(`${path.relative(ROOT, f)}:${line}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it("ホームの地図の2本（文字の一覧へ・スキップ）が <Link> で、一覧の id を指す", () => {
        const src = readFileSync(path.join(ROOT, "app/components/HomeJapanMap.tsx"), "utf8");
        expect(src.match(/<Link href=\{`#\$\{SPOT_LIST_ID\}`\}/g)).toHaveLength(2);
    });
});
