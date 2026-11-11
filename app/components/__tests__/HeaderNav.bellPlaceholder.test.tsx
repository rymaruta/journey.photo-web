import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * **ベルの読み込み中も 44px の席を取る**（2026-11-11 札 journey.photo-ios#527）。
 * ベルは `next/dynamic` で遅れて届く。席が無いと、届いた瞬間に隣の ☰ が 44px 動く
 */
vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, userId: "u1", loading: false, logout: vi.fn() }),
}));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ labels: { navigation: {} } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
// 読み込みに時間がかかる回を作る（届くまでの間を見る）
const release = vi.hoisted(() => ({ go: () => {} }));
vi.mock("../NotificationsBell", async () => {
    await new Promise<void>((r) => { release.go = r; });
    return { default: () => <button aria-label="通知" style={{ minWidth: 44, minHeight: 44 }} /> };
});

import HeaderNav from "../HeaderNav";

describe("HeaderNav のベルの席", () => {
    it("読み込み中は 44px の席（読み上げない）・届いたらベルに替わる", async () => {
        render(<HeaderNav />);
        const ph = await screen.findByTestId("bell-placeholder");
        expect(ph.style.width).toBe("44px");
        expect(ph.style.height).toBe("44px");
        expect(ph.getAttribute("aria-hidden")).toBe("true");
        // 席は ☰ より前（ベルと同じ位置）
        const nav = screen.getByRole("navigation", { name: "ヘッダー" });
        const menu = screen.getByLabelText("メニューを開く");
        expect(ph.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(nav.contains(ph)).toBe(true);
        release.go();
        await screen.findByRole("button", { name: "通知" });
        expect(screen.queryByTestId("bell-placeholder")).toBeNull();
    });
});
