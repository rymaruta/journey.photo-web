import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tripInviteLine } from "../../../lib/utils/tripInvite";

// 旅行プランへのお誘い（`/t`・2026-11-12）。共同アルバムの招待（`/j`）と同じく:
//   - **見るのはログイン不要**・参加はログイン（戻り先つき）
//   - 断るときは理由をそのまま出す
//   - 参加したら旅行プランの頁へ

const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ current: { isAuthenticated: false, loading: false } as { isAuthenticated: boolean; loading: boolean } }));
const q = vi.hoisted(() => ({ t: "a".repeat(32) }));

vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(q.t ? `t=${q.t}` : ""),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => auth.current }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => (_r as unknown as { _msg?: string })._msg ?? f,
}));
vi.mock("next/link", () => ({
    default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a>,
}));

const Page = (await import("../page")).default;
const trip = { title: "秋の金沢", startDate: "2026-11-23", endDate: "2026-11-24", memberCount: 2, spotCount: 4 };

beforeEach(() => {
    q.t = "a".repeat(32);
    auth.current = { isAuthenticated: false, loading: false };
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ trip }) });
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ joined: true }) });
    mockShowToast.mockReset();
});

describe("旅行プランへのお誘い", () => {
    it("未ログインでも題と「日付 · 人数 · 場所の数」が見え、ログインへ戻り先つきで送る", async () => {
        render(<Page />);
        expect(await screen.findByRole("heading", { name: "秋の金沢" })).toBeInTheDocument();
        expect(screen.getByText("11月23日 〜 24日 · 2人 · 4か所")).toBeInTheDocument();
        expect(mockUserPublicFetch).toHaveBeenCalledWith(`/trip-invites/${"a".repeat(32)}`);
        const login = screen.getByRole("link", { name: "ログインして参加する" });
        expect(login.getAttribute("href")).toBe(`/login?next=${encodeURIComponent(`/t?t=${"a".repeat(32)}`)}`);
    });

    it("ログインしていれば「参加する」1回で参加し、旅行プランの頁へ", async () => {
        auth.current = { isAuthenticated: true, loading: false };
        render(<Page />);
        await userEvent.click(await screen.findByRole("button", { name: "参加する" }));
        expect(mockUserFetch).toHaveBeenCalledWith(`/trip-invites/${"a".repeat(32)}/join`, { method: "POST" });
        expect(await screen.findByRole("link", { name: "旅行プランを開く" })).toHaveAttribute("href", "/trips");
    });

    it("断られたら理由をそのまま出す", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: false, _msg: "この招待リンクは期限が切れています" });
        render(<Page />);
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("この招待リンクは期限が切れています"));
    });

    it("1行の組み立て", () => {
        expect(tripInviteLine({ title: "", memberCount: 1, spotCount: 0 })).toBe("1人");
        expect(tripInviteLine({ title: "", startDate: "2026-11-30", endDate: "2026-12-01", memberCount: 3, spotCount: 2 }))
            .toBe("11月30日 〜 12月1日 · 3人 · 2か所");
    });
});
