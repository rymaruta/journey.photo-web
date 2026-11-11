import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * **お知らせのベルは最初の JS に入れない**（2026-11-11 札 journey.photo-ios#527）。
 * 描くのはログイン中だけなのに、静的に import すると全員の最初の JS に入る（検索から来る人の大半は未ログイン）。
 * `next/dynamic` で読み、静的な import に戻ったら落とす
 */
describe("HeaderNav のベル", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/components/HeaderNav.tsx"), "utf8");
    it("NotificationsBell を静的に import しない（dynamic で読む）", () => {
        expect(src).not.toMatch(/^import\s+NotificationsBell\b/m);
        expect(src).not.toMatch(/from\s+["']\.\/NotificationsBell["']/);
        expect(src).toMatch(/dynamic\(\(\)\s*=>\s*import\(["']\.\/NotificationsBell["']\)/);
    });
    it("描くのはログイン中だけ", () => {
        expect(src).toContain("{isAuthenticated && <NotificationsBell />}");
    });
});
