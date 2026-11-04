import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * 設定（⑫）の骨格。
 *
 * ここで固定するのは**「何を置いて、何を置かなかったか」**——owner の
 * 指示「デザインだけ完成して操作できない画面は作らない」を、文章ではなく
 * テストで持つ。iOS・モックには在るが Web に実装の無い節（広告・プッシュ通知・
 * データとストレージ・アプリについて）を**うっかり足し戻さない**ための
 * 見張りでもある。
 */

const mockShowToast = vi.fn();
const mockReplace = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ value: { isAuthenticated: true, loading: false, deleteAccount: vi.fn() } as Record<string, unknown> }));
const mockLogout = vi.hoisted(() => vi.fn());

// ブロック一覧・親しい友達は別のテストが見る。**設定の中に描かれたら分かる印**を出す
vi.mock("../BlockedUsers", () => ({ default: () => <div data-testid="blocked-list-inline" /> }));
vi.mock("../CloseFriends", () => ({ default: () => <div data-testid="close-friends-inline" /> }));
// 光と天気の知らせは `LightAlertSettings.test.tsx` が見る
vi.mock("../LightAlertSettings", () => ({ default: () => null }));
vi.mock("../../../components/DeleteAccountModal", () => ({
    default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="delete-modal-open" /> : null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ logout: mockLogout, ...mockAuth.value }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    getCurrentEmail: async () => "me@example.com",
}));

/** 本番の `deploy.yml` が直書きで渡している宛先（`publicEnvWiring.test.ts` が見張る） */
const CONTACT = "journey.photo.official@gmail.com";

beforeEach(() => {
    mockShowToast.mockReset();
    mockReplace.mockReset();
    mockLogout.mockReset().mockResolvedValue(undefined);
    mockAuth.value = { isAuthenticated: true, loading: false, deleteAccount: vi.fn() };
    vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); });

/**
 * `siteConfig` はモジュール読み込み時に env を読むので、**先に差してから
 * import する**（`app/privacy/__tests__/page.contact.test.tsx` と同じ形）。
 */
async function renderSettings(contactEmail = CONTACT) {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", contactEmail);
    const SettingsPage = (await import("../page")).default;
    render(<SettingsPage />);
}

const open = async (contactEmail = CONTACT) => {
    await renderSettings(contactEmail);
    await screen.findByRole("heading", { name: "設定" });
};

describe("設定の骨格（iOS `SettingsView` の並び・2026-11-04）", () => {
    // 🔴 iOS の `SettingsOutline.Part` と同じ順（Web に中身の在る節だけ）。お知らせ（プッシュ）は Web に無い
    it("節は Pro → 旅の道具 → 公開範囲とプライバシー → 写真と撮影 → ヘルプと規約 → アカウント の順", async () => {
        await open();
        expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent))
            .toEqual(["Pro", "旅の道具", "公開範囲とプライバシー", "写真と撮影", "ヘルプと規約", "アカウント"]);
    });

    it("節の見出しは真鍮の眉ラベル（白50%の小見出しではない）", async () => {
        await open();
        for (const h of screen.getAllByRole("heading", { level: 2 })) {
            expect(h.className, `${h.textContent} の見出しが眉ラベルでない`).toMatch(/\beyebrow\b/);
            expect(h.className).toMatch(/\btext-accent\b/);
            expect(h.className).not.toMatch(/text-white\/50/);
        }
    });

    it("大見出しは明朝 30（iOS `SettingsLayout.titleSize`）", async () => {
        await open();
        const h1 = screen.getByRole("heading", { level: 1, name: "設定" });
        expect(h1.className).toMatch(/font-serif/);
        expect(h1.className).toMatch(/text-\[30px\]/);
        expect(h1.className).toMatch(/font-bold/);
    });

    it.each([
        ["名前の横のバッジと Pro マーク", "/user/badges"],
        ["共同アルバム", "/user/albums"],
        ["旅行プラン", "/trips"],
        ["ブロックした人", "/user/settings/blocked"],
        ["親しい友達", "/user/settings/close-friends"],
        ["いいねした写真", "/favorites"],
        ["構図一覧", "/composition"],
        ["利用規約・プライバシーポリシー", "/user/settings/legal"],
        ["メールアドレスを変える", "/user/settings/email"],
        ["パスワードを変える", "/user/settings/password"],
    ])("「%s」の行は %s へ行く", async (name, href) => {
        await open();
        const link = screen.getByRole("link", { name: new RegExp(`^${name}`) });
        expect(link).toHaveAttribute("href", href);
        // 板 v2: 行は最小 54
        expect(link.className).toMatch(/min-h-\[54px\]/);
    });

    // 🔴 iOS ではブロックした人・親しい友達は別の画面。設定の中に一覧ごと開かない
    it("ブロックした人・親しい友達の一覧を設定の中に開かない", async () => {
        await open();
        expect(screen.queryByTestId("blocked-list-inline")).toBeNull();
        expect(screen.queryByTestId("close-friends-inline")).toBeNull();
        expect(screen.queryByLabelText("新しいメールアドレス"), "メール変更の欄が設定に残っている").toBeNull();
        expect(screen.queryByLabelText("いまのパスワード"), "パスワードの欄が設定に残っている").toBeNull();
    });

    // iOS の設定に無く、マイページに入口があるもの
    it.each([/写真の下書き/, /ストーリーのアーカイブ/, /ハイライトの管理/, /^行きたい場所$/])("iOS の設定に無い行を置かない: %s", async (name) => {
        await open();
        expect(screen.queryByRole("link", { name })).toBeNull();
    });

    it("ログアウトとアカウントの削除は見出しの無い別々の札", async () => {
        await open();
        const logout = screen.getByRole("button", { name: "ログアウト" });
        const del = screen.getByRole("button", { name: /アカウントの削除/ });
        const logoutCard = logout.closest("section")!;
        const delCard = del.closest("section")!;
        expect(logoutCard).not.toBe(delCard);
        expect(logoutCard.querySelector("h2")).toBeNull();
        expect(delCard.querySelector("h2")).toBeNull();
        // 削除が最後
        const sections = Array.from(document.querySelectorAll("section"));
        expect(sections.at(-1)).toBe(delCard);
        expect(sections.at(-2)).toBe(logoutCard);
    });

    it("アカウントの削除は名前ごと danger（系統の赤ではない）で、押すと退会の窓を開く", async () => {
        await open();
        const del = screen.getByRole("button", { name: /アカウントの削除/ });
        expect(del.querySelector(".text-danger")?.textContent).toBe("アカウントの削除");
        expect(del.innerHTML).not.toMatch(/text-red-/);
        expect(screen.queryByTestId("delete-modal-open")).toBeNull();
        await userEvent.click(del);
        expect(screen.getByTestId("delete-modal-open")).toBeInTheDocument();
    });

    it("ログアウトは確認なしでログアウトする（白い行・矢印なし）", async () => {
        await open();
        const btn = screen.getByRole("button", { name: "ログアウト" });
        expect(btn.querySelector("svg"), "ログアウトに矢印が付いている").toBeNull();
        await userEvent.click(btn);
        expect(mockLogout).toHaveBeenCalledTimes(1);
    });

    // 🔴 **実装の無い節を置かない**（owner の指示）。iOS にはあるが Web に中身が無い
    it.each([
        ["広告", /広告/, "Web 版に広告の実装が1行も無い（AdMob は iOS の別指示書）"],
        ["お知らせ（プッシュ通知）", /プッシュ|お知らせ/, "Web にプッシュを受け取る設定の実装が無い"],
        ["データとストレージ", /データとストレージ|ストレージ/, "操作できる実体が SW の写真キャッシュだけ"],
        ["アプリについて", /アプリについて|バージョン/, "クライアントにバージョン文字列が出ていない"],
        ["新しくなったこと", /新しくなったこと/, "Web に履歴が無い"],
    ])("中身の無い節を置かない: %s（%s）", async (_name, pattern) => {
        await open();
        expect(screen.queryByText(pattern), "操作できない項目が並んでいる").toBeNull();
    });

    it("問い合わせは mailto で繋ぐ", async () => {
        await open();
        expect(screen.getByRole("link", { name: /問い合わせ/ }).getAttribute("href")).toMatch(/^mailto:.+@.+/);
    });

    // 逆向き: 宛先が空なら行ごと描かない（押せるのに何も起きない、を作らない）
    it("問い合わせ先が空なら「問い合わせ」の行を出さない", async () => {
        await open("");
        expect(screen.queryByRole("link", { name: /問い合わせ/ })).toBeNull();
        expect(document.querySelectorAll('a[href^="mailto:"]')).toHaveLength(0);
        // 節は規約の行で残る
        expect(screen.getByRole("heading", { name: "ヘルプと規約" })).toBeInTheDocument();
    });

    // プロフィールの編集項目は**移していない**（あちらに残っている）
    it("プロフィールの編集項目を持ち込んでいない", async () => {
        await open();
        for (const label of [/表示名/, /自己紹介/, /カバー写真/, /マイBGM/, /テーマ/]) {
            expect(screen.queryByText(label), `プロフィールの項目が設定に紛れ込んでいる: ${label}`).toBeNull();
        }
        expect(screen.queryByRole("button", { name: /^保存する$/ })).toBeNull();
    });
});

describe("設定の門", () => {
    it("未ログインならログインへ送る（戻り先を添えて）", async () => {
        mockAuth.value = { isAuthenticated: false, loading: false, deleteAccount: vi.fn() };
        await renderSettings();
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
    });

    // 🔴 **送り返すまでの間も描かない。** `loading` だけ見ていたので、
    // 未ログインで開くと `router.replace` が効くまでの1描画ぶん、
    // メールアドレス・パスワード・退会の並んだ画面が**丸ごと見えていた**
    // （移設元の `/user/profile` は `loading || fetching` で塞いでいた）
    it("未ログインの間は中身を描かない（送り返すまでの1描画も）", async () => {
        mockAuth.value = { isAuthenticated: false, loading: false, deleteAccount: vi.fn() };
        await renderSettings();

        expect(screen.queryByRole("heading", { name: "アカウント" }),
            "未ログインに設定の中身が見えている").toBeNull();
        expect(screen.queryByRole("link", { name: /パスワードを変える/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /アカウントの削除/ })).toBeNull();
        // 見出しは読み上げ向けに残す（事前描画で焼かれる枝）
        expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    });

    it("判定中はまだ送らない（灰の骨格のまま・回る輪ではない）", async () => {
        mockAuth.value = { isAuthenticated: false, loading: true, deleteAccount: vi.fn() };
        await renderSettings();
        expect(mockReplace, "認証の確認が終わる前に送り返している").not.toHaveBeenCalled();
        // 読み込み中は iOS `JPLoadingState` と同じ灰の骨格（`StateViews.LoadingState`）
        expect(screen.getByTestId("state-loading")).toBeInTheDocument();
        expect(document.querySelector(".animate-spin"), "回る輪が残っている").toBeNull();
    });

    // 🔴 **`useMemberGate` を使わない理由。** あれはグループ（投稿権限）まで
    // 見るので、登録直後の `AdminAddUserToGroup` が落ちた人が弾かれる。
    // その人にもパスワードの変更と退会は要る——むしろ**権限が付かなかった
    // 人ほど退会したい**。`useMemberGate` に差し替えるとここが落ちる
    it("投稿権限が無くても開ける（退会とパスワード変更の口を塞がない）", async () => {
        mockAuth.value = {
            isAuthenticated: true, loading: false, deleteAccount: vi.fn(),
            // グループに1つも入っていない人
            isAdminUser: false, isGeneralUser: false,
        };
        await open();
        expect(screen.getByRole("link", { name: /パスワードを変える/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /アカウントの削除/ })).toBeInTheDocument();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
