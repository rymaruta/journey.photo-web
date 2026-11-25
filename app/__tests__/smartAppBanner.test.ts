import type React from "react";
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appItunes, appPageMetadata, siteConfig } from "@/lib/utils/seo";

/**
 * **検索から来た人をアプリへつなぐ**（Smart App Banner・2026-10-07）。
 * iPhone の Safari が `<meta name="apple-itunes-app" content="app-id=…, app-argument=…">` を見て、
 * ページ上部に「開く／入手」の帯を出す。Next は metadata の `itunes` からこのタグを書く。
 *
 * 2026-11-20 owner 判断（札 journey.photo-ios#666）: `app-argument` に**その頁の正規の URL（canonical）**を渡す。
 * アプリが入っている人が帯の「開く」を押すと、アプリはその URL を受け取る。
 * Next のメタデータは `itunes` を**オブジェクトごと差し替える**ので、canonical を書く所は必ず
 * `appItunes(<同じ URL>)` を一緒に書く。生の `itunes: { … }` は書かない（App ID がずれる・argument が抜ける）。
 * （以前の決まり「子は itunes を書かない」は、頁ごとの URL を渡すためにこの形へ改めた）
 */
const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** メタデータを書く所（頁・レイアウトと、頁のメタデータを組む lib の部品） */
function metadataSources(): string[] {
    const list = (dir: string) => fs.readdirSync(path.join(root, dir), { recursive: true })
        .map(String)
        .filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__"))
        .map((f) => path.join(dir, f));
    return [...list("app"), ...list("lib")];
}

describe("Smart App Banner", () => {
    it("App Store の App ID は数字だけ（違う形だと Safari は帯を出さない）", () => {
        expect(siteConfig.iosAppId).toMatch(/^\d{9,10}$/);
    });

    it("ルートの metadata が appItunes でトップの URL を渡している（canonical と同じ）", () => {
        const src = stripComments(read("app/layout.tsx"));
        expect(src).toMatch(/itunes:\s*appItunes\(siteConfig\.url\)/);
    });

    it("appItunes は URL を app-argument に入れる（無ければ App ID だけ）", () => {
        expect(appItunes("https://journey-photo.com/spots/x")).toEqual({
            appId: siteConfig.iosAppId,
            appArgument: "https://journey-photo.com/spots/x",
        });
        expect(appItunes()).toEqual({ appId: siteConfig.iosAppId });
        expect(appItunes(null)).toEqual({ appId: siteConfig.iosAppId });
    });

    it("Next が書き出す meta に app-argument が入る（Safari が読む形）", async () => {
        // Next の metadata を `<meta>` にする部品そのもの（`next/dist/lib/metadata/metadata-elements`）。
        // Next 16.4 で `generate/basic` の `ItunesMeta` から、metadata 全体を受ける `createMetadataElements` に替わった
        const { createMetadataElements } = await import("next/dist/lib/metadata/metadata-elements");
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { createElement, Fragment } = await import("react");
        const url = `${siteConfig.url}/spots/kiyomizu`;
        const tags = createMetadataElements({ itunes: appItunes(url) } as Parameters<typeof createMetadataElements>[0]);
        const html = renderToStaticMarkup(createElement(Fragment, null, ...tags));
        expect(html).toBe(`<meta name="apple-itunes-app" content="app-id=${siteConfig.iosAppId}, app-argument=${url}"/>`);
    });

    it("組んだメタデータの app-argument は canonical と同じ URL", () => {
        const m = appPageMetadata("/feedback", "意見を送る");
        expect(m.itunes.appArgument).toBe(m.alternates.canonical);
        expect(m.itunes.appArgument).toBe(`${siteConfig.url}/feedback`);
    });

    it("canonical を書く所は、どれも同じ URL で appItunes を書いている（頁ごとに app-argument が正しい URL になる）", () => {
        const missing: string[] = [];
        let found = 0;
        for (const f of metadataSources()) {
            const src = stripComments(read(f));
            for (const m of src.matchAll(/\bcanonical:\s*(`[^`]*`|[^,}\n]+?)\s*[,}\n]/g)) {
                const expr = m[1].trim();
                if (expr === "null" || expr === "undefined") continue;
                found++;
                const esc = expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                if (!new RegExp(`itunes:\\s*appItunes\\(\\s*${esc}\\s*\\)`).test(src)) missing.push(`${f}: ${expr}`);
            }
        }
        expect(found).toBeGreaterThanOrEqual(15);
        expect(missing).toEqual([]);
    });

    it("生の itunes: { … } を書かない（App ID と argument は appItunes だけが組む）", () => {
        const raw = metadataSources().filter((f) => /\bitunes:\s*\{/.test(stripComments(read(f))));
        expect(raw).toEqual([]);
    });
});
