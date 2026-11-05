// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ROUTES } from "../../lib/routes";

/**
 * 2026-11-05 owner「WEB版をもっと認知してもらいたい」: 撮影スポット（3,000 件超）と構図ガイドへの入口。
 * 以前はヘッダーのメニューに撮影スポットが無く、構図ガイドはどこからも直接は行けなかった。
 */
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { navigation: {}, category: { all: "すべて", names: {} }, site: { title: "作品紹介", subtitle: "旅の一言" } } }),
}));
vi.mock("next/navigation", () => ({
    usePathname: () => "/",
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

describe("入口のリンク", () => {
    it("フッターに、構図ガイドと撮影スポットの切り口（季節4つ・海外・一覧）がリンクとして出る", async () => {
        const Footer = (await import("../components/Footer")).default;
        const { container } = render(<Footer />);
        const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
        expect(hrefs).toContain(ROUTES.COMPOSITION);
        expect(hrefs).toContain(ROUTES.SPOTS);
        for (const season of ["spring", "summer", "autumn", "winter"]) {
            expect(hrefs, season).toContain(ROUTES.SPOT_SEASON(season));
        }
        expect(hrefs).toContain(ROUTES.SPOT_AREA("overseas"));
        // 撮影スポットの切り口の nav は名前を持つ（無名のランドマークを作らない）
        const nav = container.querySelector('[data-testid="footer-spot-links"]');
        expect(nav?.getAttribute("aria-label")).toBeTruthy();
    });
});
