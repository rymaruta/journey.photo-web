import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ログイン・新規登録の入力に名前が無かった。`<label>` は置かれているが
// `htmlFor` が無く、input を包んでもおらず、`id` も `aria-label` も無い。
// スクリーンリーダーでは placeholder しか手がかりが無く、
// 「パスワード」と「パスワード（確認）」が**どちらがどちらか判別できない**
// （どちらも `••••••••` / `8文字以上`）。
//
// エラーも `role="alert"` が無く、視覚的に出るだけだった。
// フォーカスは送信ボタンに残るので、何が起きたか分からないまま
// 同じ操作を繰り返すことになる。

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
const mockLogin = vi.hoisted(() => vi.fn());
vi.mock("../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, loading: false, userId: null, login: mockLogin, isAdminUser: false }),
}));
vi.mock("../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const LoginPage = (await import("../login/page")).default;
const SignupPage = (await import("../signup/page")).default;

beforeEach(() => { vi.clearAllMocks(); });

describe("ログイン: 入力に名前がある", () => {
    it("メールとパスワードをラベルで引ける", () => {
        render(<LoginPage />);
        expect(screen.getByLabelText("メールアドレス")).toHaveAttribute("type", "email");
        expect(screen.getByLabelText("パスワード")).toHaveAttribute("type", "password");
    });
});

describe("新規登録: 同じ形の入力が区別できる", () => {
    // 2026-11-24（#432）: 「パスワード（確認）」と「表示名」の欄は外した（iOS と同じ）。残った欄の名前を確かめる
    it("「パスワード」は名前で引け、外した「パスワード（確認）」と「表示名」は無い", () => {
        render(<SignupPage />);
        const pw = screen.getByLabelText("パスワード");
        expect(pw).toHaveAttribute("type", "password");
        expect(pw).toHaveAttribute("id", "signup-password");
        expect(screen.queryByLabelText("パスワード（確認）")).toBeNull();
        expect(screen.queryByLabelText(/表示名/)).toBeNull();
        // 「表示」のボタンは欄の名前を横取りしない（名前は「表示」、欄を操作する）
        const toggle = screen.getByRole("button", { name: "表示" });
        expect(toggle).toHaveAttribute("aria-controls", "signup-password");
    });

    it("メールにも名前がある", () => {
        render(<SignupPage />);
        expect(screen.getByLabelText("メールアドレス")).toHaveAttribute("type", "email");
    });
});

// エラーは視覚的に出るだけだった。フォーカスは送信ボタンに残るので、
// 読み上げでは何が起きたか分からず、同じ操作を繰り返すことになる。
describe("ログイン: 失敗が読み上げられる", () => {
    it("エラーは role=\"alert\" で出す", async () => {
        mockLogin.mockResolvedValue({ success: false, error: "メールアドレスまたはパスワードが違います" });
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "a@b.c" } });
        fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "pw" } });
        fireEvent.click(screen.getByRole("button", { name: /ログイン/ }));

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("メールアドレスまたはパスワードが違います");
    });

    it("失敗していないときは alert を出さない", async () => {
        render(<LoginPage />);
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
});
