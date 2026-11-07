// 段12: 新しいスポットだけの作例の候補を Commons から集める（collect-commons-samples.mjs の関数をそのまま使う）。
//   SPOT_BATCH_DIR=… timeout 7000 node scripts/spot-batch/s12_collect_samples.mjs > collect.log 2>&1   （背景で流す）
// 対象は作業用フォルダの new_ids.txt（s11 が書く）。QID は台帳の aiCheck.sources の Wikidata から。
// 2秒に1回・1本だけ。429・5xx は retry-after、検索の混雑（cirrussearch-too-busy-error）と maxlag は待って取り直す。
// 終わったら s13 で「新しい分以外の候補を develop の版に戻し、確定ファイルは目視まで戻す」。
import fs from "node:fs";
import path from "node:path";
const DIR = process.env.SPOT_BATCH_DIR;
if (!DIR) throw new Error("SPOT_BATCH_DIR に作業用フォルダを渡す");
import {
    LEDGER_PATH, CANDIDATES_PATH, SAMPLES_PATH, EXCLUDED_PATH, SAMPLE_EXCLUSIONS_PATH, USER_AGENT, MIN_INTERVAL_MS, DEFAULT_RADIUS_M,
    collectSpotCandidates, fetchFilePages, searchCenters, pickSamples, trimCandidates, forCandidatesFile, readJson,
    writeFileAtomic, formatCandidatesFile, buildSamplesFile, carryPdBasis, refreshPdBasis,
} from "../collect-commons-samples.mjs";
import { readExcluded, excludedKeySet, withoutExcluded, parseWikidataEntity, fileKey } from "../lib/commonsSampleRules.mjs";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0; const stats = { req: 0, r429: 0, waited: 0 };
async function api(base, params) {
    const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params })}`;
    for (let attempt = 0; attempt < 40; attempt++) {
        const w = last + MIN_INTERVAL_MS - Date.now(); if (w > 0) await sleep(w);
        last = Date.now(); stats.req++;
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT } });
        if (res.status === 429 || res.status >= 500) { const a = Math.max(Number(res.headers.get("retry-after")) || 0, Math.min(10 * (attempt + 1), 120)); stats.r429++; stats.waited += a; await sleep(a * 1000); continue; }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        const body = await res.json();
        if (body?.error?.code === "cirrussearch-too-busy-error") { stats.busy = (stats.busy ?? 0) + 1; stats.waited += 30 * (attempt + 1); await sleep(30000 * (attempt + 1)); continue; }
        if (body?.error?.code === "maxlag") { await sleep((Number(res.headers.get("retry-after")) || 5) * 1000); continue; }
        if (body?.error) throw new Error(`${body.error.code}: ${body.error.info}`);
        return body;
    }
    throw new Error(`応答しません: ${url}`);
}
const ids = new Set(fs.readFileSync(path.join(DIR, "new_ids.txt"), "utf8").split(/\s+/).filter(Boolean));
const spots = readJson(LEDGER_PATH, []);
const targets = spots.filter((s) => ids.has(s.spotId));
const qidOf = (s) => (s.aiCheck?.sources ?? []).map((x) => x.url.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1]).find(Boolean);
const excluded = readExcluded(EXCLUDED_PATH);
for (const k of excludedKeySet(readJson(SAMPLE_EXCLUSIONS_PATH, { samples: [] }).samples)) excluded.add(k);
const candidatesFile = withoutExcluded(readJson(CANDIDATES_PATH, { spots: {} }), excluded);
const qids = [...new Set(targets.map(qidOf).filter(Boolean))];
const facts = new Map();
for (let i = 0; i < qids.length; i += 50) {
    const r = await api(WIKIDATA, { action: "wbgetentities", ids: qids.slice(i, i + 50).join("|"), props: "claims" });
    for (const [id, e] of Object.entries(r.entities ?? {})) facts.set(id, parseWikidataEntity(e));
}
const p18 = await fetchFilePages([...facts.values()].map((f) => f.image).filter(Boolean), api);
const km = (a, b) => Math.hypot((a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 111);
const today = new Date().toISOString().slice(0, 10);
let n = 0;
for (const spot of targets) {
    n++;
    if (candidatesFile.spots[spot.spotId]) continue;
    const qid = qidOf(spot); const f = facts.get(qid) ?? {};
    // Wikidata の座標が台帳（記事の座標で直したもの）と 1km 以上離れるときは、探す中心に使わない
    const wdCoords = f.coords && km(f.coords, spot.coords) <= 1 ? f.coords : undefined;
    const centers = searchCenters(spot, wdCoords);
    let got;
    try {
        got = await collectSpotCandidates(spot, { qid, facts: { ...f, coords: wdCoords }, p18Page: f.image ? p18.get(fileKey(f.image)) : undefined, centers, radiusM: DEFAULT_RADIUS_M, excluded, call: api });
    } catch (e) { console.log(`[${n}/${targets.length}] ${spot.slug}: error ${e.message}`); continue; }
    const { scored, found, rejected, rejectedLicenses, geoSkipped } = got;
    candidatesFile.spots[spot.spotId] = {
        slug: spot.slug, name: spot.name, prefecture: spot.region?.prefecture ?? "", searchedAt: today, radiusM: DEFAULT_RADIUS_M, centers,
        ...(geoSkipped ? { geoSkipped: true } : {}), filesFound: found, usable: scored.length, named: scored.filter((c) => c.named).length,
        rejected, rejectedLicenses, candidates: trimCandidates(scored).map(forCandidatesFile),
    };
    console.log(`[${n}/${targets.length}] ${spot.slug}: 見つかった ${found}・使える ${scored.length}・自動で採れる ${pickSamples(scored).length}・${JSON.stringify(stats)}`);
    candidatesFile.spots = Object.fromEntries(Object.keys(candidatesFile.spots).sort().map((k) => [k, candidatesFile.spots[k]]));
    writeFileAtomic(CANDIDATES_PATH, formatCandidatesFile(candidatesFile));
}
// 確定ファイル: 既にあるスポットは選び直さない（keep=true）。新しい分だけ足す
const previous = readJson(SAMPLES_PATH, {});
const onlyNew = { ...candidatesFile, spots: Object.fromEntries(Object.entries(candidatesFile.spots).filter(([k]) => ids.has(k))) };
let samples = carryPdBasis(buildSamplesFile(onlyNew, spots, previous, true), previous);
samples = (await refreshPdBasis(samples)).file;
fs.writeFileSync(SAMPLES_PATH, `${JSON.stringify(samples, null, 2)}\n`);
console.log("done", JSON.stringify(stats), Object.keys(samples).filter((k) => ids.has(k)).length);
