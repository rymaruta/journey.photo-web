#!/usr/bin/env node
/**
 * ビルドIDを「画面の JS の指紋」にしたときに、版が切り替わる瞬間の画面の行き来が正しく動くかを確かめる
 * （札 journey.photo-ios#638・2026-11-18）。CI の確かめ用の枝から流す。
 *
 *   node scripts/check-stable-build-id.mjs <旧 out> <新 out> <soft|hard> <最初の頁> <行き先の頁> [行き先にあるはずの文字]
 *
 * 静的な配信（S3 + CloudFront と同じく、拡張子の無い URL は `.html` を返す・クエリは無視）を立て、
 *  1. 旧 out の「最初の頁」を開き、window に印を置く
 *  2. 配信を新 out に差し替える（＝デプロイが終わった瞬間）
 *  3. Next の router で「行き先の頁」へ移る（.txt を読む）
 *  4. soft: 印が残っている（読み直さずに画面だけ切り替わった）・hard: 印が消えている（丸ごと読み直した）
 *     どちらも、行き先の頁が新 out の中身で出て、ページのエラーが無いこと
 * 終了コード 0 で合格。
 *
 * 本番に対しては `--live <サイトの URL> <最初の頁> <行き先の頁>` で、読み直さずに切り替わることだけを見る。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import mime from "mime-types";

function serve(getRoot) {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://x");
        let p = decodeURIComponent(url.pathname);
        const root = getRoot();
        const cands = p.endsWith("/") ? [`${p}index.html`, `${p.slice(0, -1)}.html`] : [p, `${p}.html`, `${p}/index.html`];
        for (const c of cands) {
            const full = path.join(root, c);
            if (full.startsWith(root) && fs.existsSync(full) && fs.statSync(full).isFile()) {
                res.writeHead(200, { "content-type": mime.lookup(full) || "application/octet-stream", "cache-control": "no-cache" });
                fs.createReadStream(full).pipe(res);
                return;
            }
        }
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
    });
    return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function run({ base, swap, mode, from, to, expectText }) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    const txt = [];
    let documents = 0;
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => {
        if (r.url().includes(".txt")) txt.push(r.url());
        if (r.resourceType() === "document") documents++;
    });
    await page.goto(base + from, { waitUntil: "networkidle" });
    // hydrate を待ってから印を置く（router が使えるまで）
    await page.waitForFunction(() => window.next && window.next.router, null, { timeout: 30000 });
    await page.evaluate(() => { window.__stableBuildIdMark = 1; });
    const docsBefore = documents;
    if (swap) swap();
    await page.evaluate((href) => window.next.router.push(href), to);
    await page.waitForURL((u) => decodeURI(u.pathname).replace(/\/$/, "") === to.replace(/\/$/, ""), { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    if (expectText) await page.getByText(expectText, { exact: false }).first().waitFor({ timeout: 15000 });
    const mark = await page.evaluate(() => window.__stableBuildIdMark ?? null);
    const reloaded = documents > docsBefore;
    const title = await page.title();
    await browser.close();
    const result = { mode, from, to, title, mark, reloaded, txtRequests: txt.length, errors };
    console.log(JSON.stringify(result));
    const ok = errors.length === 0
        && (mode === "soft" ? mark === 1 && !reloaded && txt.length > 0 : mark === null && reloaded);
    return ok;
}

const args = process.argv.slice(2);
let ok;
if (args[0] === "--live") {
    const [, site, from, to, expectText] = args;
    ok = await run({ base: site.replace(/\/$/, ""), mode: "soft", from, to, expectText });
} else {
    const [oldOut, newOut, mode, from, to, expectText] = args;
    let root = path.resolve(oldOut);
    const server = await serve(() => root);
    const base = `http://127.0.0.1:${server.address().port}`;
    ok = await run({ base, swap: () => { root = path.resolve(newOut); }, mode, from, to, expectText });
    server.close();
}
console.log(ok ? "OK" : "NG");
process.exit(ok ? 0 : 1);
