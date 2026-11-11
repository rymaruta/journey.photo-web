import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 設定の「検索エンジンにプロフィールを表示しない」（2026-11-11 owner 承認・journey.photo-ios#526）。
// 既定はオフ（表示する）。入切は `PUT /user/profile` に `{ searchHidden }` だけを送る。失敗したら元に戻す。

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import SearchHiddenSetting from "../SearchHiddenSetting";

const LABEL = "検索エンジンにプロフィールを表示しない";
const profile = (body: Record<string, unknown>, put: { ok: boolean; status?: number } = { ok: true }) =>
    mockUserFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") return { ok: put.ok, status: put.status ?? 200, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
    });

beforeEach(() => { mockUserFetch.mockReset(); });

describe("設定: 検索エンジンにプロフィールを表示しない", () => {
    it("既定（項目が無い）はオフ", async () => {
        profile({ userId: "u1" });
        render(<SearchHiddenSetting locale="ja" />);
        const sw = await screen.findByRole("switch", { name: LABEL });
        expect(sw.getAttribute("aria-checked")).toBe("false");
        expect(sw.style.minHeight).toBe("44px");
    });

    it("押すと searchHidden: true だけを送る", async () => {
        profile({ userId: "u1", searchHidden: false });
        render(<SearchHiddenSetting locale="ja" />);
        const sw = await screen.findByRole("switch", { name: LABEL });
        await userEvent.click(sw);
        const put = mockUserFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
        expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ searchHidden: true });
        expect(sw.getAttribute("aria-checked")).toBe("true");
    });

    it("送れなければ元に戻して知らせる", async () => {
        profile({ userId: "u1", searchHidden: true }, { ok: false, status: 500 });
        render(<SearchHiddenSetting locale="ja" />);
        const sw = await screen.findByRole("switch", { name: LABEL });
        await userEvent.click(sw);
        await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
        expect(await screen.findByRole("alert")).toBeTruthy();
    });

    it("プロフィールが読めなければ行を出さない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { container } = render(<SearchHiddenSetting locale="ja" />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));
        expect(container.innerHTML).toBe("");
    });
});
