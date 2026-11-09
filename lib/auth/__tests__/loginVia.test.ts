import { describe, it, expect } from "vitest";
import { LOGIN_VIAS, parseLoginVia, loginReason, LOGIN_REASON_GENERIC_JA } from "../loginVia";
import { loginWithNext } from "../../routes";

// 2026-11-09: ログイン画面の「理由と得られるもの」。`via` は URL から来る＝許可リストだけを画面の文に変える
describe("loginVia（許可リスト）", () => {
    it("許可した値だけ通す", () => {
        for (const v of LOGIN_VIAS) expect(parseLoginVia(v)).toBe(v);
        for (const bad of ["", "evil", "WISH", "wish ", "<script>", "__proto__", "constructor", null, undefined]) {
            expect(parseLoginVia(bad as string | null | undefined), String(bad)).toBeNull();
        }
    });

    it("via ごとに専用の1〜2行がある（汎用とは別の文）", () => {
        const seen = new Set<string>();
        for (const v of LOGIN_VIAS) {
            const t = loginReason(v);
            expect(t, v).not.toBe(LOGIN_REASON_GENERIC_JA);
            expect(t, v).toContain("ログイン");
            seen.add(t);
        }
        expect(seen.size, "文が重なっている").toBe(LOGIN_VIAS.length);
        expect(loginReason("wish")).toBe("行きたい場所の保存にはログインが必要です。ログインすると、あとで見返せます。");
        // 長いと320pxで3行を超え、下の「アカウントを作る」が画面の外へ押し出される
        for (const v of LOGIN_VIAS) expect(loginReason(v).length, v).toBeLessThanOrEqual(42);
        expect(LOGIN_VIAS, "使い手の無い via を許可していない").not.toContain("theme");
    });

    it("無い・許可外の via は汎用の1行（URL の文字列を画面に流さない）", () => {
        expect(loginReason(null)).toBe("ログインすると、いいね・コメント・投稿ができます。");
        const evil = "<img src=x onerror=alert(1)>";
        expect(loginReason(evil)).toBe(LOGIN_REASON_GENERIC_JA);
        expect(loginReason(evil)).not.toContain("img");
    });

    it("loginWithNext は許可リストの via だけ付ける（next も引き継ぐ）", () => {
        expect(loginWithNext("/photo/p1", "like")).toBe("/login?next=%2Fphoto%2Fp1&via=like");
        expect(loginWithNext(null, "follow")).toBe("/login?via=follow");
        expect(loginWithNext("/photo/p1", "wish")).toBe("/login?next=%2Fphoto%2Fp1&via=wish");
        // 型を破って任意の文字列を渡しても付けない
        expect(loginWithNext("/photo/p1", "evil" as never)).toBe("/login?next=%2Fphoto%2Fp1");
    });
});
