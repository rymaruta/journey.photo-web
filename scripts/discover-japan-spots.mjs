#!/usr/bin/env node
// 日本国内の撮影スポット候補をWikidataから収集する。公開台帳は一切変更しない。
// Usage: node scripts/discover-japan-spots.mjs --limit=100 --out=tmp/japan-spot-candidates.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const categories = {
  waterfall: "Q34038",
  mountain: "Q8502",
  castle: "Q23413",
  shrine: "Q845945",
  lake: "Q23397",
  park: "Q3375722",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function normalizedName(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　・･]/g, "").toLocaleLowerCase("ja");
}
export function existingKeys(spots) {
  return new Set(spots.flatMap((spot) => [spot.name, spot.nameEn, ...(spot.aliases ?? [])]
    .filter(Boolean).map(normalizedName)));
}
export function filterCandidates(rows, spots) {
  const known = existingKeys(spots);
  const seen = new Set();
  return rows.filter((row) => {
    const id = row.wikidataId;
    const key = normalizedName(row.name);
    if (!id || !key || known.has(key) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
export function parseBindings(bindings, category) {
  return bindings.map((b) => {
    const uri = b.item?.value ?? "";
    const id = uri.match(/\/Q\d+$/)?.[0].slice(1);
    const name = b.name?.value ?? "";
    const coords = b.coord?.value?.match(/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
    return { wikidataId: id, name, category, lat: coords ? Number(coords[2]) : null,
      lng: coords ? Number(coords[1]) : null, source: id ? `https://www.wikidata.org/wiki/${id}` : null,
      status: "candidate", verified: false };
  }).filter((r) => r.wikidataId && r.name);
}
export function queryFor(type, limit) {
  if (!Object.values(categories).includes(type)) throw new Error("Unsupported category");
  return `SELECT DISTINCT ?item ?name ?coord WHERE {
    ?item wdt:P17 wd:Q17; wdt:P31/wdt:P279* wd:${type}; wdt:P625 ?coord.
    ?item rdfs:label ?name. FILTER(LANG(?name) = "ja")
  } LIMIT ${limit}`;
}
async function request(query) {
  const ua = process.env.WIKIMEDIA_USER_AGENT;
  if (!ua || !ua.includes("@")) throw new Error("Set WIKIMEDIA_USER_AGENT with a contact email");
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: { "User-Agent": ua, "Accept": "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query }),
      signal: AbortSignal.timeout(55000),
    });
    if (response.ok) return (await response.json()).results.bindings;
    if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`Wikidata HTTP ${response.status}`);
    const retry = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 120000) : 5000 * (attempt + 1));
  }
  throw new Error("Wikidata unavailable after retries");
}
async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("--limit must be 1..500");
  const out = args.find((a) => a.startsWith("--out="))?.slice(6) ?? "tmp/japan-spot-candidates.json";
  const target = path.resolve(root, out);
  if (!target.startsWith(root + path.sep) || !target.endsWith(".json")) throw new Error("Output must be JSON inside repository");
  const existing = JSON.parse(fs.readFileSync(path.join(root, "content/spots.json"), "utf8"));
  const collected = [];
  for (const [category, type] of Object.entries(categories)) {
    const bindings = await request(queryFor(type, limit));
    collected.push(...parseBindings(bindings, category));
    await sleep(2000);
  }
  const candidates = filterCandidates(collected, existing);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(),
    existingCount: existing.length, discoveredCount: collected.length, candidates }, null, 2) + "\n");
  console.log(`Existing: ${existing.length}, candidates: ${candidates.length}; saved to ${target}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
