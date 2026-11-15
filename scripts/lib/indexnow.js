// scripts/lib/indexnow.js
//
// **IndexNow**（Bing・Yandex・Naver・Seznam などに「この URL が新しくなった」と即時に知らせる仕組み・2026-11-15）。
// Google は IndexNow に対応していないので、Google にはサイトマップが効く（変えない）。
//
// - 鍵は公開してよい（サイトの直下に `<鍵>.txt` を置き、中身も同じ鍵。`public/` に置く）
// - 知らせるのは**直近2日に更新された URL だけ**（サイトマップの lastmod）。毎回全部は送らない（IndexNow の作法）
// - **本番（SITE_URL が本番のドメイン）のときだけ**送る。ステージング・手元では送らない
// - **失敗してもデプロイは止めない**（通知は参考。ネットワークのエラーも握りつぶしてログだけ）
// - 費用は掛からない。外へ出るのは「自分のサイトの公開 URL の一覧」だけ

const fs = require("fs");
const path = require("path");

const PROD_URL = "https://journey-photo.com";
const INDEXNOW_KEY = "24a509703b1149baad8cefd5c10cd2ad";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10000;
/** 通知するサイトマップ（`sitemap-images.xml` は画像、`sitemap-today.xml` は lastmod を持たないので除く） */
const SITEMAPS = ["sitemap-spots.xml", "sitemap-areas.xml", "sitemap-hubs.xml", "sitemap-collections.xml", "sitemap-learn.xml", "sitemap-pages.xml", "sitemap-photos.xml"];

/** サイトマップの XML から、lastmod が `sinceMs` 以降の URL を取り出す（lastmod が無い URL は含めない） */
function urlsFromSitemap(xml, sinceMs) {
    const out = [];
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
        const loc = /<loc>([^<]+)<\/loc>/.exec(m[1]);
        const lm = /<lastmod>([^<]+)<\/lastmod>/.exec(m[1]);
        if (!loc || !lm) continue;
        const t = Date.parse(lm[1]);
        if (Number.isFinite(t) && t >= sinceMs) out.push(loc[1].trim());
    }
    return out;
}

/**
 * 直近2日に更新された URL を IndexNow に送る。何があっても例外は投げない。
 * @returns {Promise<{skipped?: string, sent?: number, status?: number, error?: string}>}
 */
async function submitIndexNow({ siteUrl, outDir, now = Date.now(), fetchImpl = globalThis.fetch, log = console.log } = {}) {
    try {
        if ((siteUrl || "").replace(/\/$/, "") !== PROD_URL) return { skipped: "本番ではない" };
        if (!fs.existsSync(path.join(outDir, `${INDEXNOW_KEY}.txt`))) {
            log("[indexnow] 鍵のファイルが out に無い — 送らない");
            return { skipped: "鍵のファイルが無い" };
        }
        const since = now - 2 * 24 * 60 * 60 * 1000;
        const urls = new Set();
        for (const f of SITEMAPS) {
            const p = path.join(outDir, f);
            if (!fs.existsSync(p)) continue;
            for (const u of urlsFromSitemap(fs.readFileSync(p, "utf8"), since)) {
                if (u.startsWith(PROD_URL + "/")) urls.add(u);
            }
        }
        const urlList = [...urls].slice(0, MAX_URLS);
        if (urlList.length === 0) {
            log("[indexnow] 直近2日に更新された URL が無い — 送らない");
            return { skipped: "更新された URL が無い" };
        }
        const res = await fetchImpl(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ host: new URL(PROD_URL).host, key: INDEXNOW_KEY, keyLocation: `${PROD_URL}/${INDEXNOW_KEY}.txt`, urlList }),
        });
        log(`[indexnow] ${urlList.length} 件を送った — HTTP ${res.status}`);
        return { sent: urlList.length, status: res.status };
    } catch (e) {
        log(`[indexnow] 送れなかった（デプロイは続ける）: ${e?.message ?? e}`);
        return { error: String(e?.message ?? e) };
    }
}

module.exports = { submitIndexNow, urlsFromSitemap, INDEXNOW_KEY, PROD_URL, ENDPOINT, SITEMAPS, MAX_URLS };
