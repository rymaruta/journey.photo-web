import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TrackedLink from "../TrackedLink";

// 記事 → スポット・作例・次の記事のリンクの計測（select_content・2026-11-04）。
// content_type だけ送る。item_id（スポットの slug・写真の id）は送らない（owner の判断待ち）
const gtag = vi.fn();
const picks = () => gtag.mock.calls.filter((c) => c[1] === "select_content").map((c) => c[2]);
beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});

describe("TrackedLink", () => {
    it("押したら select_content を1回。href は送らない", async () => {
        render(<TrackedLink contentType="spot" href="/spots/hanauma-bay" onClick={(e) => e.preventDefault()}>スポット</TrackedLink>);
        await userEvent.setup().click(screen.getByRole("link", { name: "スポット" }));
        expect(picks()).toEqual([expect.objectContaining({ content_type: "spot" })]);
        const sent = JSON.stringify(gtag.mock.calls);
        expect(sent).not.toContain("hanauma");
        expect(sent).not.toContain("item_id");
    });

    it("呼び出し側の onClick も呼ぶ", async () => {
        const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
        render(<TrackedLink contentType="article" href="/learn/camera-basics" onClick={onClick}>記事</TrackedLink>);
        await userEvent.setup().click(screen.getByRole("link", { name: "記事" }));
        expect(onClick).toHaveBeenCalledOnce();
        expect(picks()).toEqual([expect.objectContaining({ content_type: "article" })]);
    });

    it("GA4 が無い（広告ブロック）でも押せる", async () => {
        delete (window as unknown as { gtag?: unknown }).gtag;
        const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
        render(<TrackedLink contentType="photo" href="/photo/x" onClick={onClick}>写真</TrackedLink>);
        await userEvent.setup().click(screen.getByRole("link", { name: "写真" }));
        expect(onClick).toHaveBeenCalledOnce();
    });
});
