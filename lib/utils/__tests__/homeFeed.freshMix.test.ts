import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/data/photos";
import { recommendedOrder, mixFresh, firstPostPhotoIds, isFresh } from "../homeFeed";

/**
 * おすすめに新しい投稿を混ぜる（`mixFresh`・札 journey.photo-ios#537 案1・2026-11-11）。
 *
 * 🔴 **入力と答えは iOS の `Tests/JourneyPhotoTests/HomeFreshMixTests.swift` と同じ。** 片方だけ決まりを変えると、
 * アプリと Web でおすすめの並びが割れる。変えるときは両方の試験を一緒に直す
 */
const NOW = new Date("2026-11-11T12:00:00.000Z");

const p = (id: string, likes: number, createdAt: string, userId: string, extra: Record<string, unknown> = {}): Photo =>
    ({ id, src: `https://x/${id}.jpg`, likes, createdAt, userId, ...extra }) as unknown as Photo;
const ids = (xs: readonly Photo[]) => xs.map((x) => x.id);

/** 例1（iOS と同じ）: 古い写真がいいね順に並ぶ中に、72 時間以内の投稿が 4 つ */
const caseOne = (): Photo[] => [
    p("A", 5, "2026-01-20T00:00:00.000Z", "u1"),
    p("B", 4, "2026-02-01T00:00:00.000Z", "u1"),
    p("C", 3, "2026-03-01T00:00:00.000Z", "u1"),
    p("D", 2, "2026-04-01T00:00:00.000Z", "u2"),
    p("E", 1, "2026-05-01T00:00:00.000Z", "u2"),
    p("F", 1, "2026-06-01T00:00:00.000Z", "u2"),
    p("G", 1, "2026-07-01T00:00:00.000Z", "u1"),
    p("H", 0, "2026-08-01T00:00:00.000Z", "u1"),
    // 72 時間以内（6・12・36・60 時間前）
    p("N1", 0, "2026-11-11T06:00:00.000Z", "u3"),
    p("N4", 0, "2026-11-11T00:00:00.000Z", "u4"),
    p("N2", 0, "2026-11-10T00:00:00.000Z", "u2"),
    p("N3", 1, "2026-11-09T00:00:00.000Z", "u1"),
    // 73 時間前（新しい投稿ではない）
    p("O", 0, "2026-11-08T11:00:00.000Z", "u2"),
];

describe("mixFresh（iOS の HomeFreshMix と同じ）", () => {
    it("先頭 10 枠の 2・5・8 番目に新しい投稿が入る（N3 は今までの並びで 7 番目なので枠を使わない）", () => {
        expect(ids(recommendedOrder(caseOne(), NOW))).toEqual(["A", "N1", "B", "C", "N4", "D", "N3", "N2", "G", "F", "E", "O", "H"]);
    });

    it("混ぜる前は、いいね 0 の新しい投稿が 9 番目より後ろに沈んでいた", () => {
        const before = [...caseOne()].sort((a, b) => ((b.likes ?? 0) - (a.likes ?? 0)) || String(b.createdAt).localeCompare(String(a.createdAt)));
        expect(ids(before)).toEqual(["A", "B", "C", "D", "N3", "G", "F", "E", "N1", "N4", "N2", "O", "H"]);
    });

    it("例2: 選ばれた写真は先頭のまま。同じ投稿の 2 枚は 1 つの枠", () => {
        const photos = [
            p("Q", 2, "2026-03-01T00:00:00.000Z", "u1"),
            p("X", 0, "2026-01-01T00:00:00.000Z", "u2", { featured: true }),
            p("R", 1, "2026-04-01T00:00:00.000Z", "u1"),
            p("S", 0, "2026-05-01T00:00:00.000Z", "u2"),
            p("p1", 0, "2026-11-11T10:00:00.000Z", "u5", { groupId: "g" }),
            p("p2", 0, "2026-11-11T10:00:01.000Z", "u5", { groupId: "g" }),
        ];
        expect(ids(recommendedOrder(photos, NOW))).toEqual(["X", "p2", "p1", "Q", "R", "S"]);
    });

    it("日付だけの createdAt は新しい投稿にしない。新しい投稿が無ければ並びは今までどおり", () => {
        const photos = [
            p("A", 3, "2026-01-01T00:00:00.000Z", "u1"),
            p("B", 2, "2026-02-01T00:00:00.000Z", "u1"),
            p("today", 0, "2026-11-11", "u2"),
        ];
        expect(isFresh(photos[2], NOW)).toBe(false);
        expect(ids(recommendedOrder(photos, NOW))).toEqual(["A", "B", "today"]);
        expect(ids(mixFresh(photos, NOW))).toEqual(ids(photos));
    });

    it("はじめての投稿: 持ち主のいちばん古い公開の投稿が 72 時間以内なら、その投稿の写真全部", () => {
        const photos = [
            ...caseOne(),
            p("p1", 0, "2026-11-11T10:00:00.000Z", "u5", { groupId: "g" }),
            p("p2", 0, "2026-11-11T10:00:01.000Z", "u5", { groupId: "g" }),
        ];
        expect([...firstPostPhotoIds(photos, NOW)].sort()).toEqual(["N1", "N4", "p1", "p2"]);
        expect(firstPostPhotoIds(photos, new Date(NOW.getTime() + 72 * 3600 * 1000)).size).toBe(0);
    });

    it("はじめての投稿: 持ち主に createdAt の読めない写真が 1 枚でもあれば印を付けない（安全側・iOS と同じ）", () => {
        const photos = [
            p("new", 0, "2026-11-11T06:00:00.000Z", "u9"),
            p("undated", 0, "2026-11-11", "u9"),
            p("other", 0, "2026-11-11T07:00:00.000Z", "u8"),
        ];
        expect([...firstPostPhotoIds(photos, NOW)]).toEqual(["other"]);
    });
});
