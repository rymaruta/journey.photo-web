import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { LOCATION_FIXES } from "../fixes";

const mockReplace = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ value: { isAuthenticated: true, loading: false } }));
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../../auth/context", () => ({ useAuth: () => mockAuth.value }));
vi.mock("../../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../../lib/utils/api")>()),
    userFetch: mockFetch,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
    mockFetch.mockReset();
    mockReplace.mockReset();
    mockAuth.value = { isAuthenticated: true, loading: false };
});

describe("撮影地の一括修正の頁", () => {
    it("ログインしていなければログインへ送る", async () => {
        mockAuth.value = { isAuthenticated: false, loading: false };
        const Page = (await import("../page")).default;
        render(<Page />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("login");
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("枚数を前置きし、押すと現在値と違う行だけ { location } で送る", async () => {
        const [a, b] = LOCATION_FIXES;
        mockFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
            if (path === "/user/photos") return json([{ id: a.id, location: a.location }, { id: b.id, location: "山中湖" }]);
            return json({ success: true });
        });
        const Page = (await import("../page")).default;
        render(<Page />);
        // 自分の写真に無い 23 枚は対象外、a は済み、b だけ未反映
        const button = await screen.findByRole("button", { name: "1 枚の撮影地を反映する" });
        fireEvent.click(button);
        fireEvent.click(button);
        await waitFor(() => expect(screen.getByText("反映するものはありません")).toBeTruthy());
        const puts = mockFetch.mock.calls.filter((c) => c[1]?.method === "PUT");
        expect(puts).toHaveLength(1);
        expect(puts[0][0]).toBe(`/photos/${b.id}`);
        expect(JSON.parse(puts[0][1].body)).toEqual({ location: b.location });
    });
});
