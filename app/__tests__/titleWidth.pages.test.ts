import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { titleWidth } from "@/lib/utils/titleWidth";
import { renderedTitle, SITE_TITLE_SUFFIX, TITLE_MAX_WIDTH } from "@/lib/utils/seo";

/**
 * **頁の題は全角換算 33 字まで**（2026-11-25・SEO の観点 M1）。
 *
 * 本番で「今日の日の出」47頁が43〜44字、写真の教科書の4頁が33字を超えていた。題は検索結果で端末の幅に
 * 合わせて切られ、後ろの「 | Journey Photo」が付くと題の言葉が押し出される。
 * ここは**頁の作り（`generateMetadata`・`metadata`）をすべて**呼び、ルートの template を当てた
 * 最終の `<title>` を数える。新しい頁を足したときも、ここが見張る。
 *
 * 別の試験に任せているもの:
 *   - 観光スポットの頁（約4,500頁・`/spots/<slug>`）: `spotPageMeta.test.ts`（`SPOT_TITLE_MAX`）
 *   - 写真の頁（利用者の題）: `photo/[id]/__tests__/metadataSearch.test.ts`（長い題はサイト名を付けない）
 * 利用者の入力から作る頁（撮影地・タグ・カメラ・プロフィール）は 33 字に収まらないことがある。
 * その頁は「超えるならサイト名を付けない」だけを見る（プロフィールは名前で探されるためにサイト名を残す・#525）
 */
const ROOT = path.join(__dirname, "../..");
const SKIP = new Set(["app/layout.tsx", "app/spots/[slug]/page.tsx", "app/photo/[id]/page.tsx"]);
/** 利用者の入力（撮影地・タグ・カメラの名前・表示名）が題に入る頁 */
const USER_TEXT = new Set([
    "app/location/[location]/page.tsx", "app/tag/[tag]/page.tsx", "app/camera/[camera]/page.tsx", "app/users/[id]/page.tsx",
]);
/** プロフィールは「<名前> journey photo」で探されるので、サイト名を残す（2026-11-11 #525） */
const KEEP_SITE_NAME = new Set(["app/users/[id]/page.tsx"]);

function metadataFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${e.name}`;
            if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "api") walk(rel); continue; }
            if (!/^(page|layout|not-found)\.tsx$/.test(e.name) || SKIP.has(rel)) continue;
            const src = readFileSync(path.join(ROOT, rel), "utf8");
            if (/export (const metadata|(async )?function generateMetadata)\b/.test(src)) out.push(rel);
        }
    };
    walk("app");
    return out.sort();
}

type Mod = {
    metadata?: { title?: unknown };
    generateMetadata?: (a: unknown) => Promise<{ title?: unknown } | undefined>;
    generateStaticParams?: (a: unknown) => Promise<Record<string, string>[]> | Record<string, string>[];
};

async function titlesOf(rel: string): Promise<string[]> {
    const mod = (await import(path.join(ROOT, rel))) as Mod;
    const out: string[] = [];
    if (mod.metadata?.title !== undefined) out.push(renderedTitle(mod.metadata.title as string));
    if (mod.generateMetadata) {
        const params = mod.generateStaticParams ? await mod.generateStaticParams({ params: {} }) : [{}];
        for (const p of params) {
            const md = await mod.generateMetadata({ params: Promise.resolve(p), searchParams: Promise.resolve({}) });
            if (md?.title !== undefined) out.push(renderedTitle(md.title as string));
        }
    }
    return out;
}

describe("頁の題の長さ（全角換算 33 字まで）", () => {
    const files = metadataFiles();

    it("頁の作りを見つけている（今日の日の出・教科書・観光スポットの集まり・規約）", () => {
        for (const f of ["app/today/[pref]/page.tsx", "app/learn/[slug]/page.tsx", "app/spots/area/[area]/page.tsx", "app/terms/page.tsx"]) {
            expect(files).toContain(f);
        }
    });

    it("🔴 33 字を超える題が無い（利用者の入力が入る頁は、超えるならサイト名を付けない）", { timeout: 300_000 }, async () => {
        const bad: string[] = [];
        let count = 0;
        for (const f of files) {
            for (const t of await titlesOf(f)) {
                count++;
                if (titleWidth(t) <= TITLE_MAX_WIDTH) continue;
                if (!USER_TEXT.has(f)) bad.push(`${f}: ${titleWidth(t)} ${t}`);
                else if (!KEEP_SITE_NAME.has(f) && t.endsWith(SITE_TITLE_SUFFIX)) bad.push(`${f}: サイト名を付けて ${titleWidth(t)} ${t}`);
            }
        }
        expect(count).toBeGreaterThan(500);
        expect(bad).toEqual([]);
    });

    it("「・」で区切った題や「撮りどき」を、運営が付けた題に使わない（今日の日の出と教科書）", { timeout: 60_000 }, async () => {
        for (const f of ["app/today/page.tsx", "app/today/[pref]/page.tsx", "app/learn/page.tsx", "app/learn/[slug]/page.tsx", "app/learn/camera-basics/page.tsx", "app/learn/camera-brands/page.tsx"]) {
            for (const t of await titlesOf(f)) expect(t, f).not.toMatch(/・|撮りどき/);
        }
    });

    it("ルートの template と SITE_TITLE_SUFFIX が同じ", () => {
        const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
        expect(layout).toContain(`template: \`%s${SITE_TITLE_SUFFIX}\``);
    });
});
