import { LEARN_ARTICLES } from "@/lib/data/learn/articles";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

/**
 * **写真とカメラの教科書（/learn）の3頁**（2026-11-04）。描いた形を見る。
 * 写真はコミット済みの `app/data/photos.json`（本番の同期と同じ形）から選ばれる。
 */
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import LearnPage, { metadata as indexMeta } from "../page";
import CameraBasicsPage, { metadata as basicsMeta } from "../camera-basics/page";
import CameraBrandsPage, { metadata as brandsMeta } from "../camera-brands/page";
import ExposureLab from "../camera-basics/ExposureLab";
import { LESSONS } from "@/lib/data/learn/cameraBasics";
import { BRANDS } from "@/lib/data/learn/cameraBrands";

const ldOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent ?? "{}"));
const crumbHrefs = () =>
    within(screen.getByRole("navigation", { name: "パンくずリスト" })).queryAllByRole("link").map((a) => a.getAttribute("href"));

describe("/learn（一覧）", () => {
    it("パンくず・明朝の h1・台帳の全記事のカード（入門→…→構図→…→メーカー の順）・構造化データ", async () => {
        const { container } = render(await LearnPage());
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("写真とカメラの教科書");
        expect(screen.getByRole("heading", { level: 1 }).className).toContain("font-serif");
        expect(crumbHrefs()).toEqual(["/"]);
        const cards = screen.getAllByTestId("learn-card").map((a) => a.getAttribute("href"));
        expect(cards).toEqual(LEARN_ARTICLES.map((a) => a.href));
        // 順は教科書の順: 入門が先頭・構図（6）はメーカー比較（11）より前
        expect(cards[0]).toBe("/learn/camera-basics");
        expect(cards.indexOf("/composition")).toBeLessThan(cards.indexOf("/learn/camera-brands"));
        // カードには本物の写真（コミット済みのデータには F値の小さい写真がある）
        // （happy-dom は画像を読めないので、Thumb は読めなかった形＝名前つきの `role="img"` に替わる）
        expect(screen.getAllByTestId("learn-card")[0].querySelector("img, [role=img]")).not.toBeNull();
        expect(ldOf(container).map((x) => x["@type"])).toEqual(["BreadcrumbList", "CollectionPage"]);
    });

    it("メタデータ: canonical・検索に出す・共有カード", () => {
        expect(String(indexMeta.title)).toBe("写真とカメラの教科書");
        expect(indexMeta.alternates?.canonical).toMatch(/\/learn$/);
        expect((indexMeta.robots as { index: boolean }).index).toBe(true);
        expect(indexMeta.openGraph?.images).toBeTruthy();
    });
});

describe("/learn/camera-basics", () => {
    it("全レッスン・要点・実例（本物の写真の撮影設定）・FAQ・構造化データ", async () => {
        const { container } = render(await CameraBasicsPage());
        expect(screen.getAllByTestId("learn-lesson")).toHaveLength(LESSONS.length);
        expect(screen.getAllByTestId("learn-point")).toHaveLength(LESSONS.length);
        expect(crumbHrefs()).toEqual(["/", "/learn"]);
        // コミット済みのデータには、F2.8 以下・1/1000 秒より速い・ISO 1600 以上の写真がある
        const groups = screen.getAllByTestId("learn-example-group").map((g) => g.querySelector("h3")?.textContent ?? "");
        expect(groups.some((t) => t.includes("F2.8 以下"))).toBe(true);
        expect(groups.some((t) => t.includes("ISO 1600 以上"))).toBe(true);
        const first = screen.getAllByTestId("learn-example")[0];
        expect(first.getAttribute("href")).toMatch(/^\/photo\/|^\/\?photo=/);
        expect(within(first).getByTestId("learn-example-settings").textContent).toMatch(/f\/\d/);
        expect(screen.getByTestId("exposure-lab")).toBeTruthy();
        const ld = ldOf(container);
        expect(ld.map((x) => x["@type"])).toEqual(["BreadcrumbList", "Article"]);
        expect(ld[1].image.length).toBeGreaterThan(0);
        expect(String(basicsMeta.title)).not.toContain("Journey Photo");
    });
});

describe("/learn/camera-brands", () => {
    it("早見表・全メーカー・公式は新しいタブ（読み上げで伝える）・このサイトの機種へのリンク", async () => {
        const { container } = render(await CameraBrandsPage());
        expect(screen.getAllByTestId("learn-brand")).toHaveLength(BRANDS.length);
        const official = screen.getByRole("link", { name: /OM SYSTEM の公式サイト/ });
        expect(official.getAttribute("href")).toBe("https://jp.omsystem.com/");
        expect(official.getAttribute("target")).toBe("_blank");
        expect(official.textContent).toContain("新しいタブで開きます");
        // コミット済みのデータには SONY と Hasselblad の写真がある → 機材の集約頁へ
        const sony = screen.getAllByTestId("learn-brand").find((s) => s.id === "sony")!;
        const camLinks = within(within(sony).getByTestId("learn-brand-cameras")).getAllByRole("link").map((a) => a.getAttribute("href"));
        expect(camLinks.every((h) => h!.startsWith("/camera/"))).toBe(true);
        // 写真の無いメーカーは、その塊を出さない
        const canon = screen.getAllByTestId("learn-brand").find((s) => s.id === "canon")!;
        expect(within(canon).queryByTestId("learn-brand-cameras")).toBeNull();
        expect(ldOf(container).map((x) => x["@type"])).toEqual(["BreadcrumbList", "Article"]);
        expect(String(brandsMeta.title)).not.toContain("Journey Photo");
        // シリーズ名の眉は大文字にしない（α が Α にならない）
        expect(within(sony).getByTestId("learn-brand-series").className).toContain("normal-case");
        // 表はスマホ幅では札、パソコン幅では表（両方を持ち、CSS で片方だけ出す）
        const table = screen.getAllByTestId("learn-table")[0];
        expect(within(table).getByTestId("learn-table-cards").className).toContain("md:hidden");
        expect(within(table).getByTestId("learn-table-grid").className).toContain("hidden md:block");
        expect(within(within(table).getByTestId("learn-table-cards")).getAllByRole("listitem")).toHaveLength(BRANDS.length);
    });
});

describe("ExposureLab", () => {
    it("A モードでは F値を変えても明るさが保たれ、シャッターはカメラが選ぶ（操作できない）", () => {
        render(<ExposureLab />);
        expect(screen.getByTestId("exposure-reading").textContent).toBe("ちょうど良い明るさ");
        expect((screen.getByLabelText(/^シャッター/) as HTMLInputElement).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText(/^F値/), { target: { value: "7" } }); // F16
        expect(screen.getByTestId("exposure-reading").textContent).toBe("ちょうど良い明るさ");
        expect(screen.getByTestId("exposure-summary").textContent).toContain("F16");
    });

    it("A → M に替えると、カメラが選んでいたシャッターから始まる（晴れに替えても明るさが飛ばない）", () => {
        render(<ExposureLab />);
        fireEvent.click(screen.getByRole("radio", { name: /晴れた日の屋外/ }));
        expect(screen.getByTestId("exposure-reading").textContent).toBe("ちょうど良い明るさ");
        fireEvent.click(screen.getByRole("radio", { name: /M（マニュアル）/ }));
        expect(screen.getByTestId("exposure-reading").textContent).toBe("ちょうど良い明るさ");
        expect((screen.getByLabelText(/^シャッター/) as HTMLInputElement).getAttribute("aria-valuetext")).toBe("1/1000秒");
    });

    it("M モードで F値だけ絞ると暗くなり、露出計が振れる", () => {
        render(<ExposureLab />);
        fireEvent.click(screen.getByRole("radio", { name: /M（マニュアル）/ }));
        expect((screen.getByLabelText(/^シャッター/) as HTMLInputElement).disabled).toBe(false);
        fireEvent.change(screen.getByLabelText(/^F値/), { target: { value: "6" } }); // F5.6 → F11（2段絞る）
        expect(screen.getByTestId("exposure-reading").textContent).toBe("2段 暗すぎ");
        fireEvent.change(screen.getByLabelText(/^ISO 感度/), { target: { value: "2" } }); // ISO 400 で戻す
        expect(screen.getByTestId("exposure-reading").textContent).toBe("ちょうど良い明るさ");
    });

    it("ISO 100 ではざらつきを重ねず、上げると重ねる。要約は読み上げられる", () => {
        render(<ExposureLab />);
        expect(screen.queryByTestId("exposure-grain")).toBeNull();
        fireEvent.change(screen.getByLabelText(/^ISO 感度/), { target: { value: "5" } });
        expect(screen.getByTestId("exposure-grain")).toBeTruthy();
        expect(screen.getByTestId("exposure-summary").getAttribute("aria-live")).toBe("polite");
    });
});

// 記事 → スポット・作例・次の記事のクリック（select_content・2026-11-04）。content_type だけ送る
describe("記事内リンクの計測（select_content）", () => {
    const gtag = vi.fn();
    const picks = () => gtag.mock.calls.filter((c) => c[1] === "select_content").map((c) => c[2].content_type);
    const stay = (el: Element) => el.addEventListener("click", (e) => e.preventDefault());
    beforeEach(() => {
        gtag.mockReset();
        sessionStorage.clear();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
    });

    it("一覧: 記事のカード → article、「撮影スポット」→ spot", async () => {
        render(await LearnPage());
        const card = screen.getAllByTestId("learn-card")[0];
        stay(card);
        fireEvent.click(card);
        const spots = screen.getByRole("link", { name: "撮影スポット" });
        stay(spots);
        fireEvent.click(spots);
        expect(picks()).toEqual(["article", "spot"]);
        // 2026-11-06: item_id は href の最後の区切りだけ送る。パス全体（/learn/…・/spots）は送らない
        const ids = gtag.mock.calls.filter((c) => c[1] === "select_content").map((c) => c[2].item_id);
        expect(ids).toEqual(["camera-basics", "spots"]);
        const sent = JSON.stringify(gtag.mock.calls);
        expect(sent).not.toContain("/learn/");
        expect(sent).not.toContain("/spots");
    });

    it("カメラの基本: 作例 → photo、「次に読む」の2本 → article", async () => {
        render(await CameraBasicsPage());
        const example = screen.getAllByTestId("learn-example")[0];
        stay(example);
        fireEvent.click(example);
        for (const name of ["カメラメーカーの特徴を比較する", "構図ガイドで、ガイド線を自分の写真に重ねる"]) {
            const a = screen.getByRole("link", { name });
            stay(a);
            fireEvent.click(a);
        }
        expect(picks()).toEqual(["photo", "article", "article"]);
        expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/\/photo\/|photo=/);
    });
});
