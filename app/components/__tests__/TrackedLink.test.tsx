import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TrackedLink, { itemIdFromHref } from "../TrackedLink";

// 記事 → スポット・作例・次の記事のリンクの計測（select_content・2026-11-04）。
// content_type と item_id（href の最後の区切り）を送る（2026-11-06 owner「どちらでも」→ 推奨）。
// href 全体・クエリ・ハッシュは送らない
const gtag = vi.fn();
const picks = () => gtag.mock.calls.filter((c) => c[1] === "select_content").map((c) => c[2]);
beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});

describe("TrackedLink", () => {
    it("押したら select_content を1回。item_id は href の最後の区切りだけ（href 全体は送らない）", async () => {
        render(<TrackedLink contentType="spot" href="/spots/hanauma-bay" onClick={(e) => e.preventDefault()}>スポット</TrackedLink>);
        await userEvent.setup().click(screen.getByRole("link", { name: "スポット" }));
        expect(picks()).toEqual([expect.objectContaining({ content_type: "spot", item_id: "hanauma-bay" })]);
        expect(JSON.stringify(gtag.mock.calls)).not.toContain("/spots/");
    });

    it("item_id: クエリ・ハッシュ・末尾の / を落とす。/ だけは home、文字列でなければ other", () => {
        expect(itemIdFromHref("/learn/focus-and-blur")).toBe("focus-and-blur");
        expect(itemIdFromHref("/learn/focus-and-blur/?a=1#x")).toBe("focus-and-blur");
        expect(itemIdFromHref("/photo/abc123")).toBe("abc123");
        expect(itemIdFromHref("/")).toBe("home");
        expect(itemIdFromHref({ pathname: "/x" })).toBe("other");
    });

    it("形が外れる href（日本語など）は、そのイベントを送らない", async () => {
        render(<TrackedLink contentType="spot" href="/spots/花火" onClick={(e) => e.preventDefault()}>x</TrackedLink>);
        await userEvent.setup().click(screen.getByRole("link", { name: "x" }));
        expect(picks()).toEqual([]);
    });

    it("呼び出し側の onClick も呼ぶ", async () => {
        const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
        render(<TrackedLink contentType="article" href="/learn/camera-basics" onClick={onClick}>記事</TrackedLink>);
        await userEvent.setup().click(screen.getByRole("link", { name: "記事" }));
        expect(onClick).toHaveBeenCalledOnce();
        expect(picks()).toEqual([expect.objectContaining({ content_type: "article", item_id: "camera-basics" })]);
    });

    it("GA4 が無い（広告ブロック）でも押せる", async () => {
        delete (window as unknown as { gtag?: unknown }).gtag;
        const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
        render(<TrackedLink contentType="photo" href="/photo/x" onClick={onClick}>写真</TrackedLink>);
        await userEvent.setup().click(screen.getByRole("link", { name: "写真" }));
        expect(onClick).toHaveBeenCalledOnce();
    });
});
