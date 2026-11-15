import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import PhotoTileMeta from "../PhotoTileMeta";

// **管理画面の文字を中黒「·」「・」で区切らない（owner の好み 2026-11-12・直しは 2026-11-15）。**
// タイルの下の一行は `[location, category].join(" · ")` だった。撮影地と分類は
// 別の span にして、色（分類は muted）と余白（6px）で分ける。文の中で並べるときは「、」。

describe("タイルの撮影地と分類", () => {
    it("中黒を入れず、別の字として並べる", () => {
        const { getByTestId } = render(<PhotoTileMeta location="北海道" category="風景" />);
        const meta = getByTestId("admin-photo-meta");
        expect(meta.textContent).toBe("北海道風景");
        expect(meta.textContent).not.toMatch(/[·・]/);
        const [place, category] = Array.from(meta.children) as HTMLElement[];
        expect(place.textContent).toBe("北海道");
        expect(category.textContent).toBe("風景");
        // 分類は muted（撮影地より暗い字）、間は 6px
        expect(category.className).toContain("text-white/50");
        expect(place.className).toContain("text-white/80");
        expect(meta.className).toContain("gap-1.5");
    });

    it("片方だけでも出し、両方無ければ何も出さない", () => {
        const metaOf = (el: React.ReactElement) => render(el).container.textContent;
        expect(metaOf(<PhotoTileMeta location="京都" />)).toBe("京都");
        expect(metaOf(<PhotoTileMeta category="夜景" />)).toBe("夜景");
        const { container } = render(<PhotoTileMeta />);
        expect(container.innerHTML).toBe("");
    });
});

// 配線と、/admin のほかの画面の文字（注記は除く）
describe("/admin の画面の文字に中黒が無い", () => {
    const ROOT = join(__dirname, "..", "..", "..");
    const ADMIN = join(ROOT, "app", "admin");
    const codeOf = (abs: string) =>
        readFileSync(abs, "utf8")
            .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1")
            .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
    const pages = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const abs = join(dir, name);
            if (statSync(abs).isDirectory()) return name === "__tests__" ? [] : pages(abs);
            return /\.tsx?$/.test(name) ? [abs] : [];
        });

    it("一覧はタイルの一行を部品で出している", () => {
        const page = codeOf(join(ADMIN, "page.tsx"));
        expect(page).toContain("<PhotoTileMeta location={photo.location} category={photo.category} />");
    });

    it.each(pages(ADMIN).map((abs) => relative(ROOT, abs)))("%s", (rel) => {
        expect(codeOf(join(ROOT, rel)), "画面の文字に「·」「・」の区切りが残っている").not.toMatch(/[·・]|\\u00b7|\\u30fb|&middot;/i);
    });
});
