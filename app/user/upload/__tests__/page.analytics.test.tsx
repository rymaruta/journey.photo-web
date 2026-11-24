import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 投稿の計測（upload_start / upload_complete / upload_error・2026-11-04）。
// 呼ぶ条件と、送る値に個人情報・エラー文言が入らないことを固定する。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());
const mockCreateThumbnail = vi.hoisted(() => vi.fn());
const mockDominantColor = vi.hoisted(() => vi.fn());

// **上限そのものは差し替える。** 本物は5秒で、待つことを見るテストが
// 毎回5秒かかる（実装は同じ経路を通る）
vi.mock("../cancelWait", () => ({ CANCEL_DISCARD_WAIT_MS: 50 }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("from=share"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 「読めた／読めなかった」を分ける口。既存のモックから組み立てる
    readSharedResult: async () => ({ ok: true, payload: await mockReadSharedPayload() }),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: mockCreateThumbnail,            // 既定はサムネ無し（本体のキーだけを見る）
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: mockDominantColor,
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

const UploadPage = (await import("../page")).default;


const KEY = "uploads/me/abc.jpg";

beforeEach(() => {
    mockCreateThumbnail.mockReset().mockResolvedValue(null);
    mockDominantColor.mockReset().mockResolvedValue(null);
    mockShowToast.mockReset();
    mockPush.mockReset();
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/upload/presigned-url") {
            return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/x.jpg", key: KEY }) });
        }
        if (url === "/upload/discard") return Promise.resolve({ ok: true, json: async () => ({}) });
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => ({ id: "p1" }) });
    });
    mockReadSharedPayload.mockResolvedValue({
        files: [new File(["x"], "shared.jpg", { type: "image/jpeg" })], title: "", text: "", t: Date.now(),
    });
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});



const gtag = vi.fn();
const sent = (name: string) => gtag.mock.calls.filter((c) => c[1] === name).map((c) => c[2]);
beforeEach(() => {
    gtag.mockReset();
    sessionStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
});

describe("投稿の計測", () => {
    it("公開に成功 → upload_start（枚数）と upload_complete（枚数）を1回ずつ。error は送らない", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(sent("upload_complete")).toHaveLength(1));
        expect(sent("upload_start")).toEqual([expect.objectContaining({ photo_count: 1 })]);
        expect(sent("upload_complete")).toEqual([expect.objectContaining({ photo_count: 1 })]);
        expect(sent("upload_error")).toEqual([]);
        const all = JSON.stringify(gtag.mock.calls);
        expect(all).not.toContain("shared.jpg");
        expect(all).not.toContain("uploads/me");
    });

    it("下書き保存は upload_complete に数えない（公開した回だけが成果）", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
        render(<UploadPage />);
        const draft = await screen.findByRole("button", { name: /下書き/ });
        await waitFor(() => expect(draft).not.toBeDisabled());
        await userEvent.click(draft);
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));
        await waitFor(() => expect(mockShowToast.mock.calls.some((c) => String(c[0]).includes("下書き保存しました"))).toBe(true));
        expect(sent("upload_start")).toHaveLength(1);
        expect(sent("upload_complete")).toEqual([]);
    });

    it("通信が落ちた → upload_error reason=network。文言は送らない", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(sent("upload_error")).toHaveLength(1));
        expect(sent("upload_error")[0]).toEqual(expect.objectContaining({ reason: "network" }));
        expect(sent("upload_complete")).toEqual([]);
        expect(JSON.stringify(gtag.mock.calls)).not.toContain("Failed to fetch");
    });
});
