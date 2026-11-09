import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ──────────────────────────────────────────────────────────────
// localStorage モック（DBが残らないように各テストでclear）
// ──────────────────────────────────────────────────────────────
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
    };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// ──────────────────────────────────────────────────────────────
// モック定義
// ──────────────────────────────────────────────────────────────
const mockPush = vi.fn();
const mockSignUp = vi.fn();
const mockConfirmSignUp = vi.fn();
const mockResend = vi.fn();
const mockShowToast = vi.fn();

let mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();
/** ログイン済みかどうかを差し替える（object 越しにしないと巻き上げに間に合わない） */
const mockAuthed = { value: false };
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useSearchParams: () => mockSearchParams,
}));

vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: mockAuthed.value, loading: false }),
}));

vi.mock("../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock("../../../lib/auth/cognito", () => ({
    signUp: (...args: unknown[]) => mockSignUp(...args),
    confirmSignUp: (...args: unknown[]) => mockConfirmSignUp(...args),
    resendConfirmationCode: (...args: unknown[]) => mockResend(...args),
}));

// next/link は children をそのままレンダリング
vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) =>
        React.createElement("a", { href }, children),
}));

// SUT
import SignupPage from "../page";

beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockReplace.mockReset();
    mockAuthed.value = false;
    localStorageMock.clear();
    mockPush.mockReset();
    mockSignUp.mockReset();
    mockConfirmSignUp.mockReset();
    mockResend.mockReset();
    mockShowToast.mockReset();
    // URLパラメータをデフォルトに戻す
    window.history.replaceState({}, "", "/signup");
});

// ──────────────────────────────────────────────────────────────
// 登録ステップ
// ──────────────────────────────────────────────────────────────
describe("SignupPage - 登録ステップ", () => {
    it("初期表示は登録フォーム", () => {
        render(<SignupPage />);
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
        expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    });

    it("表示名・メール・パスワード・確認パスワードのフィールドが揃っている", () => {
        render(<SignupPage />);
        expect(screen.getByLabelText("表示名（あとで変えられます）")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
        expect(screen.getByLabelText("パスワード")).toBeInTheDocument();
        expect(screen.getByLabelText("パスワード（確認）")).toBeInTheDocument();
    });

    it("パスワード不一致でエラーを表示し、signUpは呼ばれない", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Different1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        expect(await screen.findByText("パスワードが一致しません")).toBeInTheDocument();
        expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("パスワード8文字未満でエラーを表示する", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Pass1");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Pass1");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        expect(await screen.findByText("パスワードは8文字以上で入力してください")).toBeInTheDocument();
        expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("登録成功 → verify ステップへ遷移し、UUIDをlocalStorageに保存する", async () => {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-1234-5678" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText("you@example.com"), "newuser@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(mockSignUp).toHaveBeenCalledWith("newuser@example.com", "Password1!");
        const saved = localStorageMock.getItem("jp_verify_newuser@example.com");
        expect(saved).toBeTruthy();
        expect(JSON.parse(saved!).username).toBe("uuid-1234-5678");
    });

    // メールアドレスで区切って控える。共有端末で、登録を途中でやめた人の
    // 表示名が次にログインした別人に付くのを防ぐ。
    it("displayName を入力していたらメールアドレス付きのキーに控える", async () => {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-xyz" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByLabelText("表示名（あとで変えられます）"), "テスト太郎");
        await user.type(screen.getByPlaceholderText("you@example.com"), "newuser@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));

        await waitFor(() => {
            expect(localStorageMock.getItem("jp_pending_name_newuser@example.com")).toBe("テスト太郎");
            // 端末で共有される裸のキーには書かない
            expect(localStorageMock.getItem("jp_pending_displayName")).toBeNull();
        });
    });

    it("displayName が空欄なら控えない", async () => {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-xyz" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText("you@example.com"), "newuser@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(localStorageMock.getItem("jp_pending_name_newuser@example.com")).toBeNull();
    });

    it("登録失敗（不明エラー） → エラーメッセージを表示する", async () => {
        mockSignUp.mockResolvedValue({ success: false, error: "予期せぬエラー" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText("you@example.com"), "u@x.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));

        expect(await screen.findByText("予期せぬエラー")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
    });

    it("AliasExistsException + 保存UUIDあり → resendCodeを呼んでverifyへ", async () => {
        // 事前に過去のUUIDをlocalStorageに保存しておく
        localStorageMock.setItem(
            "jp_verify_existing@example.com",
            JSON.stringify({ username: "stored-uuid", t: Date.now() }),
        );
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        mockResend.mockResolvedValue({ success: true });

        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText("you@example.com"), "existing@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(mockResend).toHaveBeenCalledWith("stored-uuid");
        expect(mockShowToast).toHaveBeenCalledWith("確認コードを再送しました", "success");
    });

    async function tryResend(user: ReturnType<typeof userEvent.setup>) {
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        await waitFor(() => expect(mockResend).toHaveBeenCalledWith("stale-uuid"));
    }

    // **もう使えない控えは捨てる。** その UUID が確認済みのアカウントを
    // 指していると再送は毎回失敗し、捨てないと24時間の TTL が切れるまで
    // 同じ行き止まりを繰り返す
    it.each([
        ["確認済み扱い", "NotAuthorizedException"],
        ["居ないユーザー", "UserNotFoundException"],
        ["確認済み（User is already confirmed）", "InvalidParameterException"],
    ])("もう使えない控え（%s）は捨てる", async (_label, code) => {
        localStorageMock.setItem("jp_verify_u@example.com", JSON.stringify({ username: "stale-uuid", t: Date.now() }));
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        mockResend.mockResolvedValue({ success: false, error: "x", code });
        render(<SignupPage />);
        await tryResend(userEvent.setup());
        expect(localStorageMock.getItem("jp_verify_u@example.com"), "効かない控えが残る").toBeNull();
    });

    // **一時的な失敗で捨ててはいけない。** 捨てると確認画面に二度と
    // 戻れない（登録し直しても「すでに登録されています」で終わり、
    // 未確認なのでパスワード再設定も効かない）。元の形（24時間で TTL が
    // 切れて自然回復）より悪い
    it.each([
        ["回数制限", "LimitExceededException"],
        ["通信断など理由の分からない失敗", undefined],
    ])("一時的な失敗（%s）では控えを残す", async (_label, code) => {
        localStorageMock.setItem("jp_verify_u@example.com", JSON.stringify({ username: "stale-uuid", t: Date.now() }));
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        mockResend.mockResolvedValue({ success: false, error: "x", ...(code ? { code } : {}) });
        render(<SignupPage />);
        await tryResend(userEvent.setup());
        expect(localStorageMock.getItem("jp_verify_u@example.com"), "押し直す手がかりを捨てている").not.toBeNull();
    });

    it("AliasExistsException + 保存UUIDなし → エラー表示でverifyに遷移しない", async () => {
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText("you@example.com"), "noidea@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));

        expect(await screen.findByText(/すでに登録されています/)).toBeInTheDocument();
        expect(mockResend).not.toHaveBeenCalled();
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
    });
});

// ──────────────────────────────────────────────────────────────
// 確認コード入力ステップ
// ──────────────────────────────────────────────────────────────
describe("SignupPage - 確認ステップ", () => {
    async function goToVerifyStep(user: ReturnType<typeof userEvent.setup>) {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-1234" });
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
    }

    it("confirmSignUp 成功 → 完了ステップへ + UUIDがlocalStorageから消える", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        mockConfirmSignUp.mockResolvedValue({ success: true });
        await user.type(screen.getByLabelText("確認コード"), "123456");
        await user.click(screen.getByRole("button", { name: /登録を完了する/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "登録完了" })).toBeInTheDocument();
        });
        expect(mockConfirmSignUp).toHaveBeenCalledWith("uuid-1234", "123456", { platform: "web", from: "other" });
        expect(localStorageMock.getItem("jp_verify_u@example.com")).toBeNull();
        // **確認が済んだことをログイン画面に伝える。** `verified=1` を付ける
        // 箇所がリポジトリに1つも無く、あちらのバナーは死んだ画面だった
        // （テストが自前で `verified=1` を作っていたので気づけない）
        expect(screen.getByRole("link", { name: "ログインする" }))
            .toHaveAttribute("href", "/login?verified=1");
    });

    // **戻り先を登録の向こう側まで運ぶ。** 招待リンク（`/j?t=…`）で来た
    // 未登録の人は、ログイン画面の「新規登録」を押した時点で `next` を
    // 落としていた——登録を終えると必ず自分の空プロフィールに着地し、
    // 招待に戻る手段が履歴しか無かった
    it("next があれば、完了後のログインにも引き継ぐ", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fj%3Ft%3Dabc");
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        mockConfirmSignUp.mockResolvedValue({ success: true });
        await user.type(screen.getByLabelText("確認コード"), "123456");
        await user.click(screen.getByRole("button", { name: /登録を完了する/ }));

        await waitFor(() => expect(screen.getByRole("heading", { name: "登録完了" })).toBeInTheDocument());
        expect(screen.getByRole("link", { name: "ログインする" }))
            .toHaveAttribute("href", `/login?verified=1&next=${encodeURIComponent("/j?t=abc")}`);
    });

    // 外へ飛ばす値は捨てる（この画面が踏み台にならないように）
    it("外部のURLを next に入れられても引き継がない", async () => {
        mockSearchParams = new URLSearchParams("next=https%3A%2F%2Fevil.example%2Fx");
        render(<SignupPage />);
        expect(screen.getByRole("link", { name: "ログインに戻る" })).toHaveAttribute("href", "/login");
    });

    // `/login` は `nextPath ?? …` を見るのに、ここだけトップへ流していた
    it("既にログイン済みなら、next があるときはそこへ送る", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fj%3Ft%3Dabc");
        mockAuthed.value = true;
        render(<SignupPage />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/j?t=abc"));
    });

    it("next があれば「すでにアカウントをお持ちの方」のリンクにも付ける", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fj%3Ft%3Dabc");
        render(<SignupPage />);
        expect(screen.getByRole("link", { name: "ログインに戻る" }))
            .toHaveAttribute("href", `/login?next=${encodeURIComponent("/j?t=abc")}`);
    });

    it("確認コードが正しくない → エラーを表示し、ステップは変わらない", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        mockConfirmSignUp.mockResolvedValue({
            success: false,
            error: "確認コードが正しくありません",
        });
        await user.type(screen.getByLabelText("確認コード"), "999999");
        await user.click(screen.getByRole("button", { name: /登録を完了する/ }));

        expect(await screen.findByText("確認コードが正しくありません")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
    });

    it("登録ボタンはコードが6文字未満では無効", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        const submitBtn = screen.getByRole("button", { name: /登録を完了する/ });
        expect(submitBtn).toBeDisabled();
        await user.type(screen.getByLabelText("確認コード"), "12345");
        expect(submitBtn).toBeDisabled();
        await user.type(screen.getByLabelText("確認コード"), "6");
        expect(submitBtn).not.toBeDisabled();
    });

    it("コード再送ボタン → クールダウン中は無効化", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        // 登録直後はクールダウン60秒
        const resendBtn = screen.getByRole("button", { name: /再送（\d+秒後）/ });
        expect(resendBtn).toBeDisabled();
    });
});

// ──────────────────────────────────────────────────────────────
// URLパラメータ復元
// ──────────────────────────────────────────────────────────────
describe("SignupPage - URLパラメータ復元", () => {
    it("?email=... があってlocalStorageに保存UUIDあり → verifyステップで起動", async () => {
        localStorageMock.setItem(
            "jp_verify_resume@example.com",
            JSON.stringify({ username: "resumed-uuid", t: Date.now() }),
        );
        window.history.replaceState({}, "", "/signup?email=resume@example.com");

        await act(async () => { render(<SignupPage />); });

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(screen.getByText(/resume@example\.com に送信した|resume@example\.com に確認コード/)).toBeInTheDocument();
    });

    it("?email=... があってlocalStorageに保存UUIDなし → emailプレフィル + 登録ステップ", async () => {
        window.history.replaceState({}, "", "/signup?email=fresh@example.com");
        await act(async () => { render(<SignupPage />); });

        await waitFor(() => {
            const emailInput = screen.getByPlaceholderText("you@example.com") as HTMLInputElement;
            expect(emailInput.value).toBe("fresh@example.com");
        });
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
    });

    it("保存UUIDの有効期限切れ（24時間以上前）→ verifyステップにはならない", async () => {
        const oldT = Date.now() - 25 * 60 * 60 * 1000; // 25時間前
        localStorageMock.setItem(
            "jp_verify_expired@example.com",
            JSON.stringify({ username: "expired-uuid", t: oldT }),
        );
        window.history.replaceState({}, "", "/signup?email=expired@example.com");
        await act(async () => { render(<SignupPage />); });

        await waitFor(() => {
            const emailInput = screen.getByPlaceholderText("you@example.com") as HTMLInputElement;
            expect(emailInput.value).toBe("expired@example.com");
        });
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
        // 期限切れUUIDは削除されている
        expect(localStorageMock.getItem("jp_verify_expired@example.com")).toBeNull();
    });
});

// ──────────────────────────────────────────────────────────────
// 登録までの数え方（journey.photo-ios#432 の 5・2026-10-31）
// ──────────────────────────────────────────────────────────────
describe("SignupPage - 登録の数え方", () => {
    const gtag = vi.fn();
    beforeEach(() => {
        gtag.mockReset();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
    });

    async function confirm(user: ReturnType<typeof userEvent.setup>, result: object) {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-1234" });
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        await waitFor(() => expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument());
        mockConfirmSignUp.mockResolvedValue(result);
        await user.type(screen.getByLabelText("確認コード"), "123456");
        await user.click(screen.getByRole("button", { name: /登録を完了する/ }));
        await waitFor(() => expect(screen.getByRole("heading", { name: "登録完了" })).toBeInTheDocument());
    }

    it("「行きたい」から来た（via=wish）→ サーバーにも GA4 にも from=wish を渡す", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fspots%2Fhanauma-bay&via=wish");
        const user = userEvent.setup();
        render(<SignupPage />);
        await confirm(user, { success: true });
        expect(mockConfirmSignUp).toHaveBeenCalledWith("uuid-1234", "123456", { platform: "web", from: "wish" });
        expect(gtag).toHaveBeenCalledWith("event", "sign_up", expect.objectContaining({ method: "email", from: "wish" }));
    });

    // next が撮影スポットでも、「行きたい」の印が無ければ other（コメント欄のログインなども同じ next を付ける）
    it("via が無ければ from=other（next だけでは決めない）", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fspots%2Fhanauma-bay");
        const user = userEvent.setup();
        render(<SignupPage />);
        await confirm(user, { success: true });
        expect(gtag).toHaveBeenCalledWith("event", "sign_up", expect.objectContaining({ method: "email", from: "other" }));
    });

    it("もう確認済みだった回は sign_up を送らない（同じ人を二度数えない）", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await confirm(user, { success: true, alreadyConfirmed: true });
        expect(gtag.mock.calls.filter((c) => c[1] === "sign_up")).toEqual([]);
    });

    it("送るのは method と from だけ（メールも uid も入れない）", async () => {
        mockSearchParams = new URLSearchParams("via=wish");
        const user = userEvent.setup();
        render(<SignupPage />);
        await confirm(user, { success: true });
        const sent = JSON.stringify(gtag.mock.calls);
        expect(sent).not.toContain("u@example.com");
        expect(sent).not.toContain("uuid-1234");
    });

    // ログイン画面の「確認コードを入力・再送する」は via を付けずに戻ってくる
    it("控えから確認に戻った回は、控えた from を使う", async () => {
        localStorageMock.setItem(
            "jp_verify_resume@example.com",
            JSON.stringify({ username: "resumed-uuid", t: Date.now(), from: "wish" }),
        );
        window.history.replaceState({}, "", "/signup?email=resume@example.com");
        const user = userEvent.setup();
        await act(async () => { render(<SignupPage />); });
        await waitFor(() => expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument());
        mockConfirmSignUp.mockResolvedValue({ success: true });
        await user.type(screen.getByLabelText("確認コード"), "123456");
        await user.click(screen.getByRole("button", { name: /登録を完了する/ }));
        await waitFor(() => expect(mockConfirmSignUp).toHaveBeenCalledWith("resumed-uuid", "123456", { platform: "web", from: "wish" }));
    });

    it("登録のときに from を控える", async () => {
        mockSearchParams = new URLSearchParams("via=wish");
        const user = userEvent.setup();
        render(<SignupPage />);
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-1234" });
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        await waitFor(() => expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument());
        expect(JSON.parse(localStorageMock.getItem("jp_verify_u@example.com")!).from).toBe("wish");
    });
});

// 2026-11-04: ログインと同じ形（iOS `SignInView` の `.signUp`）
describe("新規登録: iOS の形", () => {
    it("写真の帯の下に直に置き（本文は上から 250）、iOS の一文を出す", () => {
        render(<SignupPage />);
        const content = screen.getByTestId("signup-content");
        expect(content.closest("main")!.className).toMatch(/pt-\[250px\]/);
        expect(screen.getByTestId("login-photo-collage")).toBeInTheDocument();
        expect(screen.getByText("写真から、次の旅が始まる。")).toBeInTheDocument();
    });

    it("欄の順は メールアドレス → パスワード → パスワード（確認）→ 表示名", () => {
        const { container } = render(<SignupPage />);
        const ids = Array.from(container.querySelectorAll("input")).map((i) => i.id);
        expect(ids).toEqual(["signup-email", "signup-password", "signup-password-confirm", "signup-display-name"]);
    });

    it("主ボタンは白の「登録する」、2番手は「ログインに戻る」", () => {
        render(<SignupPage />);
        expect(screen.getByRole("button", { name: "登録する" }).className).toMatch(/\bbg-white\b/);
        expect(screen.getByRole("link", { name: "ログインに戻る" })).toBeInTheDocument();
    });
});

// ──────────────────────────────────────────────────────────────
// 登録の漏斗（2026-11-04）: view_signup → signup_start → signup_error / sign_up
// ──────────────────────────────────────────────────────────────
describe("SignupPage - 登録の漏斗", () => {
    const gtag = vi.fn();
    const sent = (name: string) => gtag.mock.calls.filter((c) => c[1] === name).map((c) => c[2]);
    beforeEach(() => {
        gtag.mockReset();
        sessionStorage.clear();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
    });

    it("画面を見たら view_signup を1回（from を添える）", () => {
        mockSearchParams = new URLSearchParams("via=wish");
        render(<SignupPage />);
        expect(sent("view_signup")).toEqual([expect.objectContaining({ from: "wish" })]);
    });

    it("ログイン済み（すぐ送り返す）なら view_signup は送らない", () => {
        mockAuthed.value = true;
        render(<SignupPage />);
        expect(sent("view_signup")).toEqual([]);
    });

    it("signup_start は初めて欄が変わったときの1回だけ", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        expect(sent("signup_start")).toEqual([]);
        await user.type(screen.getByPlaceholderText("you@example.com"), "ab");
        await user.type(screen.getByLabelText("パスワード"), "x");
        expect(sent("signup_start")).toEqual([expect.objectContaining({ from: "other" })]);
    });

    it("パスワード不一致 → signup_error form/password_mismatch。入力値もエラー文言も送らない", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await user.type(screen.getByPlaceholderText("you@example.com"), "leak@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Different1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        expect(sent("signup_error")).toEqual([expect.objectContaining({ step: "form", reason: "password_mismatch" })]);
        const all = JSON.stringify(gtag.mock.calls);
        expect(all).not.toContain("leak@example.com");
        expect(all).not.toContain("Password1!");
        expect(all).not.toContain("一致しません");
    });

    it("signUp が断られた → Cognito の例外名から理由を分ける", async () => {
        mockSignUp.mockResolvedValue({ success: false, error: "パスワードは…", code: "InvalidPasswordException" });
        const user = userEvent.setup();
        render(<SignupPage />);
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        await waitFor(() => expect(sent("signup_error")).toHaveLength(1));
        expect(sent("signup_error")[0]).toEqual(expect.objectContaining({ step: "form", reason: "password_rule" }));
    });

    it("確認コードが違う → signup_error confirm/code_mismatch", async () => {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-1234" });
        mockConfirmSignUp.mockResolvedValue({ success: false, error: "確認コードが正しくありません", code: "CodeMismatchException" });
        const user = userEvent.setup();
        render(<SignupPage />);
        await user.type(screen.getByPlaceholderText("you@example.com"), "u@example.com");
        await user.type(screen.getByLabelText("パスワード"), "Password1!");
        await user.type(screen.getByLabelText("パスワード（確認）"), "Password1!");
        await user.click(screen.getByRole("button", { name: /^登録する$/ }));
        await waitFor(() => expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument());
        await user.type(screen.getByLabelText("確認コード"), "000000");
        await user.click(screen.getByRole("button", { name: /登録を完了する/ }));
        await waitFor(() => expect(sent("signup_error")).toHaveLength(1));
        expect(sent("signup_error")[0]).toEqual(expect.objectContaining({ step: "confirm", reason: "code_mismatch" }));
        expect(sent("sign_up")).toEqual([]);
    });

    it("最初に着地した頁の種類が、漏斗のイベントに付く", async () => {
        sessionStorage.setItem("jp_landing_type", "learn");
        render(<SignupPage />);
        expect(sent("view_signup")[0]).toEqual(expect.objectContaining({ landing_type: "learn" }));
    });
});

// 2026-11-09: 登録すると何ができるか（1行）。登録の入力のステップにだけ出す
describe("SignupPage - 便益の1行", () => {
    it("登録の画面に出る", () => {
        render(<SignupPage />);
        expect(screen.getByTestId("signup-benefit").textContent)
            .toBe("登録すると、いいね・フォロー・コメント・保存・投稿ができるようになります。");
    });
});
