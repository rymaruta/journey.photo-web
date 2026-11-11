import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * 意見を送る頁（札 #546）。人ごとの書きかけ・設定から来たときの戻り先・
 * 「写真だけ送れなかった」あとに直して送ると新しい1件になること、を見る。
 */

const auth = vi.hoisted(() => ({ isAuthenticated: true, userId: "u1" as string | null, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

// 写真の関所は jsdom で画像を読めないので、そのまま返す
vi.mock("../../../lib/utils/image", () => ({ toUploadSafeFile: async (f: File) => f }));

import FeedbackPage from "../page";
import { feedbackDraftKey, forgetFeedbackDrafts } from "../../../lib/feedback";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/feedback");
    auth.isAuthenticated = true;
    auth.userId = "u1";
    mockUserFetch.mockReset().mockResolvedValue(json(200, { ok: true, id: "x" }));
});

describe("書きかけは人ごと", () => {
    it("自分の書きかけだけを戻し、別の人の書きかけは出さない", async () => {
        window.localStorage.setItem(feedbackDraftKey("u1"), "わたしの書きかけ");
        window.localStorage.setItem(feedbackDraftKey("u2"), "前の人の書きかけ");
        render(<FeedbackPage />);
        expect(await screen.findByDisplayValue("わたしの書きかけ")).toBeTruthy();
        expect(screen.queryByDisplayValue("前の人の書きかけ")).toBeNull();
    });

    it("ログアウト・退会で全部消す（forgetFeedbackDrafts）", () => {
        window.localStorage.setItem(feedbackDraftKey("u1"), "a");
        window.localStorage.setItem(feedbackDraftKey(null), "b");
        window.localStorage.setItem("jp_other", "keep");
        forgetFeedbackDrafts();
        expect(window.localStorage.getItem(feedbackDraftKey("u1"))).toBeNull();
        expect(window.localStorage.getItem(feedbackDraftKey(null))).toBeNull();
        expect(window.localStorage.getItem("jp_other")).toBe("keep");
    });
});

describe("戻り先", () => {
    it("設定から来たら設定へ戻す", async () => {
        window.history.replaceState(null, "", "/feedback?from=settings");
        render(<FeedbackPage />);
        const back = await screen.findByRole("link", { name: "設定" });
        expect(back.getAttribute("href")).toBe("/user/settings");
    });
    it("ほかはトップへ", async () => {
        render(<FeedbackPage />);
        expect((await screen.findByRole("link", { name: "戻る" })).getAttribute("href")).toBe("/");
    });
});

describe("写真だけ送れなかったあと", () => {
    it("本文は届いた扱いで欄を空にし、直して送るものは新しい id になる", async () => {
        const sent: { id: string; text: string }[] = [];
        mockUserFetch.mockImplementation(async (_path: string, init: RequestInit) => {
            sent.push(JSON.parse(String(init.body)) as { id: string; text: string });
            // 写真の署名を返さない＝写真は送れなかった
            return json(200, { ok: true, id: "x" });
        });
        const { container } = render(<FeedbackPage />);
        const box = await screen.findByTestId("feedback-text");
        await userEvent.type(box, "1回目");
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
        await screen.findByText("写真を1枚添えました");
        await userEvent.click(screen.getByTestId("feedback-send"));
        expect(await screen.findByText("ひとことは届きました。写真は送れませんでした")).toBeTruthy();
        expect((screen.getByTestId("feedback-text") as HTMLTextAreaElement).value).toBe("");
        await userEvent.type(screen.getByTestId("feedback-text"), "2回目");
        await userEvent.click(screen.getByTestId("feedback-send"));
        await waitFor(() => expect(sent).toHaveLength(2));
        expect(sent[1].text).toBe("2回目");
        expect(sent[0].id).not.toBe(sent[1].id);
    });
});
