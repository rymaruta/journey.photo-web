import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const AppInstallCard = (await import("../AppInstallCard")).default;

// アプリのご案内の札（2026-11-06 owner「アプリのインストール推奨は目立つところに置きたい」）。
// ホーム・記事の終わり・フッターの先頭に同じ札を置く。計測は placement だけ（URL・端末の情報は送らない）
const gtag = vi.fn();
const clicks = () => gtag.mock.calls.filter((c) => c[1] === "app_store_click").map((c) => c[2]);
beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});

describe("AppInstallCard", () => {
    it("App Store の頁へのリンクを出し、押すと app_store_click を placement つきで1回", async () => {
        for (const placement of ["home", "article", "banner"] as const) {
            gtag.mockReset();
            const { unmount } = render(<AppInstallCard placement={placement} />);
            const link = screen.getByRole("link", { name: "App Storeで入手" });
            expect(link.getAttribute("href")).toBe("https://apps.apple.com/jp/app/id6814335283");
            link.addEventListener("click", (e) => e.preventDefault());
            await userEvent.setup().click(link);
            expect(clicks()).toEqual([expect.objectContaining({ placement })]);
            expect(JSON.stringify(gtag.mock.calls)).not.toContain("apple.com");
            unmount();
        }
    });

    it("Android には出さない（アプリが無い）。iPhone・Mac・PC には出す", () => {
        const uas: Array<[string, boolean]> = [
            ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", false],
            ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", true],
            ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", true],
            ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", true],
        ];
        for (const [ua, shown] of uas) {
            const spy = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
            try {
                const { unmount } = render(<AppInstallCard placement="home" />);
                expect(screen.queryByTestId("app-install-card") !== null, ua).toBe(shown);
                unmount();
            } finally { spy.mockRestore(); }
        }
    });

    it("このサイトの札の形: 案内の帯の面・白8%の縁・角16・左揃え・押す的は44px・主ボタンは真鍮の塗りに墨の字", () => {
        render(<AppInstallCard placement="home" />);
        const card = screen.getByTestId("app-install-card");
        expect(card.className).toEqual(expect.stringContaining("bg-accent-soft"));
        expect(card.className).toEqual(expect.stringContaining("ring-line"));
        expect(card.className).toEqual(expect.stringContaining("rounded-2xl"));
        expect(card.className).toEqual(expect.stringContaining("text-left"));
        expect(card.className).not.toMatch(/(^|\s)text-center(\s|$)/);
        const link = screen.getByRole("link", { name: "App Storeで入手" });
        const cls = link.className.split(/\s+/);
        expect(cls).toEqual(expect.arrayContaining(["inline-flex", "min-h-[44px]", "bg-accent-fill", "text-ink", "focus-visible:outline-2", "focus-visible:outline-accent"]));
        // 白は真鍮の塗りの上で 2.81:1 で読めない
        expect(cls).not.toContain("text-white");
    });

    it("見出しは明朝、眉ラベルは真鍮、字は 11px 以上（眉だけ 11）", () => {
        render(<AppInstallCard placement="home" />);
        const card = screen.getByTestId("app-install-card");
        const ps = Array.from(card.querySelectorAll("p")) as HTMLElement[];
        expect(ps[0].className).toContain("text-accent");
        expect(parseInt(ps[0].style.fontSize, 10)).toBeGreaterThanOrEqual(11);
        expect(ps[1].className).toContain("font-serif");
        for (const p of ps.slice(1)) expect(parseInt(p.style.fontSize, 10), p.textContent!).toBeGreaterThanOrEqual(12);
    });
});
