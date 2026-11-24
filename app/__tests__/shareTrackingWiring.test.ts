import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 共有の計測（`share`・2026-11-04）の結び忘れを防ぐ。`shareUrl` / `shareToTwitter` / `shareToLine` は
 * 第4（`shareUrl`）・第3引数に「何を共有したか」を渡した回だけ数える。**新しい共有ボタンを足して
 * 渡し忘れる**と、その共有だけ漏れる。呼び出しを全部拾って、渡していることを見る。
 * （プロフィールの共有 `app/users/UserProfileClient.tsx` は別の担当が作り直し中なので、いまは除く。
 *  外すときは下の EXEMPT から消す）
 */
const EXEMPT = new Set(["app/users/UserProfileClient.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
}

const CT = /["'](photo|spot|quiz|trip)["']\s*\)/;

describe("共有の呼び出しは、何を共有したかを渡している", () => {
    const calls: Array<{ file: string; line: string }> = [];
    for (const file of walk("app")) {
        if (EXEMPT.has(file)) continue;
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/\b(shareUrl|shareToTwitter|shareToLine)\(([^;\n]*)/g)) {
            calls.push({ file, line: m[0] });
        }
    }

    it("呼び出しが見つかる（探し損ねて空で通らない）", () => {
        expect(calls.length).toBeGreaterThanOrEqual(10);
    });

    it.each(calls.map((c) => [c.file, c.line]))("%s: %s", (_file, line) => {
        // import の行（`shareUrl(` を含まない）は拾っていない。呼び出しは必ず種類で閉じる
        expect(line).toMatch(CT);
    });
});
