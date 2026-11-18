import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve, extname } from "node:path";

// 2026-11-18: Deploy Site は push の `paths` で、サイトの出力（out/）に効かない変更だけの push では動かない。
// ここで固定するのは、**外した所（api/・api-user/・docs/・*.md・テスト・ほかのワークフロー）を、
// ビルドが読むコードが読んでいない**こと。読み始めたら、その変更だけの push でサイトが更新されず古いまま残る。
const ROOT = join(__dirname, "..", "..");
const workflow = readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");

/** deploy.yml の push の paths（上から順） */
function pushPaths(): string[] {
    const m = /\n {2}push:\n(?: {4}.*\n|\s*\n)*? {4}paths:\n((?: {6}- .*\n|\s*#.*\n)+)/.exec(workflow);
    if (!m) return [];
    return [...m[1].matchAll(/^ {6}- "([^"]+)"/gm)].map((x) => x[1]);
}

/** GitHub の書き方（** は / を含む・* は含まない）を正規表現に */
function globRe(p: string): RegExp {
    let out = "";
    for (let i = 0; i < p.length; i++) {
        if (p.startsWith("**", i)) { out += ".*"; i++; }
        else if (p[i] === "*") out += "[^/]*";
        else out += p[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${out}$`);
}

/** そのファイルだけを変えた push で Deploy Site が動くか（後ろの行が勝つ） */
function triggers(file: string, patterns: string[]): boolean {
    let inc = false;
    for (const p of patterns) {
        const neg = p.startsWith("!");
        if (globRe(neg ? p.slice(1) : p).test(file)) inc = !neg;
    }
    return inc;
}

const EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css"];
function resolveModule(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null; // node_modules
    const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, "index" + e))];
    for (const c of cands) if (existsSync(c) && statSync(c).isFile()) return c;
    return null;
}

const isTest = (rel: string) => /(^|\/)__tests__\//.test(rel) || /\.test\.[cm]?[jt]sx?$/.test(rel);

function walkDir(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules") walkDir(full, out); }
        else if (EXTS.includes(extname(e.name))) out.push(full);
    }
    return out;
}

/**
 * ビルドが読むコードを、入口から import・require をたどって集める。
 * 入口: app/ の全部（Next がまとめて読む）・next.config.ts・ビルドとデプロイのスクリプト
 */
function buildGraph(): string[] {
    const entries = [
        ...walkDir(join(ROOT, "app")).filter((f) => !isTest(relative(ROOT, f))),
        join(ROOT, "next.config.ts"),
        join(ROOT, "scripts", "prepare-static-build.js"),
        join(ROOT, "scripts", "sync-photos-from-ddb.js"),
        join(ROOT, "scripts", "spot-thumbs.mjs"),
        join(ROOT, "scripts", "deploy-static-site.js"),
        join(ROOT, "scripts", "e2e-smoke.mjs"),
    ];
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length) {
        const f = stack.pop()!;
        if (seen.has(f) || !existsSync(f)) continue;
        seen.add(f);
        if (extname(f) === ".json" || extname(f) === ".css") continue;
        const src = readFileSync(f, "utf8");
        const specs = [
            ...src.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"'\n]+)["']/g),
            ...src.matchAll(/\bimport\(\s*["']([^"'\n]+)["']\s*\)/g),
        ].map((m) => m[1]);
        for (const s of specs) {
            const r = resolveModule(f, s);
            if (r) stack.push(r);
        }
    }
    return [...seen];
}

describe("Deploy Site の push の絞り（paths）", () => {
    const patterns = pushPaths();

    it("paths は「全部」から始まり、外す所を並べ、最後に deploy.yml 自身を戻す", () => {
        expect(patterns[0]).toBe("**");
        expect(patterns).toContain("!api-user/**");
        expect(patterns.at(-1)).toBe(".github/workflows/deploy.yml");
        expect(patterns.indexOf("!.github/**")).toBeLessThan(patterns.indexOf(".github/workflows/deploy.yml"));
    });

    it("サイトに効く変更では動き、効かない変更では動かない", () => {
        for (const f of ["app/page.tsx", "lib/routes.ts", "content/spots.json", "public/favicon.ico", "scripts/deploy-static-site.js",
            "package.json", "package-lock.json", "next.config.ts", ".github/workflows/deploy.yml", "lib/data/spotMaster.ts"]) {
            expect(triggers(f, patterns), f).toBe(true);
        }
        for (const f of ["api-user/src/dm.ts", "api/src/photos.ts", "docs/api-reference.md", "README.md", "content/README.md",
            "app/__tests__/x.test.ts", "lib/data/__tests__/spotSeo.test.ts", "app/components/Footer.test.tsx",
            ".github/workflows/deploy-api.yml"]) {
            expect(triggers(f, patterns), f).toBe(false);
        }
    });

    it("ビルドが読むコード（入口から import・require をたどったもの）は、外した所のファイルを1つも含まない", () => {
        const files = buildGraph().map((f) => relative(ROOT, f).split("\\").join("/"));
        expect(files.length).toBeGreaterThan(100);
        const leaked = files.filter((f) => !triggers(f, patterns));
        expect(leaked).toEqual([]);
    });

    it("ビルドが読むコードは、外した所をファイルとして読みに行かない（readFileSync などのパスの文字）", () => {
        const hits: string[] = [];
        for (const f of buildGraph()) {
            if (![".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(f))) continue;
            const lines = readFileSync(f, "utf8").split("\n");
            lines.forEach((line, i) => {
                if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // コメント
                if (!/(readFile|readdir|existsSync|createReadStream|\bjoin\(|\bresolve\(|new URL\()/.test(line)) return;
                // `app/api`（開発用の経路・ビルドで退避する所）は最上位の api/ ではないので除く
                const l = line.replace(/["']app["']\s*,\s*["']api["']/g, "").replace(/app\/api/g, "");
                if (/["'`](?:\.\.\/)*(api|api-user|docs)(\/|["'`])/.test(l) || /["'`][^"'`]*\.md["'`]/.test(l)) {
                    hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(hits).toEqual([]);
    });
});
