import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../chapters";
import { DIAGRAM_IDS } from "../diagramIds";
import { EXAMPLE_RULES } from "../cameraBasics";
import { LEARN_ARTICLES } from "../articles";

const ruleIds = new Set(EXAMPLE_RULES.map((r) => r.id));
const FORBIDDEN = ["撮りどき", "捨てる", "注目スポット", "撮影地ガイド", "ガイドを見る"];

describe("教科書の章（データの整合）", () => {
    it("章が複数あり、slug と番号が重ならない", () => {
        expect(CHAPTERS.length).toBeGreaterThanOrEqual(10);
        expect(new Set(CHAPTERS.map((c) => c.slug)).size).toBe(CHAPTERS.length);
        expect(new Set(CHAPTERS.map((c) => c.number)).size).toBe(CHAPTERS.length);
        // 既存の3頁（入門 1・構図 6・メーカー 11）の番号を取らない
        for (const n of [1, 6, 11]) expect(CHAPTERS.some((c) => c.number === n)).toBe(false);
    });

    for (const c of CHAPTERS) {
        describe(`${c.number} ${c.slug}`, () => {
            it("必要な部品がそろっている", () => {
                expect(c.title.length).toBeGreaterThan(4);
                expect(c.description.length).toBeGreaterThanOrEqual(50);
                expect(c.description.length).toBeLessThanOrEqual(170);
                expect(c.lead.length).toBeGreaterThan(40);
                expect(c.sections.length).toBeGreaterThanOrEqual(5);
                expect(c.summary.length).toBeGreaterThanOrEqual(3);
                expect(c.drills.length).toBeGreaterThanOrEqual(2);
                expect(c.quiz.length).toBeGreaterThanOrEqual(3);
                expect(c.minutes).toBeGreaterThan(0);
            });

            it("節の id は重ならず、各節に要点と本文がある", () => {
                const ids = c.sections.map((s) => s.id);
                expect(new Set(ids).size).toBe(ids.length);
                for (const s of ids) expect(s).toMatch(/^[a-z0-9-]+$/);
                for (const s of c.sections) {
                    expect(s.point.length, `${s.id} の要点`).toBeGreaterThan(10);
                    expect(s.blocks.length, `${s.id} の本文`).toBeGreaterThanOrEqual(2);
                }
            });

            it("図・実例・表が実在する／形が正しい", () => {
                for (const s of c.sections) {
                    for (const b of s.blocks) {
                        if (b.t === "diagram") expect(DIAGRAM_IDS as readonly string[], `${s.id} の図`).toContain(b.id);
                        if (b.t === "example") expect(ruleIds.has(b.rule), `${s.id} の実例 ${b.rule}`).toBe(true);
                        if (b.t === "table") for (const r of b.rows) expect(r.length, `${s.id} の表 ${r[0]}`).toBe(b.head.length);
                    }
                }
            });

            it("クイズの答えの番号が選択肢の中にあり、理由がある", () => {
                for (const q of c.quiz) {
                    expect(q.choices.length).toBeGreaterThanOrEqual(3);
                    expect(q.answer).toBeGreaterThanOrEqual(0);
                    expect(q.answer).toBeLessThan(q.choices.length);
                    expect(new Set(q.choices).size).toBe(q.choices.length);
                    expect(q.why.length).toBeGreaterThan(10);
                }
            });

            it("次に読む（next）が台帳にある", () => {
                for (const n of c.next) {
                    expect(LEARN_ARTICLES.some((a) => a.id === n || a.href === n), `next ${n}`).toBe(true);
                }
            });

            it("画面で使わない言葉が無く、断定の言葉（必ず・絶対）で言い切っていない", () => {
                const text = JSON.stringify(c);
                for (const w of FORBIDDEN) expect(text.includes(w), w).toBe(false);
                for (const w of ["絶対に", "100%確実", "必ずうまく"]) expect(text.includes(w), w).toBe(false);
            });
        });
    }
});
