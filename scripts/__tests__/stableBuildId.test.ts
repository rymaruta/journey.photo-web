import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// 2026-11-18: ビルドIDがコミットの sha だと、データも JS も同じでも全ページの HTML と txt が毎回変わり、
// Deploy Site が約5.2万件を S3 に書き直していた（札 journey.photo-ios#638）。
// ここで固定するのは「画面の JS が同じなら同じビルドID・JS が違えば違うビルドID」と、置き換えの漏れで止まること。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyStableBuildId, clientBuildHash } = require("../lib/stableBuildId.js") as {
    applyStableBuildId: (outDir: string, buildId: string) => { from: string; to: string; files: number };
    clientBuildHash: (outDir: string, buildId: string) => string;
};

const SHA_A = "a".repeat(39) + "1";
const SHA_B = "b".repeat(39) + "2";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "stable-build-id-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function put(out: string, rel: string, body: string) {
    const full = join(out, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
}

/** next の静的出力の形（`<!--ID24-->`・RSC の "b"・`_next/static/<ID>/`）をまねた out/ */
function fakeOut(name: string, sha: string, { js = "console.log(1)", data = "京都" } = {}) {
    const out = join(root, name);
    const head = sha.slice(0, 24);
    put(out, "index.html", `<!DOCTYPE html><!--${head}--><html><script src="/_next/static/chunks/app-1.js"></script><script>self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"${sha}\\"}"])</script>${data}</html>`);
    put(out, "spots/kyoto.txt", `0:{"P":null,"b":"${sha}","c":["","spots","kyoto"]}\n1:"${data}"`);
    put(out, "_next/static/chunks/app-1.js", js);
    put(out, `_next/static/${sha}/_buildManifest.js`, "self.__BUILD_MANIFEST={}");
    put(out, "images/a.jpg", "\xff\xd8binary");
    return out;
}

describe("applyStableBuildId（ビルドIDを画面の JS の指紋にする）", () => {
    it("コミットが違っても、JS が同じならビルドIDは同じ・HTML も txt も同じ中身になる", () => {
        const a = fakeOut("a", SHA_A);
        const b = fakeOut("b", SHA_B);
        const ra = applyStableBuildId(a, SHA_A);
        const rb = applyStableBuildId(b, SHA_B);
        expect(ra.to).toBe(rb.to);
        expect(ra.to).toMatch(/^[0-9a-f]{40}$/);
        expect(readFileSync(join(a, "index.html"), "utf8")).toBe(readFileSync(join(b, "index.html"), "utf8"));
        expect(readFileSync(join(a, "spots/kyoto.txt"), "utf8")).toBe(readFileSync(join(b, "spots/kyoto.txt"), "utf8"));
    });

    it("JS が違えばビルドIDも違う（古い JS の端末は今までどおり丸ごと読み直す）", () => {
        const a = fakeOut("a", SHA_A);
        const b = fakeOut("b", SHA_B, { js: "console.log(2)" });
        expect(applyStableBuildId(a, SHA_A).to).not.toBe(applyStableBuildId(b, SHA_B).to);
    });

    it("データだけ違っても、ビルドIDは同じ（データは JS の指紋に入れない）", () => {
        const a = fakeOut("a", SHA_A);
        const b = fakeOut("b", SHA_B, { data: "奈良" });
        expect(applyStableBuildId(a, SHA_A).to).toBe(applyStableBuildId(b, SHA_B).to);
    });

    it("RSC の b・HTML の頭のコメント（24文字）・置き場の名前を全部置き換え、旧IDを残さない", () => {
        const a = fakeOut("a", SHA_A);
        const { to } = applyStableBuildId(a, SHA_A);
        const html = readFileSync(join(a, "index.html"), "utf8");
        expect(html.startsWith(`<!DOCTYPE html><!--${to.slice(0, 24)}-->`)).toBe(true);
        expect(html).toContain(`\\"b\\":\\"${to}\\"`);
        expect(readFileSync(join(a, "spots/kyoto.txt"), "utf8")).toContain(`"b":"${to}"`);
        expect(existsSync(join(a, `_next/static/${to}/_buildManifest.js`))).toBe(true);
        expect(existsSync(join(a, `_next/static/${SHA_A}`))).toBe(false);
        expect(html).not.toContain(SHA_A.slice(0, 24));
    });

    it("ビルドIDの置き場（_next/static/<ID>/）は指紋に入れない（入れると sha が指紋に混ざる）", () => {
        expect(clientBuildHash(fakeOut("a", SHA_A), SHA_A)).toBe(clientBuildHash(fakeOut("b", SHA_B), SHA_B));
    });

    it("置き換えられない所に旧IDが残っていたら止める", () => {
        const a = fakeOut("a", SHA_A);
        // 置き換えの組に無い形（頭の24文字だけ・コメントの形でない）で入っている
        put(a, "odd.html", `<p>${SHA_A.slice(0, 24)}</p>`);
        expect(() => applyStableBuildId(a, SHA_A)).toThrow(/旧ID/);
    });

    it("画像の中のバイトが偶然一致しても止めない（中身を見るのは文字のファイルだけ）", () => {
        const a = fakeOut("a", SHA_A);
        put(a, "images/spots/thumb/x.jpg", `\xff${SHA_A.slice(0, 24)}\xd9`);
        expect(() => applyStableBuildId(a, SHA_A)).not.toThrow();
    });

    it("想定の形でないビルドIDは止める", () => {
        expect(() => applyStableBuildId(fakeOut("a", SHA_A), "short")).toThrow(/想定の形/);
    });

    it("ビルドは next build のあとに置き換えを呼ぶ", () => {
        const src = readFileSync(join(__dirname, "..", "prepare-static-build.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
        const build = src.indexOf('execSync("npx next build"');
        const stab = src.indexOf("stabilizeBuildId();");
        expect(build).toBeGreaterThan(-1);
        expect(stab).toBeGreaterThan(build);
    });
});
