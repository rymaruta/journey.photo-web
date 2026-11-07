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
            // フッターの先頭はアプリのご案内の札（2026-11-06）。下の文字リンクだった入口を、目立つ位置へ移した
            ["App Storeで入手", "https://apps.apple.com/jp/app/id6814335283"],
            ["作品", ROUTES.HOME],
            ["撮影地マップ", ROUTES.MAP],
            // 公式撮影地ガイドの索引。**写真の投稿が0枚の場所も載る**面なので、
            // 写真の集約（`/location`）とは別に入口が要る。撮影地マップの隣
            // （どちらも「場所から探す」）
            ["撮影スポット", ROUTES.SPOTS],
            // 写真とカメラの教科書（2026-11-04）。撮影スポットの隣（どちらも「撮りに行く前に読む」）
            ["写真とカメラの教科書", ROUTES.LEARN],
            // 構図ガイド（2026-11-05）。教科書の頁の中からしか行けなかった。教科書の隣（どちらも「読む」）
            ["構図ガイド", ROUTES.COMPOSITION],
            // 今日の日の出・日の入り（2026-11-07）。構図ガイドの隣（どちらも「撮りに行く前に見る」）
            ["今日の日の出・日の入り", ROUTES.TODAY],
            ["いいねした写真", ROUTES.FAVORITES],
            // **いいねの隣に置く。** 別の棚だと分かるのは並んでいるとき
            ["保存した写真", ROUTES.SAVES],
            // **行きたい場所はいいねの隣**（どちらも「自分が取っておいたもの」）。
            // 入口がスポット詳細のボタンしか無いと、押したあとに見に行く場所が無い
            ["行きたい場所", ROUTES.SAVED_SPOTS],
            // 撮影スポットの切り口への入口（2026-11-05・2つ目の nav「撮影スポットをさがす」）。
            // 3,000 件を超える撮影スポットへ、どの頁の下からも1クリックで入れる
            ["紅葉の撮影スポット", ROUTES.SPOT_MOMIJI()],
            ["春の撮影スポット", ROUTES.SPOT_SEASON("spring")],
            ["夏の撮影スポット", ROUTES.SPOT_SEASON("summer")],
            ["秋の撮影スポット", ROUTES.SPOT_SEASON("autumn")],
            ["冬の撮影スポット", ROUTES.SPOT_SEASON("winter")],
            ["海外の撮影スポット", ROUTES.SPOT_AREA("overseas")],
            ["撮影スポットの一覧", ROUTES.SPOTS],
            // 規約は3つ目の縦の組（左端をそろえるため、サイトのリンクと分けた・2026-11-06）
            ["利用規約", ROUTES.TERMS],
            ["プライバシーポリシー", ROUTES.PRIVACY],
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
        const nav = screen.getByRole("navigation", { name: "フッター" });
        expect(nav.querySelectorAll("a").length).toBeGreaterThan(3);
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
        // ナビは3つ（フッター・撮影スポットをさがす・規約）。どれも同じ字の大きさ
        const navs = screen.getAllByRole("navigation");
        expect(navs.map((n) => n.getAttribute("aria-label"))).toEqual(["フッター", "撮影スポットをさがす", "規約"]);
        for (const nav of navs) {
            for (const a of Array.from(nav.querySelectorAll("a"))) {
                expect((a as HTMLElement).style.fontSize, a.textContent!).toBe("13px");
                expect(a.className).not.toMatch(/(^|\s)text-(xs|sm)(\s|$)/);
            }
        }
    });
});

// フッターの整列（2026-11-06 owner「フッターの左揃えなどの整列感大事にして」）。
// 以前は全部が中央揃えで行ごとに左端がばらついていた。いまは左揃えで、リンクの組は縦に積んで左端をそろえる
describe("フッターの整列", () => {
    it("中央揃えにしない: 全体は左揃え、リンクの組は左端そろえの縦並び", () => {
        const { container } = render(<Footer />);
        const root = container.querySelector("footer > div") as HTMLElement;
        expect(root.className).toContain("text-left");
        expect(root.className).not.toMatch(/(^|\s)text-center(\s|$)/);
        // 案内の札のボタンの中の文字は中央でよい（札は別の部品）。それ以外に中央揃えの指定が残っていないこと
        const rest = root.cloneNode(true) as HTMLElement;
        rest.querySelector("[data-testid=app-install-card]")?.remove();
        expect(rest.outerHTML).not.toMatch(/items-center justify-center|text-center/);
        for (const nav of screen.getAllByRole("navigation")) {
            expect(nav.className, nav.getAttribute("aria-label")!).toContain("items-start");
            expect(nav.className).toContain("flex-col");
            for (const a of Array.from(nav.querySelectorAll("a"))) {
                expect(a.className, a.textContent!).toContain("justify-start");
                expect(a.className, a.textContent!).not.toContain("justify-center");
            }
        }
    });

    it("組の見出しは 12px 以上（本文の最小）", () => {
        render(<Footer />);
        for (const name of ["サイト", "撮影スポット", "規約"]) {
            const nav = screen.getByRole("navigation", { name: name === "サイト" ? "フッター" : name === "撮影スポット" ? "撮影スポットをさがす" : "規約" });
            const h = nav.querySelector("p") as HTMLElement;
            expect(h.textContent).toBe(name);
            expect(parseInt(h.style.fontSize, 10)).toBeGreaterThanOrEqual(12);
        }
    });
});
