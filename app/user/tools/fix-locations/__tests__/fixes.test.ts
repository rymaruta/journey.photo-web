import { describe, it, expect, vi } from "vitest";
import photos from "../../../../data/photos.json";
import { LOCATION_FIXES, initialStatus, applyFixes, type RowStatus, type FetchLike } from "../fixes";

const ids = LOCATION_FIXES.map((f) => f.id);

describe("適用対象（確度 ◎ だけ）", () => {
    it("25枚。id は重ならず、photos.json の題と一致する", () => {
        expect(LOCATION_FIXES).toHaveLength(25);
        expect(new Set(ids).size).toBe(25);
        const rows = photos as { id: string; title: string | { ja?: string } }[];
        for (const f of LOCATION_FIXES) {
            const p = rows.find((r) => r.id === f.id);
            expect(p, f.title).toBeTruthy();
            expect(typeof p!.title === "string" ? p!.title : p!.title.ja).toBe(f.title);
        }
    });
    it("○・変更なしの行は含まない（大トリアノン・パリの街中・ヴェルサイユ宮殿・天空の鳥居・海）", () => {
        for (const t of ["大トリアノン宮殿", "パリの街中", "ヴェルサイユ宮殿", "天空の鳥居", "海"]) {
            expect(LOCATION_FIXES.find((f) => f.title === t)).toBeUndefined();
        }
    });
    it("値は案そのまま。夢洲の括弧は値の一部として残し、注の語は混ざらない", () => {
        const loc = (t: string) => LOCATION_FIXES.find((f) => f.title === t)!.location;
        expect(loc("秋のグラデーション")).toBe("大阪府 大阪市 夢洲（大阪・関西万博 会場）");
        expect(loc("紅白")).toBe("東京都");
        expect(loc("オペラ・ガルニエ")).toBe("フランス パリ オペラ・ガルニエ");
        for (const f of LOCATION_FIXES) {
            expect(f.location).not.toMatch(/変更なし|要確認|owner|確認が要る/);
            expect(f.location).toBe(f.location.trim());
        }
    });
});

describe("initialStatus", () => {
    const fix = LOCATION_FIXES[0];
    it("同じ値なら済み・違えば未反映・自分の写真に無ければ対象外", () => {
        expect(initialStatus(fix, { location: fix.location })).toBe("skipped");
        expect(initialStatus(fix, { location: "山中湖" })).toBe("pending");
        expect(initialStatus(fix, { location: "" })).toBe("pending");
        expect(initialStatus(fix, null)).toBe("foreign");
    });
});

describe("applyFixes", () => {
    const allPending = (): Record<string, RowStatus> => Object.fromEntries(ids.map((i) => [i, "pending" as RowStatus]));

    it("{ location } だけを1枚ずつ順に送る", async () => {
        const calls: { path: string; method: string; body: string }[] = [];
        const put: FetchLike = async (path, init) => { calls.push({ path, ...init }); return { ok: true, status: 200 }; };
        await applyFixes(LOCATION_FIXES, allPending(), put, () => {});
        expect(calls).toHaveLength(25);
        calls.forEach((c, i) => {
            expect(c.method).toBe("PUT");
            expect(c.path).toBe(`/photos/${ids[i]}`);
            expect(Object.keys(JSON.parse(c.body))).toEqual(["location"]);
            expect(JSON.parse(c.body).location).toBe(LOCATION_FIXES[i].location);
        });
    });

    it("済み・対象外の行は送らない", async () => {
        const st = allPending();
        st[ids[0]] = "skipped"; st[ids[1]] = "foreign";
        const put = vi.fn<FetchLike>(async () => ({ ok: true, status: 200 }));
        await applyFixes(LOCATION_FIXES, st, put, () => {});
        expect(put).toHaveBeenCalledTimes(23);
        expect(put.mock.calls.map((c) => c[0])).not.toContain(`/photos/${ids[0]}`);
    });

    it("1枚失敗（応答・例外）しても次へ進み、結果を各行に返す。403 は対象外", async () => {
        const results: Record<string, string> = {};
        const put: FetchLike = async (path) => {
            if (path.endsWith(ids[0])) return { ok: false, status: 500, error: "サーバーエラー" };
            if (path.endsWith(ids[1])) throw new Error("通信できません");
            if (path.endsWith(ids[2])) return { ok: false, status: 403 };
            return { ok: true, status: 200 };
        };
        await applyFixes(LOCATION_FIXES, allPending(), put, (r) => { results[r.id] = r.status; });
        expect(results[ids[0]]).toBe("failed");
        expect(results[ids[1]]).toBe("failed");
        expect(results[ids[2]]).toBe("foreign");
        expect(results[ids[3]]).toBe("done");
        expect(Object.keys(results)).toHaveLength(25);
    });

    it("失敗した行は再実行で送り直し、済みになった行は送らない", async () => {
        const st = allPending();
        ids.slice(1).forEach((i) => { st[i] = "done"; });
        st[ids[0]] = "failed";
        const put = vi.fn<FetchLike>(async () => ({ ok: true, status: 200 }));
        await applyFixes(LOCATION_FIXES, st, put, () => {});
        expect(put).toHaveBeenCalledTimes(1);
    });
});
