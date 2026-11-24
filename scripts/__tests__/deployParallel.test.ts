import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 2026-11-23 の本番の Deploy Site（run 45269456903）は、共通の JS が変わって 54,093 件の HTML・txt を書く途中に
 * 12 本の並列（1 秒あたり約 58 件）で 14 分 40 秒かかり、ジョブの上限 45 分で止まった（札 journey.photo-ios#718）。
 * 書く件数は減らせない（どの頁にも共通のチャンクの名前が入る）ので、HTML・txt を並べて書く数を上げる。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../deploy-static-site.js");
const strip = (s: string) => s.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
const src = strip(readFileSync(join(__dirname, "..", "deploy-static-site.js"), "utf8"));

describe("Deploy Site の S3 への書き込みの並列", () => {
    it("HTML・txt は 48 本以上で書く（12 本では 5.4 万件に約 15 分かかった）", () => {
        expect(mod.HTML_CONCURRENCY).toBeGreaterThanOrEqual(48);
        expect(src).toMatch(/runPool\(htmlPlan\.upload,\s*uploadFile,\s*HTML_CONCURRENCY\)/);
    });

    it("素材は 12 本のまま（503 を CloudFront に持たれてチャンクが割れないように）", () => {
        expect(mod.ASSET_CONCURRENCY).toBe(12);
        expect(src).toMatch(/runPool\(imageAssets,\s*uploadFile,\s*ASSET_CONCURRENCY\)/);
        expect(src).toMatch(/runPool\(otherAssets,\s*uploadFile,\s*ASSET_CONCURRENCY\)/);
    });

    it("接続を使い回し、口の数は同時に書く数より多い・再試行は既定（3回）より多い", async () => {
        expect(mod.S3_MAX_SOCKETS).toBeGreaterThan(mod.HTML_CONCURRENCY);
        expect(await mod.s3.config.maxAttempts()).toBeGreaterThanOrEqual(5);
        expect(src).toMatch(/keepAlive:\s*true,\s*maxSockets:\s*S3_MAX_SOCKETS/);
    });

    it("段ごとに時間と 1 秒あたりの件数をログに出す", () => {
        let t = 1000;
        const timer = mod.stepTimer(() => t);
        t += 2500;
        expect(timer.report(500)).toBe("500 件を 2.5 秒（200 件/秒）");
        expect(src).toMatch(/Step 1\/3 done/);
        expect(src).toMatch(/Step 2\/3 done/);
    });
});
