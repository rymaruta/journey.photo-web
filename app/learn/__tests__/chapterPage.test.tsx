import "react";
import { describe, expect, it, vi } from "vitest";

// 章の頁の終わりにアプリのご案内の札（2026-11-06）。札は言語を読むので、提供元の代わりに固定する
vi.mock("@/app/i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

import { render, screen, fireEvent } from "@testing-library/react";
import ChapterPage, { generateStaticParams } from "../[slug]/page";
import { CHAPTERS } from "@/lib/data/learn/chapters";

describe("教科書の章の頁", () => {
    it("書き終えた章ぶんの静的な頁を作る", () => {
        expect(generateStaticParams().map((p) => p.slug)).toEqual(CHAPTERS.map((c) => c.slug));
    });

    it("見出し・目次・節・まとめ・練習・クイズ・次へ、が出る（ピントとぼけ）", async () => {
        const { container } = render(await ChapterPage({ params: Promise.resolve({ slug: "focus-and-blur" }) }));
        expect(screen.getByRole("heading", { level: 1 }).className).toContain("font-serif");
        expect(screen.getAllByTestId("learn-section").length).toBeGreaterThanOrEqual(6);
        expect(screen.getAllByTestId("learn-diagram").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByTestId("learn-drill").length).toBeGreaterThanOrEqual(3);
        expect(screen.getByTestId("learn-prevnext")).toBeTruthy();
        expect(container.querySelectorAll("script[type='application/ld+json']").length).toBe(2);
    });

    it("クイズ: 選ぶと正誤と理由が出て、選び終わると点数が出る", async () => {
        render(await ChapterPage({ params: Promise.resolve({ slug: "focus-and-blur" }) }));
        const quiz = screen.getByTestId("learn-quiz");
        const fieldsets = quiz.querySelectorAll("fieldset");
        // 載ったあと（useEffect 後）は、選ぶまで理由が伏せられる
        expect(quiz.querySelectorAll("[data-testid=learn-quiz-why]").length).toBe(0);
        fieldsets.forEach((f) => fireEvent.click(f.querySelector("button")!));
        expect(quiz.querySelectorAll("[data-testid=learn-quiz-why]").length).toBe(fieldsets.length);
        expect(screen.getByRole("status").textContent).toMatch(/問中 \d+ 問正解/);
    });
});

describe("第1章（カメラの使い方 完全入門）も、他の章と同じ部品でそろっている", () => {
    it("図・まとめ・練習・確認クイズ・露出のシミュレーターが出る", async () => {
        const { default: BasicsPage } = await import("../camera-basics/page");
        render(await BasicsPage());
        expect(screen.getAllByTestId("learn-diagram").length).toBeGreaterThanOrEqual(5);
        expect(screen.getAllByTestId("learn-drill").length).toBeGreaterThanOrEqual(3);
        expect(screen.getByTestId("learn-quiz")).toBeTruthy();
        expect(screen.getAllByTestId("learn-lesson").length).toBeGreaterThanOrEqual(10);
    });
});

describe("本文の中の観光スポットへのリンク（2026-11-11・#527）", () => {
    it("章の本文の [文字](/spots/…) はリンクとして出て、印の文字は画面に残らない（動きの章）", async () => {
        const { container } = render(await ChapterPage({ params: Promise.resolve({ slug: "motion" }) }));
        const a = container.querySelector('a[href="/spots/fukuroda-falls"]');
        expect(a?.textContent).toBe("袋田の滝");
        expect(a?.getAttribute("data-testid")).toBe("learn-inline-link");
        expect(screen.getAllByTestId("learn-inline-link").length).toBeGreaterThanOrEqual(3);
        expect(container.textContent).not.toMatch(/\]\(\/spots/);
    });

    it("第1章の本文・撮影の手引きの中のリンクも出る", async () => {
        const { default: BasicsPage } = await import("../camera-basics/page");
        const { container } = render(await BasicsPage());
        expect(container.querySelector('a[href="/spots/snow"]')?.textContent).toBe("雪景色の観光スポット");
        expect(container.querySelector('a[href="/spots/kegon-falls"]')?.textContent).toBe("華厳の滝");
        expect(container.textContent).not.toMatch(/\]\(\/spots/);
    });
});
