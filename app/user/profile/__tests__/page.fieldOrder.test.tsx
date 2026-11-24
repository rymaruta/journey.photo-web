import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// **欄の順と組は iOS の `ProfileEditView` と同じ**（2026-11-04）。
//   基本情報: 表示名 → ユーザー名 → 自己紹介
//   場所とリンク: 居住地 → Instagram → ウェブサイト
//   → テーマカラー → マイBGM
// 以前の Web は ユーザー名 → 表示名 → 自己紹介 → 居住地 → テーマカラー → Instagram → ウェブサイト で、節の見出しが無かった

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

const ProfilePage = (await import("../page")).default;
const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは", homeLocation: "東京" };

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => STORED });
});

/** 文書の順に並べた、見出しと欄の目印 */
function order(container: HTMLElement): string[] {
    const ids = [
        "profile-section-about", "profile-display-name", "profile-username", "profile-bio",
        "profile-section-links", "profile-home-location", "profile-instagram", "profile-website",
        "profile-theme-color",
    ];
    return Array.from(container.querySelectorAll<HTMLElement>("[id]"))
        .map((el) => el.id)
        .filter((id) => ids.includes(id));
}

describe("プロフィールの編集: 欄の順（iOS と同じ）", () => {
    it("基本情報（表示名 → ユーザー名 → 自己紹介）→ 場所とリンク（居住地 → Instagram → ウェブサイト）→ テーマカラー", async () => {
        const { container } = render(<ProfilePage />);
        await screen.findByDisplayValue("こんにちは");
        expect(order(container)).toEqual([
            "profile-section-about", "profile-display-name", "profile-username", "profile-bio",
            "profile-section-links", "profile-home-location", "profile-instagram", "profile-website",
            "profile-theme-color",
        ]);
        expect(screen.getByRole("heading", { level: 2, name: "基本情報" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 2, name: "場所とリンク" })).toBeInTheDocument();
    });

    it("題は iOS と同じ「プロフィールの編集」", async () => {
        render(<ProfilePage />);
        await screen.findByDisplayValue("こんにちは");
        expect(screen.getByRole("heading", { level: 1, name: "プロフィールの編集" })).toBeInTheDocument();
    });
});
