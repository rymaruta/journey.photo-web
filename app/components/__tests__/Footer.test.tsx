import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROUTES } from "@/lib/routes";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const Footer = (await import("../Footer")).default;

describe("フッターの導線", () => {
    it("撮影地マップへのリンクを出す（メニューの中にしか無かった）", () => {
        render(<Footer />);
        const links = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
        // 並びごと見る（`toContainEqual` の羅列だと順序の入れ替えが素通りする）
        expect(links).toEqual([
            ["作品", ROUTES.HOME],
            ["撮影地マップ", ROUTES.MAP],
            // 公式撮影地ガイドの索引。**写真の投稿が0枚の場所も載る**面なので、
            // 写真の集約（`/location`）とは別に入口が要る。撮影地マップの隣
            // （どちらも「場所から探す」）
            ["撮影スポット", ROUTES.SPOTS],
            // 写真とカメラの教科書（2026-11-04）。撮影スポットの隣（どちらも「撮りに行く前に読む」）
            ["写真とカメラの教科書", ROUTES.LEARN],
            ["いいねした写真", ROUTES.FAVORITES],
            // **いいねの隣に置く。** 別の棚だと分かるのは並んでいるとき
            ["保存した写真", ROUTES.SAVES],
            // **行きたい場所はいいねの隣**（どちらも「自分が取っておいたもの」）。
            // 入口がスポット詳細のボタンしか無いと、押したあとに見に行く場所が無い
            ["行きたい場所", ROUTES.SAVED_SPOTS],
            ["利用規約", ROUTES.TERMS],
            ["プライバシーポリシー", ROUTES.PRIVACY],
            ["iOSアプリをApp Storeで入手", "https://apps.apple.com/jp/app/id6814335283"],
        ]);
    });
});

// 押す的は高さ44px・字は 13px（2026-10-30・束 0a・比較の板 C15。iOS の minTapTarget 44・footnote 13）。
// 以前は 24px（WCAG 2.5.8 の下限）で、字は電話の幅で 10.5px に縮んでいた
describe("フッターのリンクの押す的と字", () => {
    it("全部のリンクが最低 44px の高さを持つ", () => {
        render(<Footer />);
        const links = screen.getAllByRole("link");
        expect(links.length).toBeGreaterThan(3);
        for (const a of links) expect(a.className.split(/\s+/), a.textContent!).toEqual(expect.arrayContaining(["inline-flex", "min-h-[44px]"]));
        // 行の間隔は的の高さで取る（行の隙間を足すと、的どうしの間が空きすぎる・フッターが伸びる）
        const nav = links[0].parentElement!;
        expect(nav.className, "行の隙間を重ねて足している").not.toMatch(/(^|\s)gap-y-/);
    });

    it("フッターのリンクはキーボード操作時にフォーカスが見える", () => {
        render(<Footer />);
        for (const link of screen.getAllByRole("link")) {
            expect(link.className, link.textContent!).toContain("focus-visible:outline-2");
            expect(link.className, link.textContent!).toContain("focus-visible:outline-accent");
        }
    });

    it("ナビのリンクの字は px で 13（rem の段に頼らない）", () => {
        render(<Footer />);
        const nav = screen.getByRole("navigation");
        for (const a of Array.from(nav.querySelectorAll("a"))) {
            expect((a as HTMLElement).style.fontSize, a.textContent!).toBe("13px");
            expect(a.className).not.toMatch(/(^|\s)text-(xs|sm)(\s|$)/);
        }
    });
});

// App Store への入口の計測（2026-11-04）。placement だけ送る（URL・端末の情報は送らない）。
// Smart App Banner（`app/layout.tsx` の meta）は Safari が描く帯で、押下をページから取れないので対象外
describe("App Store リンクの計測", () => {
    it("下の「App Storeで入手」を押す → app_store_click placement=footer", async () => {
        const gtag = vi.fn();
        sessionStorage.clear();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
        const { default: userEvent } = await import("@testing-library/user-event");
        render(<Footer />);
        const link = screen.getByRole("link", { name: "iOSアプリをApp Storeで入手" });
        link.addEventListener("click", (e) => e.preventDefault());   // 遷移はさせない
        await userEvent.setup().click(link);
        expect(gtag).toHaveBeenCalledWith("event", "app_store_click", expect.objectContaining({ placement: "footer" }));
        expect(gtag.mock.calls.filter((c) => c[1] === "app_store_click")).toHaveLength(1);
        expect(JSON.stringify(gtag.mock.calls)).not.toContain("apple.com");
    });

    it("iOS の案内カードの「App Storeで入手」→ placement=banner", async () => {
        const gtag = vi.fn();
        sessionStorage.clear();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
        const ua = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
        try {
            const { default: userEvent } = await import("@testing-library/user-event");
            render(<Footer />);
            const link = screen.getByRole("link", { name: "App Storeで入手" });
            link.addEventListener("click", (e) => e.preventDefault());
            await userEvent.setup().click(link);
            expect(gtag).toHaveBeenCalledWith("event", "app_store_click", expect.objectContaining({ placement: "banner" }));
        } finally { ua.mockRestore(); }
    });
});
