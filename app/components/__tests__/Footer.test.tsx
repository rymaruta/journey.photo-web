import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROUTES } from "@/lib/routes";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const Footer = (await import("../Footer")).default;

describe("フッターの導線", () => {
    it("さがす・まなぶの2つの組と、最後の行の規約（2026-11-10 札 #515・承認の第2版の推奨）", () => {
        render(<Footer />);
        // 名前で見る（札のボタンは電話の幅の字「入手」と PC の字を両方持ち、読み上げの名前は aria-label）
        const links = screen.getAllByRole("link").map((a) => [a.getAttribute("aria-label") ?? a.textContent, a.getAttribute("href")]);
        // 並びごと見る（`toContainEqual` の羅列だと順序の入れ替えが素通りする）
        expect(links).toEqual([
            // フッターの先頭はアプリのご案内の札（本文に札の無い頁だけ・2026-11-06）。11-09 承認の小さい形
            ["App Storeで入手", "https://apps.apple.com/jp/app/id6814335283"],
            // さがす（10本）。2列で読むと対になる: 地図・一覧 → 桜・紅葉 → 雪景色・海外 → 春・夏 → 秋・冬
            ["撮影地マップ", ROUTES.MAP],
            ["観光スポットの一覧", ROUTES.SPOTS],
            ["桜の観光スポット", ROUTES.SPOT_SAKURA()],
            ["紅葉の観光スポット", ROUTES.SPOT_MOMIJI()],
            ["雪景色の観光スポット", ROUTES.SPOT_SNOW()],
            ["海外の観光スポット", ROUTES.SPOT_AREA("overseas")],
            ["春の観光スポット", ROUTES.SPOT_SEASON("spring")],
            ["夏の観光スポット", ROUTES.SPOT_SEASON("summer")],
            ["秋の観光スポット", ROUTES.SPOT_SEASON("autumn")],
            ["冬の観光スポット", ROUTES.SPOT_SEASON("winter")],
            // まなぶ（3本）
            ["写真とカメラの教科書", ROUTES.LEARN],
            ["構図ガイド", ROUTES.COMPOSITION],
            ["今日の日の出・日の入り", ROUTES.TODAY],
            // 最後の1行（© と同じ行）
            ["利用規約", ROUTES.TERMS],
            ["プライバシーポリシー", ROUTES.PRIVACY],
            // 意見箱（2026-11-11 札 #546）。同じ最後の1行に（組を増やさない）
            ["意見を送る", ROUTES.FEEDBACK("footer")],
        ]);
    });

    it("外したリンクを戻さない: 作品・サイトの組の観光スポット（/spots の重複）・いいね・保存・行きたい場所", () => {
        render(<Footer />);
        const anchors = screen.getAllByRole("link");
        const hrefs = anchors.map((a) => a.getAttribute("href"));
        const texts = anchors.map((a) => a.textContent);
        // 作品はロゴ（ヘッダー）とホームのタブと同じ行き先
        expect(hrefs, "作品（/）が残っている").not.toContain(ROUTES.HOME);
        expect(texts).not.toContain("作品");
        // /spots は「撮影スポットの一覧」の1本だけ
        expect(hrefs.filter((h) => h === ROUTES.SPOTS), "/spots が重複している").toHaveLength(1);
        expect(texts).not.toContain("観光スポット");
        // 自分専用の頁（巡回を断っている・☰ のログイン中の組にある）
        for (const h of [ROUTES.FAVORITES, ROUTES.SAVES, ROUTES.SAVED_SPOTS]) expect(hrefs, h).not.toContain(h);
    });
});

// 押す的は高さ44px・字は 13px（2026-10-30。2026-11-10 の2列でも同じ・束 0a・比較の板 C15。iOS の minTapTarget 44・footnote 13）。
// 以前は 24px（WCAG 2.5.8 の下限）で、字は電話の幅で 10.5px に縮んでいた
describe("フッターのリンクの押す的と字", () => {
    it("全部のリンクが最低 44px の高さを持つ", () => {
        render(<Footer />);
        const links = screen.getAllByRole("link");
        expect(links.length).toBeGreaterThan(3);
        for (const a of links) expect(a.className.split(/\s+/), a.textContent!).toEqual(expect.arrayContaining(["inline-flex", "min-h-[44px]"]));
        // 行の間隔は的の高さで取る（行の隙間を足すと、的どうしの間が空きすぎる・フッターが伸びる）
        for (const name of ["さがす", "まなぶ"]) {
            const nav = screen.getByRole("navigation", { name });
            expect(nav.querySelectorAll("a").length).toBeGreaterThan(2);
            expect(nav.outerHTML, `${name}: 行の隙間を重ねて足している`).not.toMatch(/(\s|")gap-y-|(\s|")gap-[0-9]/);
        }
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
        // ナビは3つ（さがす・まなぶ・規約）。どれも同じ字の大きさ
        const navs = screen.getAllByRole("navigation");
        expect(navs.map((n) => n.getAttribute("aria-label"))).toEqual(["さがす", "まなぶ", "規約"]);
        for (const nav of navs) {
            for (const a of Array.from(nav.querySelectorAll("a"))) {
                expect((a as HTMLElement).style.fontSize, a.textContent!).toBe("13px");
                expect(a.className).not.toMatch(/(^|\s)text-(xs|sm)(\s|$)/);
            }
        }
    });
});

// フッターの整列（2026-11-06 owner「フッターの左揃えなどの整列感大事にして」）。
// 左揃え。2026-11-10 からは組の中が2列（電話でも開け閉めなし）で、列の左端は組をまたいで縦にそろう
describe("フッターの整列", () => {
    it("中央揃えにしない: 全体は左揃え、組の中は左端そろえ", () => {
        const { container } = render(<Footer />);
        const root = container.querySelector("footer > div") as HTMLElement;
        expect(root.className).toContain("text-left");
        expect(root.className).not.toMatch(/(^|\s)text-center(\s|$)/);
        // 案内の札のボタンの中の文字は中央でよい（札は別の部品）。それ以外に中央揃えの指定が残っていないこと
        const rest = root.cloneNode(true) as HTMLElement;
        rest.querySelector("[data-testid=app-install-card]")?.remove();
        expect(rest.outerHTML).not.toMatch(/items-center justify-center|text-center|justify-items-center/);
        for (const nav of screen.getAllByRole("navigation")) {
            for (const a of Array.from(nav.querySelectorAll("a"))) {
                expect(a.className, a.textContent!).toContain("justify-start");
                expect(a.className, a.textContent!).not.toContain("justify-center");
            }
        }
    });

    it("さがす・まなぶは電話の幅でも2列（開け閉めなし）。列の幅と隙間は2つの組で同じ（左端が縦にそろう）", () => {
        render(<Footer />);
        const grids = ["さがす", "まなぶ"].map((name) => {
            const nav = screen.getByRole("navigation", { name });
            // 開け閉めの部品を使わない（中身は最初から全部見えている）
            expect(nav.querySelector("details, summary, [aria-expanded]"), name).toBeNull();
            const grid = nav.querySelector("a")!.parentElement as HTMLElement;
            const cls = grid.className.split(/\s+/);
            // 接頭辞の無い grid-cols-2 ＝ 電話の幅から2列
            expect(cls, name).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "justify-items-start"]));
            return cls.filter((c) => /^(grid-cols-2|gap-x-\S+)$/.test(c)).sort().join(" ");
        });
        expect(grids[0]).toBe(grids[1]);
        // PC はまなぶを1列（さがすの2列の右）
        const learnGrid = screen.getByRole("navigation", { name: "まなぶ" }).querySelector("a")!.parentElement as HTMLElement;
        expect(learnGrid.className).toContain("md:grid-cols-1");
    });

    it("2列で1本だけ余る最後のリンク（今日の日の出・日の入り）は2列ぶんの幅（320px で「り」だけ折れていた）", () => {
        render(<Footer />);
        const last = screen.getByRole("link", { name: "今日の日の出・日の入り" });
        expect(last.className.split(/\s+/)).toEqual(expect.arrayContaining(["col-span-2", "md:col-span-1"]));
        // 対になっている行のリンクは1列のまま
        expect(screen.getByRole("link", { name: "構図ガイド" }).className).not.toContain("col-span-2");
    });

    it("組の見出しは 12px 以上（本文の最小）", () => {
        render(<Footer />);
        for (const name of ["さがす", "まなぶ"]) {
            const nav = screen.getByRole("navigation", { name });
            const h = nav.querySelector("p") as HTMLElement;
            expect(h.textContent).toBe(name);
            expect(parseInt(h.style.fontSize, 10)).toBeGreaterThanOrEqual(12);
        }
    });

    it("規約と © は最後の1行（見出しの付いた組にしない）", () => {
        const { container } = render(<Footer />);
        const legal = screen.getByRole("navigation", { name: "規約" });
        expect(legal.querySelector("p"), "規約に見出しが付いている").toBeNull();
        const row = legal.parentElement as HTMLElement;
        expect(row.textContent).toContain("© Journey Photo");
        expect(row.className).toContain("flex-wrap");
        // フッターの中身の最後の行
        expect(container.querySelector("footer > div")!.lastElementChild).toBe(row);
    });
});
