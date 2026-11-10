import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { LEARN_RESERVED_SEGMENTS, pageHasOwnAppCard } from "../spotDetailPath";

/**
 * 本文にアプリの札（`AppInstallCard`）を出している頁と `pageHasOwnAppCard` が一致するかの見張り
 * （2026-11-10 札 #515・秘書室の判断）。頁の名前を並べて覚えるのではなく、**ソースの読み込みのつながりから数える**:
 * `<AppInstallCard` を描く部品（札そのものとフッターを除く）→ それを直接・間接に読む `app/<道>/page.tsx`・`layout.tsx`。
 * 新しい頁で札を足すと、この一覧に道が増えてここが落ちる（`pageHasOwnAppCard` に足し忘れない）。
 */
const ROOT = resolve(__dirname, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "__tests__"]);

function walk(dir: string, acc: string[] = []): string[] {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(d.name)) continue;
        const p = join(dir, d.name);
        if (d.isDirectory()) walk(p, acc);
        else if (/\.(tsx?|jsx?)$/.test(d.name) && !/\.test\./.test(d.name)) acc.push(p);
    }
    return acc;
}

function resolveImport(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2));
    else return null;
    for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]) {
        const f = base + ext;
        if (existsSync(f) && statSync(f).isFile()) return f;
    }
    return null;
}

const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))];
const IMPORT_RE = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const importers = new Map<string, Set<string>>(); // 読まれる側 → 読む側
const sources = new Map<string, string>();
for (const f of files) {
    const src = readFileSync(f, "utf8");
    sources.set(f, src);
    for (const m of src.matchAll(IMPORT_RE)) {
        const target = resolveImport(f, m[1] ?? m[2]);
        if (!target) continue;
        if (!importers.has(target)) importers.set(target, new Set());
        importers.get(target)!.add(f);
    }
}

const CARD = join(ROOT, "app/components/AppInstallCard.tsx");
const FOOTER = join(ROOT, "app/components/Footer.tsx");
/** `<AppInstallCard` を描く部品（札そのものと、フッター＝出し分ける側を除く） */
const renderers = files.filter((f) => f !== CARD && f !== FOOTER && /<AppInstallCard[\s/>]/.test(sources.get(f)!));

/** 札を描く部品を直接・間接に読む page.tsx / layout.tsx の道（`app/spots/[slug]/page.tsx` → `/spots/[slug]`） */
function routesWithCard(): string[] {
    const seen = new Set<string>(renderers);
    const queue = [...renderers];
    while (queue.length) {
        const f = queue.shift()!;
        for (const imp of importers.get(f) ?? []) if (!seen.has(imp)) { seen.add(imp); queue.push(imp); }
    }
    return [...seen]
        .filter((f) => /^app\/(.*\/)?(page|layout)\.tsx$/.test(relative(ROOT, f)))
        .map((f) => {
            const rel = relative(ROOT, f);
            const kind = rel.endsWith("layout.tsx") ? " (layout)" : "";
            return "/" + dirname(rel).replace(/^app\/?/, "") + kind;
        })
        .sort();
}

/**
 * 札を描く部品を読む道と、その道でフッターの札を出さないか。
 * `false` は「部品は読むが本文に札を出さない」道で、理由を書いて試験で確かめる。
 */
const EXPECTED: Record<string, boolean> = {
    "/": true, // ホーム（`GalleryPageClient` の surface="home"）
    "/learn/[slug]": true, // 教科書の章（`ChapterBody`・placement=article）
    "/search": false, // 同じ `GalleryPageClient` を surface="search" で使う。札は surface="home" のときだけ（下で確かめる）
    "/spots/[slug]": true, // 撮影スポット詳細（`SpotNext`・placement=spot_detail）
};

describe("本文にアプリの札がある頁 ＝ pageHasOwnAppCard", () => {
    it("札を描く部品が見つかる（見張りが空振りしていない）", () => {
        expect(renderers.map((f) => relative(ROOT, f)).sort()).toEqual([
            "app/GalleryPageClient.tsx",
            "app/components/SpotNext.tsx",
            "app/learn/_parts/ChapterBody.tsx",
        ]);
    });

    it("札を描く部品を読む頁の一覧が決めた表と一致する（頁を足したら表と pageHasOwnAppCard の両方を直す）", () => {
        expect(routesWithCard()).toEqual(Object.keys(EXPECTED).sort());
    });

    it("表の道ごとに pageHasOwnAppCard が合う（[slug] は実際の名前の形で見る）", () => {
        for (const [route, own] of Object.entries(EXPECTED)) {
            const sample = route.replace(/\[([^\]]+)\]/g, "sample-$1");
            expect(pageHasOwnAppCard(sample), `${route} → ${sample}`).toBe(own);
            expect(pageHasOwnAppCard(`${sample}/`.replace(/\/\/$/, "/")), `${route}（末尾の /）`).toBe(own);
        }
    });

    it("/search で札を出さない理由がソースのとおり（札は surface=\"home\" のときだけ・検索は surface=\"search\"）", () => {
        const gallery = sources.get(join(ROOT, "app/GalleryPageClient.tsx"))!;
        const cardLines = gallery.split("\n").filter((l) => /<AppInstallCard[\s/>]/.test(l));
        expect(cardLines.length).toBeGreaterThan(0);
        for (const l of cardLines) expect(l, l.trim()).toMatch(/surface === "home" && <AppInstallCard/);
        expect(sources.get(join(ROOT, "app/search/page.tsx"))).toMatch(/surface="search"/);
    });

    it("教科書の予約語は app/learn の下の静的な道と一致し、そこでは札を出す側（章ではない）", () => {
        const dir = join(ROOT, "app/learn");
        const names = readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("_") && !SKIP_DIRS.has(d.name)
                && existsSync(join(dir, d.name, "page.tsx")))
            .map((d) => d.name).sort();
        expect([...LEARN_RESERVED_SEGMENTS].sort()).toEqual(names);
        for (const n of names) expect(pageHasOwnAppCard(`/learn/${n}`), n).toBe(false);
        expect(pageHasOwnAppCard("/learn")).toBe(false);
    });
});
