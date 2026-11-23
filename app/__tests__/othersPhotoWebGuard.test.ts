import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * **他人の写真は、その人のもの**（journey.photo-ios の CLAUDE.md・2026-11-12 owner・絶対）を、
 * Web に画面を足しても機械で守る見張り（2026-11-23 owner「守れていた、ではなく守れるように」）。
 *
 * 写真を保存させない仕組みはサイト全体で1か所（`DisableSave`・`globals.css` の `-webkit-touch-callout`）。
 * ここでは、それを外す道と、画像そのものを手にできる道（画像のファイルを作る・渡す・落とす・コピーする・
 * 元画像への直リンク）が、下の一覧の外に増えていないかを形で見る。
 * 一覧に無い所が増えたら落ちる。一覧にあるのに見つからなくなった所も落ちる。
 * リンク（ページの URL）の共有は持ち主の写真へ連れて行くだけなので見ない。
 */

const ROOT = join(__dirname, "..", "..");
const DIRS = ["app", "lib"];

type Source = { path: string; code: string };

function stripComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
        .join("\n");
}

function walk(dir: string, out: string[]) {
    for (const name of readdirSync(dir)) {
        if (name === "__tests__" || name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
}

function load(): Source[] {
    const files: string[] = [];
    for (const d of DIRS) walk(join(ROOT, d), files);
    return files.map((f) => ({ path: relative(ROOT, f), code: stripComments(readFileSync(f, "utf8")) }));
}

/** 画像そのものを手にできる道（名前 → 形） */
const EXIT_RULES: Record<string, RegExp> = {
    imageFile: /\.toBlob\(|\.toDataURL\(|convertToBlob\(|new File\(\s*\[/,
    clipboardImage: /ClipboardItem|clipboard\.write\(/,
    shareFiles: /navigator\.share\(\s*\{[^}]*\bfiles\b|canShare\(\s*\{[^}]*\bfiles\b/,
    download: /\bdownload=|\bdownload:\s*["'`]|showSaveFilePicker|\.download\s*=/,
    fetchImage: /fetchImageBytes\(/,
    allowSave: /data-allow-save/,
};

/** 元画像（`src` など）の URL をそのまま外へ出す形。どこにも許さない */
const RAW_IMAGE_LINK = /href=\{[^}]*\.(src|thumbSrc|srcAvif|src256|thumbSm|thumbSmAvif|srcOriginal)\b[^}]*\}|window\.open\([^)]*\.(src|thumbSrc|srcAvif|srcOriginal)\b|navigator\.clipboard\.writeText\([^)]*\.(src|thumbSrc|srcAvif|srcOriginal)\b/;

function exits(sources: Source[]): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const s of sources) {
        const hit = Object.entries(EXIT_RULES).filter(([, re]) => re.test(s.code)).map(([name]) => name);
        if (hit.length) out[s.path] = hit.sort();
    }
    return out;
}

function rawImageLinks(sources: Source[]): string[] {
    return sources.flatMap((s) => s.code.split("\n").flatMap((line, i) => RAW_IMAGE_LINK.test(line) ? [`${s.path}:${i + 1}`] : []));
}

/** ファイル → 許す道と理由。**人の写真で動かないことを確かめてから足す** */
const ALLOWED: Record<string, { rules: string[]; why: string }> = {
    "lib/utils/image.ts": { rules: ["imageFile"], why: "自分が選んだ写真を上げる形に縮める（投稿・アイコン）" },
    "lib/utils/imageBytes.ts": { rules: ["fetchImage"], why: "画像の中身を取る口そのもの（呼ぶ所はこの一覧で見張る）" },
    "lib/utils/saveGuard.ts": { rules: ["allowSave"], why: "保存を止める判定そのもの（`data-allow-save` の中だけ許す・今は使う所が無い）" },
    "app/components/stories/StoryViewer.tsx": { rules: ["fetchImage", "imageFile"], why: "自分のストーリーを写真に残すときの縮小画像（サーバーも持ち主だけ・`storyKeep.ts`）" },
    "app/user/profile/page.tsx": { rules: ["fetchImage", "imageFile"], why: "自分の投稿からカバーを選ぶ（候補は自分の写真だけ・#304）" },
    "app/users/UserProfileClient.tsx": { rules: ["imageFile"], why: "プロフィールの QR コードの画像（写真ではない）" },
};

describe("他人の写真の見張り（Web）", () => {
    const sources = load();

    it("画像そのものを手にできる道は一覧の外に増えない", () => {
        expect(sources.length).toBeGreaterThan(100);
        const found = exits(sources);
        const unexpected = Object.entries(found)
            .map(([path, rules]) => [path, rules.filter((r) => !(ALLOWED[path]?.rules ?? []).includes(r))] as const)
            .filter(([, rules]) => rules.length > 0)
            .map(([path, rules]) => `${path}: ${rules.join(",")}`);
        expect(unexpected, "画像を手にできる道が増えた。人の写真で動かないことを確かめてから、理由と一緒に一覧に足す").toEqual([]);
        const stale = Object.entries(ALLOWED)
            .filter(([path, e]) => !e.rules.every((r) => (found[path] ?? []).includes(r)))
            .map(([path]) => path);
        expect(stale, "一覧にあるのに見つからない（消したなら一覧からも消す）").toEqual([]);
    });

    it("元画像の URL をリンク・コピー・新しいタブで外へ出さない", () => {
        expect(rawImageLinks(sources), "写真の画像の URL を外へ出している。共有するのはページのリンクにする").toEqual([]);
    });

    it("サイト全体の保存止めが外れていない", () => {
        const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
        expect(layout).toMatch(/<DisableSave\s*\/>/);
        const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
        expect(css).toMatch(/img,\s*video\s*\{[^}]*-webkit-touch-callout:\s*none;[^}]*-webkit-user-drag:\s*none;/);
        const guard = readFileSync(join(ROOT, "app/components/DisableSave.tsx"), "utf8");
        expect(guard).toMatch(/addEventListener\("contextmenu", onMedia, true\)/);
        expect(guard).toMatch(/addEventListener\("dragstart", onMedia, true\)/);
    });

    it("見張りそのものが効いている（わざと破った見本）", () => {
        const planted: Source[] = [
            { path: "a.tsx", code: "<a href={url} download=\"photo.jpg\">保存</a>" },
            { path: "b.tsx", code: "await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);" },
            { path: "c.tsx", code: "await navigator.share({ files: [file], title });" },
            { path: "d.tsx", code: "canvas.toBlob((b) => save(b));" },
            { path: "e.tsx", code: "const blob = await fetchImageBytes(photo.src);" },
            { path: "f.tsx", code: "<div data-allow-save><img src={photo.src} /></div>" },
        ];
        expect(Object.keys(exits(planted)).sort()).toEqual(["a.tsx", "b.tsx", "c.tsx", "d.tsx", "e.tsx", "f.tsx"]);
        expect(exits([{ path: "q.tsx", code: stripComments("// toBlob( の注釈\nawait navigator.share({ title, url });") }])).toEqual({});
        expect(rawImageLinks([
            { path: "r.tsx", code: "<a href={photo.src} target=\"_blank\">原寸</a>" },
            { path: "s.tsx", code: "window.open(photo.srcOriginal)" },
            { path: "t.tsx", code: "<a href={`/photo/${photo.id}`}>ページ</a>" },
        ])).toEqual(["r.tsx:1", "s.tsx:1"]);
    });
});
