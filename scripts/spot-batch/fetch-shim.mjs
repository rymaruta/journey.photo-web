// 段17: 手元に落としてある Commons の縮小版（同じ URL）を fetch の答えにする。無いものはそのまま取りにいく。
//   npx tsx --import ./scripts/spot-batch/fetch-shim.mjs scripts/promote-sample-covers.ts --slug=…
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.SPOT_BATCH_DIR;
if (!DIR) throw new Error("SPOT_BATCH_DIR に作業用フォルダを渡す");
const map = JSON.parse(fs.readFileSync(path.join(DIR, "local_map.json"), "utf8"));
const real = globalThis.fetch;
let hit = 0;
let miss = 0;
globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (map[u]) {
        hit++;
        return new Response(fs.readFileSync(map[u]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (u.includes("upload.wikimedia.org")) miss++;
    return real(url, init);
};
process.on("exit", () => console.log(`[shim] 手元 ${hit}・取りにいった ${miss}`));
