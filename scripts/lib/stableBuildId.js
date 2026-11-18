/**
 * ビルドIDを「画面の JS（`out/_next/static/`）の中身」から決め直す（2026-11-18・S3 の書き込みの料金・札 journey.photo-ios#638）。
 *
 * **なぜ:** `next.config.ts` はビルドIDをコミットの sha にしている。ビルドIDは全ページの HTML と、
 * 画面を切り替えるときに読む `.txt`（RSC のデータ）に埋まるので、**コミットが変わるたびに約5.2万件が全部「変わった」**
 * ことになり、Deploy Site が全部を S3 に書き直していた（2026-11-18 の push の回: 書いた 52,242 件のうち
 * HTML/txt 52,238 件。11/16 の本番2回を S3 の版で比べると、HTML 25件中21件・txt 25件中25件が sha の文字だけ違った）。
 *
 * **ビルドIDを Next が何に使っているか（next@16.1.1 のソースで確かめた）:**
 *  1. `client/app-index.js`: 最初の HTML に埋まった RSC の `b` を `setAppBuildId` で控える
 *  2. `client/components/router-reducer/fetch-server-response.js`: 画面を切り替えるときに読んだ `.txt` の `b` が
 *     控えと違えば `doMpaNavigation`（ページを丸ごと読み直す）。**古い JS と新しい JS が混ざらないための判定**
 *  3. `client/components/segment-cache/cache.js`: 先読み（prefetch）の結果も `b`／`buildId` が違えば捨てる
 *  4. `shared/lib/segment-cache/output-export-prefetch-encoding.js`: `output: "export"` では HTML の頭
 *     （`<!DOCTYPE html>` の直後）に `<!--ビルドIDの先頭24文字-->` を入れ、先読みで先頭 64 バイトだけ取って比べる
 *  5. `_next/static/<ビルドID>/_buildManifest.js` などの置き場の名前
 *
 * つまりビルドIDは「この `.txt` は、いま動いている JS と同じビルドのものか」の合言葉。画面の JS が同じなら、
 * 同じ合言葉で困ることは無い（データだけが新しくなるのは、Next の ISR が同じビルドIDのまま新しいデータを配るのと同じ形）。
 * JS が1バイトでも変われば、ここでのビルドIDも変わり、今までどおり丸ごと読み直しになる。
 *
 * **起きうること（変えたあと）:**
 *  - JS が同じでデータだけ違う版に切り替わった直後、古い HTML を開いている端末は、新しい `.txt` をそのまま使って
 *    画面を切り替える（今までは丸ごと読み直していた）。JS が同じなので、部品の番号・チャンクの名前は一致する
 *  - JS が違う版なら、ビルドIDが違うので今までどおり丸ごと読み直す
 *  - `_next/static/<旧ID>/` は、ビルドから外れた素材として 30 日残してから消える（deploy-static-site.js）
 *
 * **やり方:** `next build` が終わってから、`out/_next/static/`（ビルドIDの置き場を除く）の
 * 「パスと中身の SHA-256」を並べたものの SHA-1（40 桁）を新しいビルドIDにし、`out/` の文字のファイルの中の
 * 旧ID（全桁と、頭のコメントの24文字）を置き換え、置き場の名前も変える。置き換えたあとに旧IDの24文字が
 * どこかに残っていたら、ビルドを止める（半端なビルドIDで配らない）。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** HTML の頭のコメントに入るのはビルドIDの先頭 24 文字（next の `MAX_BUILD_ID_LENGTH`） */
const COMMENT_ID_LENGTH = 24;
/** ビルドIDが入りうる、文字のファイル */
const TEXT_EXT = new Set([".html", ".txt", ".js", ".json", ".css", ".xml", ".webmanifest", ".map", ".rsc", ".meta"]);

function walk(dir, base = dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, base, out);
        else out.push(path.relative(base, full).split(path.sep).join("/"));
    }
    return out;
}

/** 画面の JS の指紋（40 桁）。`_next/static/<buildId>/` は中身にビルドIDの名前が絡むので外す */
function clientBuildHash(outDir, buildId) {
    const staticDir = path.join(outDir, "_next", "static");
    const files = walk(staticDir).filter((f) => !f.startsWith(`${buildId}/`)).sort();
    if (files.length === 0) throw new Error("[build] out/_next/static が空です。ビルドIDを決められません。");
    const h = crypto.createHash("sha1");
    for (const f of files) {
        const sum = crypto.createHash("sha256").update(fs.readFileSync(path.join(staticDir, f))).digest("hex");
        h.update(`${f}\0${sum}\n`);
    }
    return h.digest("hex");
}

/** 1つのファイルの中身を置き換える。変わったら true */
function replaceInBuffer(buf, pairs) {
    let s = null;
    for (const [from] of pairs) {
        if (buf.includes(from)) { s = buf.toString("utf8"); break; }
    }
    if (s === null) return null;
    for (const [from, to] of pairs) s = s.split(from).join(to);
    return Buffer.from(s, "utf8");
}

/**
 * `out/` のビルドIDを、画面の JS の指紋に置き換える。戻り値は `{ from, to, files }`（置き換えたファイル数）。
 * 指紋が今のIDと同じ（＝もう置き換え済み）なら何もしない。
 */
function applyStableBuildId(outDir, buildId) {
    if (!/^[0-9A-Za-z_-]{24,}$/.test(buildId ?? "")) {
        throw new Error(`[build] ビルドID（${buildId}）が想定の形ではありません（24 文字以上の英数字）。`);
    }
    const to = clientBuildHash(outDir, buildId);
    if (to === buildId) return { from: buildId, to, files: 0 };
    const fromHead = buildId.slice(0, COMMENT_ID_LENGTH);
    const pairs = [
        [buildId, to],
        // HTML の頭のコメント（先頭 24 文字だけが入る）
        [`<!--${fromHead}-->`, `<!--${to.slice(0, COMMENT_ID_LENGTH)}-->`],
    ];
    let changed = 0;
    const files = walk(outDir);
    for (const f of files) {
        if (!TEXT_EXT.has(path.extname(f))) continue;
        const full = path.join(outDir, f);
        const next = replaceInBuffer(fs.readFileSync(full), pairs);
        if (next) { fs.writeFileSync(full, next); changed++; }
    }
    const oldDir = path.join(outDir, "_next", "static", buildId);
    if (fs.existsSync(oldDir)) fs.renameSync(oldDir, path.join(outDir, "_next", "static", to));

    // 旧IDの 24 文字がどこかに残っていたら止める（合言葉が半分だけ変わったビルドを配らない）
    const leftovers = [];
    for (const f of walk(outDir)) {
        // 中身を見るのは文字のファイルと拡張子の無いファイルだけ。画像の中のバイトの並びが偶然一致して止まらないように
        // （2026-11-18 の確かめで、`bbbb…` の仮の ID が spots/thumb の JPEG の中に偶然あって止まった。
        // 本物の sha の 24 桁がバイナリに偶然現れることはまず無いが、止まる側の害が大きい）
        const ext = path.extname(f);
        const scan = ext === "" || TEXT_EXT.has(ext);
        if (f.includes(fromHead) || (scan && fs.readFileSync(path.join(outDir, f)).includes(fromHead))) leftovers.push(f);
        if (leftovers.length >= 5) break;
    }
    if (leftovers.length > 0) {
        throw new Error(`[build] ビルドIDの置き換えのあとも旧ID（${fromHead}…）が残っています: ${leftovers.join(", ")}`);
    }
    return { from: buildId, to, files: changed };
}

module.exports = { applyStableBuildId, clientBuildHash, COMMENT_ID_LENGTH };
