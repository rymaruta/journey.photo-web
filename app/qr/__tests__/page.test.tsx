import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// プロフィールの QR の着地点（`/qr?t=<合図>`・札 journey.photo-ios#545）。
//   - 使える合図ならその人の頁へ送る（ログイン不要）
//   - 使えなければ1つの言葉と「みんなの写真を見る」
//   - 口がまだ無い 404（API Gateway の `{ message }`）・圏外は「使えません」と言わない

const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ t: "a".repeat(32) }));

vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(q.t ? `t=${q.t}` : ""),
    useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
}));
vi.mock("../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
}));
vi.mock("next/link", () => ({
    default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a>,
}));

const QrPage = (await import("../page")).default;
const { NETWORK_UNREACHABLE_MESSAGE } = await import("../../../lib/utils/api");

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
    q.t = "a".repeat(32);
    mockReplace.mockReset();
    mockUserPublicFetch.mockReset();
});

describe("/qr", () => {
    it("使える合図なら、その人の頁へ送る", async () => {
        mockUserPublicFetch.mockResolvedValue(res(200, { userId: "u-123" }));
        render(<QrPage />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/users?id=u-123"));
        expect(mockUserPublicFetch).toHaveBeenCalledWith(`/qr/${"a".repeat(32)}`);
    });

    it("使えない合図（うちの口の 404）なら、言葉と主ボタン「みんなの写真を見る」", async () => {
        mockUserPublicFetch.mockResolvedValue(res(404, { error: "この QR コードは使えません" }));
        render(<QrPage />);
        expect(await screen.findByRole("heading", { name: "この QR コードは使えません" })).toBeInTheDocument();
        expect(screen.getByText("相手に新しい QR コードを出してもらってください")).toBeInTheDocument();
        const home = screen.getByRole("link", { name: "みんなの写真を見る" });
        expect(home).toHaveAttribute("href", "/");
        expect(home.className).toMatch(/bg-accent-fill/);
        expect(home.className).toMatch(/text-ink/);
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it.each(["", "short", "a".repeat(31) + "="])("形の悪い合図（%s）は口を叩かずに「使えません」", async (t) => {
        q.t = t;
        render(<QrPage />);
        expect(await screen.findByRole("heading", { name: "この QR コードは使えません" })).toBeInTheDocument();
        expect(mockUserPublicFetch).not.toHaveBeenCalled();
    });

    it("口がまだ無い 404（API Gateway の { message }）は「使えません」と言わず、もう一度を出す", async () => {
        mockUserPublicFetch.mockResolvedValue(res(404, { message: "Not Found" }));
        render(<QrPage />);
        expect(await screen.findByRole("alert")).toHaveTextContent("QR コードを確かめられませんでした");
        expect(screen.queryByText("この QR コードは使えません")).toBeNull();
    });

    it("圏外は圏外の言葉で、もう一度で読み直す", async () => {
        mockUserPublicFetch.mockRejectedValueOnce(new Error(NETWORK_UNREACHABLE_MESSAGE));
        mockUserPublicFetch.mockResolvedValueOnce(res(200, { userId: "u-9" }));
        render(<QrPage />);
        expect(await screen.findByRole("alert")).toHaveTextContent(NETWORK_UNREACHABLE_MESSAGE);
        await userEvent.click(screen.getByRole("button", { name: "もう一度" }));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/users?id=u-9"));
    });

    it("開いたらすぐ合図を URL から外し（GA4・履歴に残さない）、外したあとも合図で引く", async () => {
        window.history.replaceState(null, "", `/qr?t=${"a".repeat(32)}`);
        mockUserPublicFetch.mockResolvedValue(res(200, { userId: "u-1" }));
        render(<QrPage />);
        expect(window.location.search).toBe("");
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/users?id=u-1"));
        expect(mockUserPublicFetch).toHaveBeenCalledWith(`/qr/${"a".repeat(32)}`);
        window.history.replaceState(null, "", "/");
    });
});
