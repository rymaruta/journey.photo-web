import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LEGAL_CONSENT_VERSION } from "../../lib/utils/legalConsent";

// ブラウザのスモークは、ログインした人の頁を見る前に「同意済み」を書いておく。
// 2026-11-25: 同意の版を 2 に上げたとき、スモークが "1" を書いたままで、同意の画面が全部の頁を覆い、
// 本番のデプロイ（Deploy Site）がスモークで止まった（journey.photo-ios#604）。版は規約の版の定数から読む
describe("スモークの同意の版", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "e2e-smoke.mjs"), "utf8");

    it("版を書き写さず、lib/utils/legalConsent.ts から読む", () => {
        expect(src).toContain('path.resolve(__dirname, "..", "lib", "utils", "legalConsent.ts")');
        expect(src).toMatch(/localStorage\.setItem\("legal\.consent\.version", version\)/);
        expect(src).not.toMatch(/localStorage\.setItem\("legal\.consent\.version", "\d+"\)/);
        expect(src).toContain("stored === LEGAL_CONSENT_VERSION");
    });

    it("読み方の正規表現が、今の定数の書き方に当たる", () => {
        const lib = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "utils", "legalConsent.ts"), "utf8");
        expect(lib.match(/export const LEGAL_CONSENT_VERSION = (\d+);/)?.[1]).toBe(String(LEGAL_CONSENT_VERSION));
    });
});
