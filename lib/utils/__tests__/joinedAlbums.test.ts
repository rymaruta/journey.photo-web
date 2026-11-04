import { describe, it, expect, beforeEach } from "vitest";
import {
    forgetJoinedAlbum, inviteTokenFromText, othersOf, readJoinedAlbums, rememberJoinedAlbum,
} from "../joinedAlbums";

beforeEach(() => localStorage.clear());

describe("inviteTokenFromText（iOS InviteLink.token(from:)）", () => {
    it.each([
        ["https://journey-photo.com/j?t=abc123", "abc123"],
        ["  https://journey-photo.com/j?t=abc123&x=1\n", "abc123"],
        ["journey-photo.com/j?t=abc123", "abc123"],
        ["abc123", "abc123"],
        ["  abc123 ", "abc123"],
    ])("%s → %s", (input, token) => expect(inviteTokenFromText(input)).toBe(token));

    it("トークンを持たない URL・空は空（URL 全体を送らない）", () => {
        expect(inviteTokenFromText("https://journey-photo.com/")).toBe("");
        expect(inviteTokenFromText("https://journey-photo.com/j")).toBe("");
        expect(inviteTokenFromText("   ")).toBe("");
        expect(inviteTokenFromText("")).toBe("");
    });
});

describe("参加したアルバムの控え", () => {
    it("覚える・同じアルバムは1行（新しい方を先頭に）", () => {
        rememberJoinedAlbum("u1", { id: "a", title: "A", token: "t1" });
        rememberJoinedAlbum("u1", { id: "b", title: "B", token: "t2" });
        rememberJoinedAlbum("u1", { id: "a", title: "A2", token: "t3" });
        expect(readJoinedAlbums("u1")).toEqual([
            { id: "a", title: "A2", token: "t3" },
            { id: "b", title: "B", token: "t2" },
        ]);
    });

    it("利用者ごとに分かれる。ログインしていなければ何もしない", () => {
        rememberJoinedAlbum("u1", { id: "a", title: "A", token: "t1" });
        expect(readJoinedAlbums("u2")).toEqual([]);
        expect(rememberJoinedAlbum(null, { id: "a", title: "A", token: "t1" })).toBe(false);
        expect(readJoinedAlbums(null)).toEqual([]);
    });

    it("消すのは控えだけ", () => {
        rememberJoinedAlbum("u1", { id: "a", title: "A", token: "t1" });
        rememberJoinedAlbum("u1", { id: "b", title: "B", token: "t2" });
        forgetJoinedAlbum("u1", "a");
        expect(readJoinedAlbums("u1").map((e) => e.id)).toEqual(["b"]);
    });

    it("壊れた値・形の違う行は捨てて落ちない", () => {
        localStorage.setItem("journey:joined-albums:u1", "{oops");
        expect(readJoinedAlbums("u1")).toEqual([]);
        localStorage.setItem("journey:joined-albums:u1", JSON.stringify([null, { id: "a" }, { id: "b", token: "t", title: 3 }, "x"]));
        expect(readJoinedAlbums("u1")).toEqual([{ id: "b", token: "t", title: "" }]);
    });

    it("自分が作ったアルバムとは重ねない", () => {
        expect(othersOf([{ id: "a", title: "", token: "t" }, { id: "b", title: "", token: "t" }], ["a"]).map((e) => e.id)).toEqual(["b"]);
    });
});
