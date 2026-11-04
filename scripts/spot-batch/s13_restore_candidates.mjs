// 段13: s12 のあと。候補ファイルは「新しいスポットの分だけ」足した形にし、確定ファイル（spot-samples.json）は
// develop の版に戻す。機械が選んだ作例は作業用フォルダの samples_before_visual.json に控える（目視の材料）。
// 見ていない写真は画面に出さない決まり（第4束）なので、確定ファイルには s16 で目視の結果だけを書く。
//   SPOT_BATCH_DIR=… node scripts/spot-batch/s13_restore_candidates.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { formatCandidatesFile, writeFileAtomic, CANDIDATES_PATH, SAMPLES_PATH } from "../collect-commons-samples.mjs";

const DIR = process.env.SPOT_BATCH_DIR;
if (!DIR) throw new Error("SPOT_BATCH_DIR に作業用フォルダを渡す");
const PG = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ids = new Set(fs.readFileSync(path.join(DIR, "new_ids.txt"), "utf8").split(/\s+/).filter(Boolean));
const show = (p) => JSON.parse(execFileSync("git", ["-C", PG, "show", `origin/develop:${p}`], { encoding: "utf8", maxBuffer: 1 << 30 }));

const now = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8"));
const old = show("content/spot-samples.candidates.json");
const spots = { ...old.spots };
let added = 0;
for (const k of ids) if (now.spots[k]) { spots[k] = now.spots[k]; added++; }
const out = { ...old, spots: Object.fromEntries(Object.keys(spots).sort().map((k) => [k, spots[k]])) };
writeFileAtomic(CANDIDATES_PATH, formatCandidatesFile(out));

const samples = JSON.parse(fs.readFileSync(SAMPLES_PATH, "utf8"));
const before = Object.fromEntries(Object.entries(samples).filter(([k]) => ids.has(k)));
fs.writeFileSync(path.join(DIR, "samples_before_visual.json"), `${JSON.stringify(before, null, 1)}\n`);
execFileSync("git", ["-C", PG, "checkout", "origin/develop", "--", "content/spot-samples.json"]);
console.log(`候補を足した ${added} か所・機械の作例の控え ${Object.keys(before).length} か所（確定ファイルは develop の版に戻した）`);
