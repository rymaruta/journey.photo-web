import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";

/**
 * 🔴 **APNs の鍵を、改行ごと本番の関数に届ける**（札 journey.photo-ios#585）。
 *
 * 2026-11-12、本番と staging の送る関数の `APNS_PRIVATE_KEY` が全部 27 文字
 * （`-----BEGIN PRIVATE KEY-----` の1行）で、`sendPush` が `DECODER routines::unsupported`
 * で落ちていた。原因は serverless v3 の `--param` の読み方——
 * `@serverless/dashboard-plugin` の `lib/resolve-params.js` が
 * `/(?<key>[^=]+)=(?<value>.+)/` で読み、`.` は改行に当たらないので1行目で切れる。
 *
 * ここでは「ワークフローが渡す1行」を同じ正規表現に通し、`apns.ts` と同じ戻し方で
 * 本物の鍵として読めるところまで確かめる。
 */
const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "apns-key-param.sh");
/**
 * serverless v3（dashboard-plugin 7.2.3）の `--param` の読み方そのまま。
 * 本物は名前付きの組（`(?<key>[^=]+)=(?<value>.+)`）だが、ここの型の設定が古い書き方しか通さないので番号で読む（意味は同じ）
 */
const SLS_PARAM = /([^=]+)=(.+)/;
const slsParamValue = (item: string) => item.match(SLS_PARAM)![2].trimEnd();
/** `api-user/src/apns.ts` の `PRIVATE_KEY` と同じ戻し方 */
const restore = (v: string) => v.replace(/\\n/g, "\n");

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function run(key: string) {
    return spawnSync("bash", [SCRIPT], { env: { ...process.env, APNS_PRIVATE_KEY: key }, encoding: "utf8" as const });
}

describe("鍵を --param に渡す1行にする", () => {
    it("改行のまま渡すと、serverless は1行目（27文字）しか読まない（直す前の形）", () => {
        expect(slsParamValue(`apnsPrivateKey=${PEM}`)).toBe("-----BEGIN PRIVATE KEY-----");
    });

    it("変えた1行は、serverless を通っても丸ごと届き、apns.ts の戻し方で鍵として読める", () => {
        const r = run(PEM);
        expect(r.status).toBe(0);
        expect(r.stdout).not.toContain("\n");
        const delivered = restore(slsParamValue(`apnsPrivateKey=${r.stdout}`));
        expect(delivered.trim()).toBe(PEM.trim());
        expect(() => createPrivateKey(delivered)).not.toThrow();
    });

    it("Windows の改行（CRLF）で貼られた鍵も読める", () => {
        const r = run(PEM.replace(/\n/g, "\r\n"));
        expect(r.status).toBe(0);
        expect(() => createPrivateKey(restore(slsParamValue(`apnsPrivateKey=${r.stdout}`)))).not.toThrow();
    });

    it("ログには長さと改行の数だけを出し、鍵の中身は出さない", () => {
        const r = run(PEM);
        const body = PEM.split("\n")[1];
        expect(r.stderr).toMatch(/\d+ 文字・改行 \d+ 個/);
        expect(r.stderr).not.toContain(body);
    });
});

describe("壊れた鍵なら配らずに止める", () => {
    it.each([
        ["1行目だけ（27文字）", "-----BEGIN PRIVATE KEY-----"],
        ["END が無い", PEM.replace(/-----END PRIVATE KEY-----\n?/, "")],
        ["BEGIN が無い", PEM.replace(/-----BEGIN PRIVATE KEY-----\n?/, "")],
        ["200 文字未満", "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"],
    ])("%s", (_name, key) => {
        const r = run(key);
        expect(r.status).toBe(1);
        expect(r.stdout).toBe("");
    });
});

describe("deploy-api.yml", () => {
    const wf = readFileSync(join(ROOT, ".github", "workflows", "deploy-api.yml"), "utf8");
    it("鍵を改行のまま --param に渡す所が無い", () => {
        expect(wf).not.toMatch(/apnsPrivateKey=\$\{?APNS_PRIVATE_KEY/);
    });
    it("鍵を渡す所は、どれも apns-key-param.sh を通した値を使う", () => {
        const uses = wf.match(/--param "apnsPrivateKey=\$apns_key"/g) ?? [];
        const calls = wf.match(/apns_key="\$\(bash \.\.\/scripts\/apns-key-param\.sh\)"/g) ?? [];
        const all = wf.match(/apnsPrivateKey=/g) ?? [];
        expect(uses.length).toBeGreaterThan(0);
        expect(uses.length).toBe(all.length);
        expect(calls.length).toBe(uses.length);
    });
});
