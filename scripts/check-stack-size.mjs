#!/usr/bin/env node
/**
 * **すべての serverless のスタックの部品の数を数え、上限 500 に近づいたら止める**
 * （札 journey.photo-ios#552 の①）。判断は `lib/stackSize.mjs`（純粋な関数・テストあり）。
 *
 *     node scripts/check-stack-size.mjs [--stage staging,prod] [--top 6]
 *
 * - 数えるのは `api/` `api-user/` …（ルート直下のディレクトリ）にある
 *   `serverless.yml` と `serverless.<名前>.yml` の**全部**。別スタックを足せば勝手に入る
 * - 各設定を `npx serverless@3 package` で固め、`cloudformation-template-update-stack.json`
 *   （配るときに CloudFormation へ渡るもの）の `Resources` を数える
 * - **AWS に触らない。** `${aws:accountId}` だけは仮の値に置き換えた写しを同じ
 *   ディレクトリに作って固める（理由は `substituteAccountId`）。既定値の無い
 *   `${param:…}` には仮の値を渡す。どちらも部品の数を変えない
 * - 前提: 各ディレクトリで `npm ci` 済み（serverless-esbuild と、固める元の依存）
 * - 450 を超えた設定が1つでもあれば 1 で終わる（すでに超えていて `FROZEN_AT` に載せたものは、
 *   載せた数から増えたら 1）。固められなかった設定も 1
 *   （数えられないまま通すのがいちばん悪い）
 * - 固めた出力と写しは、成否にかかわらず消す（ディスクと、写しの取り違えを残さない）
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    FROZEN_AT, countResources, judge, requiredParams, serverlessConfigNames,
    substituteAccountId, summaryMarkdown, typeBreakdown,
} from "./lib/stackSize.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "out", "public", "content"]);

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function findConfigs() {
    const out = [];
    for (const d of readdirSync(ROOT).sort()) {
        if (SKIP_DIRS.has(d) || d.startsWith(".")) continue;
        const dir = join(ROOT, d);
        if (!statSync(dir).isDirectory()) continue;
        for (const n of serverlessConfigNames(readdirSync(dir))) out.push(join(dir, n));
    }
    return out;
}

/** 1 つの設定を1つの stage で固めて数える */
function measure(configPath, stage, top) {
    const dir = dirname(configPath);
    const name = relative(ROOT, configPath);
    const text = readFileSync(configPath, "utf8");
    // serverless v3 は --config に**同じディレクトリの中の**ファイルしか取らないので、写しもそこに置く
    const copy = join(dir, `.stack-size-check-${basename(configPath)}`);
    const outDir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "stack-size-"));
    try {
        writeFileSync(copy, substituteAccountId(text));
        const params = requiredParams(text).flatMap((p) => ["--param", `${p}=stack-size-check`]);
        const t0 = Date.now();
        const r = spawnSync("npx", ["--yes", "serverless@3", "package",
            "--config", basename(copy), "--stage", stage, "--package", outDir, ...params], {
            cwd: dir, encoding: "utf8", env: { ...process.env, SLS_TELEMETRY_DISABLED: "1" },
        });
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (r.status !== 0) {
            process.stderr.write(`${r.stdout || ""}${r.stderr || ""}`);
            throw new Error(`${name}（${stage}）を固められませんでした（終了 ${r.status}）`);
        }
        const tpl = JSON.parse(readFileSync(join(outDir, "cloudformation-template-update-stack.json"), "utf8"));
        const count = countResources(tpl);
        const frozenAt = FROZEN_AT[name];
        return { service: name, stage, count, frozenAt, level: judge(count, { frozenAt }), top: typeBreakdown(tpl, top), secs };
    } finally {
        rmSync(copy, { force: true });
        rmSync(outDir, { recursive: true, force: true });
    }
}

const stages = arg("stage", "staging,prod").split(",").map((s) => s.trim()).filter(Boolean);
const top = Number(arg("top", "6"));
const configs = findConfigs();
if (configs.length === 0) {
    console.error("::error::serverless の設定が1つも見つかりません（探し方が壊れている）");
    process.exit(1);
}

const rows = [];
let broken = 0;
for (const c of configs) {
    for (const stage of stages) {
        try {
            const row = measure(c, stage, top);
            rows.push(row);
            const msg = `${row.service}（${stage}）: ${row.count} 個`
                + `［${row.top.map((t) => `${t.type} ${t.count}`).join(", ")}］（${row.secs}秒）`;
            if (row.level === "fail" && row.frozenAt !== undefined) console.log(`::error::${msg} — 450 を超えたまま、決めた数 ${row.frozenAt} から増えています。上限 500 で本番の反映が落ちます。足す部品は別スタックに置いてください（札 journey.photo-ios#552）`);
            else if (row.level === "fail") console.log(`::error::${msg} — 450 を超えています。上限 500 で本番の反映が落ちます。別スタックに分けてください（札 journey.photo-ios#552）`);
            else if (row.level === "frozen") console.log(`::warning::${msg} — 450 を超えています。決めた数 ${row.frozenAt} までは通しますが、これ以上は増やせません${row.count < row.frozenAt ? `（減ったので scripts/lib/stackSize.mjs の FROZEN_AT を ${row.count} に下げてください）` : ""}`);
            else if (row.level === "warn") console.log(`::warning::${msg} — 400 を超えています（450 を超えると止めます）`);
            else console.log(msg);
        } catch (e) {
            broken++;
            console.log(`::error::${e.message}`);
        }
    }
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(rows));
const failed = rows.filter((r) => r.level === "fail").length;
if (failed || broken) {
    console.log(`止めます: 450 を超えた ${failed} 件・数えられなかった ${broken} 件`);
    process.exit(1);
}
console.log(`全 ${rows.length} 件（${configs.length} 設定 × ${stages.join("/")}）を通しました（450 以下、または決めた数から増えていない）`);
