import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-11-18: S3 の11月の料金はほぼ全部が書き込みの回数（APN1-Requests-Tier1）で、Deploy Site の回数に比例していた。
// 2026-11-12 の本番の回（run 43301134607）は、中身の変わったファイルが無いのに 10,683 + 42,961 件を全部 PutObject していた。
// ここで固定するのは「中身も付け方も前回と同じファイルは書かない・どちらかが違えば書く」こと。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../deploy-static-site.js") as {
    planUploads: (
        files: string[],
        opts: {
            remoteEtags: Map<string, string>;
            lastFingerprints: Map<string, string>;
            md5Of: (file: string) => string;
            force?: boolean;
        },
    ) => { upload: string[]; skip: string[] };
    putParamsFor: (key: string) => Record<string, string>;
    putParamsFingerprint: (params: Record<string, string>) => string;
    remoteEtagMap: (objs: Array<{ key: string; etag?: string }>) => Map<string, string>;
    encodeDeployState: (s: { fingerprints: Map<string, string>; staleSince: Map<string, number> }) => Buffer;
    decodeDeployState: (buf: Buffer | null) => { fingerprints: Map<string, string>; staleSince: Map<string, number> };
    classifyStaleObjects: (
        localKeys: string[],
        remoteObjects: Array<{ key: string; lastModified?: Date }>,
        now: number,
        graceMs: number,
        staleSince?: Map<string, number>,
    ) => { toDelete: string[]; kept: number; staleSince: Map<string, number> };
    ASSET_GRACE_MS: number;
    DEPLOY_STATE_KEY: string;
};
const { planUploads, putParamsFor, putParamsFingerprint, remoteEtagMap, encodeDeployState, decodeDeployState, classifyStaleObjects, ASSET_GRACE_MS, DEPLOY_STATE_KEY } = mod;

const MD5: Record<string, string> = {
    "index.html": "aaaa",
    "spots/kyoto.txt": "bbbb",
    "_next/static/chunks/app.js": "cccc",
    "images/spots/a.jpg": "dddd",
};
const md5Of = (f: string) => MD5[f];
const fp = (key: string) => putParamsFingerprint(putParamsFor(key));
/** S3 に今と同じ中身・同じ付け方で全部ある状態 */
function sameEverywhere() {
    const keys = Object.keys(MD5);
    return {
        remoteEtags: remoteEtagMap(keys.map((k) => ({ key: k, etag: `"${MD5[k]}"` }))),
        lastFingerprints: new Map(keys.map((k) => [k, fp(k)])),
        md5Of,
    };
}

describe("planUploads（S3 に書くかどうか）", () => {
    it("中身（ETag＝MD5）も付け方も同じなら書かない", () => {
        const plan = planUploads(Object.keys(MD5), sameEverywhere());
        expect(plan.upload).toEqual([]);
        expect(plan.skip).toEqual(Object.keys(MD5));
    });

    it("中身が違えば書く", () => {
        const opts = sameEverywhere();
        opts.remoteEtags.set("spots/kyoto.txt", "zzzz");
        const plan = planUploads(Object.keys(MD5), opts);
        expect(plan.upload).toEqual(["spots/kyoto.txt"]);
    });

    it("S3 に無いファイルは書く", () => {
        const opts = sameEverywhere();
        opts.remoteEtags.delete("images/spots/a.jpg");
        expect(planUploads(Object.keys(MD5), opts).upload).toEqual(["images/spots/a.jpg"]);
    });

    it("中身が同じでも、付け方（Content-Type・Cache-Control）が前回と違えば書く", () => {
        const opts = sameEverywhere();
        // 前回は max-age で配っていた、という控え（付け方を変えた直後の回）
        opts.lastFingerprints.set("index.html", putParamsFingerprint({ ContentType: "text/html", CacheControl: "public, max-age=3600" }));
        opts.lastFingerprints.set("_next/static/chunks/app.js", putParamsFingerprint({ ContentType: "text/plain", CacheControl: "public, max-age=31536000, immutable" }));
        expect(planUploads(Object.keys(MD5), opts).upload).toEqual(["index.html", "_next/static/chunks/app.js"]);
    });

    it("控えに付け方の記録が無いもの（控えが無い・初回）は書く", () => {
        const opts = sameEverywhere();
        opts.lastFingerprints = new Map();
        expect(planUploads(Object.keys(MD5), opts).upload).toEqual(Object.keys(MD5));
    });

    it("全部の書き直し（DEPLOY_FULL_UPLOAD）なら、同じでも書く", () => {
        expect(planUploads(Object.keys(MD5), { ...sameEverywhere(), force: true }).upload).toEqual(Object.keys(MD5));
    });

    it("マルチパートの ETag（-N 付き）は MD5 と一致しないので書く側に倒れる", () => {
        const opts = sameEverywhere();
        opts.remoteEtags.set("index.html", "aaaa-2");
        expect(planUploads(["index.html"], opts).upload).toEqual(["index.html"]);
    });
});

describe("付け方の指紋（putParamsFor）", () => {
    it("PutObject に渡す付け方（Content-Type・Cache-Control）がそのまま指紋に入る", () => {
        expect(putParamsFor("index.html")).toEqual({ ContentType: "text/html", CacheControl: "no-cache" });
        expect(putParamsFor("_next/static/chunks/app.js")).toEqual({
            ContentType: "text/javascript",
            CacheControl: "public, max-age=31536000, immutable",
        });
        expect(fp("index.html")).not.toBe(fp("_next/static/chunks/app.js"));
        // 項目の順が違っても同じ指紋
        expect(putParamsFingerprint({ CacheControl: "x", ContentType: "y" })).toBe(putParamsFingerprint({ ContentType: "y", CacheControl: "x" }));
    });

    it("uploadFile は putParamsFor の値だけを付ける（ここ以外で付け方を足すと、変えても書き直されない）", () => {
        const src = readFileSync(join(__dirname, "..", "deploy-static-site.js"), "utf8");
        const body = src.slice(src.indexOf("async function uploadFile("), src.indexOf("function planUploads("));
        expect(body).toMatch(/\.\.\.putParamsFor\(key\)/);
        expect(body).not.toMatch(/ContentType:|CacheControl:|ContentEncoding:|Metadata:/);
    });

    it("main は書く前に planUploads で選び、選んだものだけを書く", () => {
        const src = readFileSync(join(__dirname, "..", "deploy-static-site.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
        expect(src).toMatch(/planUploads\(assets,/);
        expect(src).toMatch(/planUploads\(htmlFiles,/);
        expect(src).toMatch(/splitImagesFirst\(assetPlan\.upload\)/);
        expect(src).toMatch(/runPool\(htmlPlan\.upload,\s*uploadFile/);
        expect(src).not.toMatch(/runPool\((assets|htmlFiles),\s*uploadFile/);
        // 書いた件数と飛ばした件数をログに出す
        expect(src).toMatch(/uploading \$\{assetPlan\.upload\.length\} asset\(s\)（skip \$\{assetPlan\.skip\.length\}/);
        expect(src).toMatch(/uploading \$\{htmlPlan\.upload\.length\} HTML\/txt file\(s\)（skip \$\{htmlPlan\.skip\.length\}/);
    });
});

describe("デプロイの控え（S3 の _deploy/state.json.gz）", () => {
    it("書いて読むと同じものに戻る", () => {
        const s = { fingerprints: new Map([["index.html", fp("index.html")]]), staleSince: new Map([["_next/static/old.js", 123]]) };
        const back = decodeDeployState(encodeDeployState(s));
        expect(back.fingerprints).toEqual(s.fingerprints);
        expect(back.staleSince).toEqual(s.staleSince);
    });

    it("無い・壊れている・版が違う控えは空（＝全部を書く）", () => {
        expect(decodeDeployState(null).fingerprints.size).toBe(0);
        expect(decodeDeployState(Buffer.from("not gzip")).fingerprints.size).toBe(0);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const zlib = require("node:zlib");
        expect(decodeDeployState(zlib.gzipSync(JSON.stringify({ version: 999, fingerprints: { a: "b" } }))).fingerprints.size).toBe(0);
    });

    it("控えそのものは、ビルドに無くても掃除で消さない", () => {
        const { toDelete } = classifyStaleObjects(["index.html"], [{ key: DEPLOY_STATE_KEY, lastModified: new Date(0) }], Date.now(), ASSET_GRACE_MS, new Map());
        expect(toDelete).toEqual([]);
    });
});

describe("書き直さなくなった素材の猶予は「ビルドから外れた時」から数える", () => {
    const NOW = 1_800_000_000_000;
    const DAY = 86_400_000;

    it("40日前から変わっていない素材が今日ビルドから外れても、すぐには消さず、今日を外れた日として控える", () => {
        const { toDelete, staleSince } = classifyStaleObjects(
            [], [{ key: "_next/static/chunks/old.js", lastModified: new Date(NOW - 40 * DAY) }], NOW, ASSET_GRACE_MS, new Map(),
        );
        expect(toDelete).toEqual([]);
        expect(staleSince.get("_next/static/chunks/old.js")).toBe(NOW);
    });

    it("外れてから猶予を過ぎたら消す", () => {
        const { toDelete, staleSince } = classifyStaleObjects(
            [], [{ key: "_next/static/chunks/old.js", lastModified: new Date(NOW - 80 * DAY) }], NOW, ASSET_GRACE_MS,
            new Map([["_next/static/chunks/old.js", NOW - 31 * DAY]]),
        );
        expect(toDelete).toEqual(["_next/static/chunks/old.js"]);
        expect(staleSince.size).toBe(0);
    });

    it("HTML は今までどおりすぐ消す", () => {
        const { toDelete } = classifyStaleObjects([], [{ key: "photo/x.html", lastModified: new Date(NOW) }], NOW, ASSET_GRACE_MS, new Map());
        expect(toDelete).toEqual(["photo/x.html"]);
    });

    it("ビルドに戻ってきたものは控えから外す", () => {
        const { staleSince } = classifyStaleObjects(
            ["_next/static/chunks/old.js"], [{ key: "_next/static/chunks/old.js", lastModified: new Date(NOW - 40 * DAY) }], NOW, ASSET_GRACE_MS,
            new Map([["_next/static/chunks/old.js", NOW - 5 * DAY]]),
        );
        expect(staleSince.size).toBe(0);
    });
});
