import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { createHash } from "node:crypto";

/**
 * ログインと新規登録の頁の「Apple でサインイン」「Google でログイン」（札 journey.photo-ios#730）。
 * サーバーが Web の宛先を返したときだけ出ること、nonce の渡し方（提供元には SHA-256、サーバーには元の値）、
 * 押したその場で Apple のポップアップを開くこと、券で入ること、失敗の文、を見る
 */
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", async (orig) => ({
    ...(await orig<typeof import("../../../lib/utils/api")>()),
    userPublicFetch: (...a: unknown[]) => fetchMock(...a),
}));
const loginWithTicket = vi.hoisted(() => vi.fn());
vi.mock("../../auth/context", () => ({ useAuth: () => ({ loginWithTicket }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../../../lib/auth/federated", async (orig) => ({
    ...(await orig<typeof import("../../../lib/auth/federated")>()),
    // 外のスクリプトは読まない（下で window に偽物を置く）
    loadScript: () => Promise.resolve(),
}));

import { FederatedSignIn } from "../FederatedSignIn";

const APPLE_WEB = "com.journeyphoto.web";
const GOOGLE_WEB = "280167931666-00gh6an2dpgg2rsmrdn8phgapgcpsrv1.apps.googleusercontent.com";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

type Init = Record<string, unknown> & { nonce: string; state?: string; callback?: (r: { credential?: string }) => void };
let appleInits: Init[] = [];
let appleSignIn: Mock<() => Promise<unknown>>;
let googleInits: Init[] = [];
let googleRenders: Record<string, unknown>[] = [];
let posts: { path: string; body: Record<string, unknown> }[] = [];
let statusReply: Record<string, unknown>;
let postReply: () => Response;

beforeEach(() => {
    localStorage.clear();
    appleInits = [];
    googleInits = [];
    googleRenders = [];
    posts = [];
    statusReply = { apple: { available: true, webClientId: APPLE_WEB }, google: { available: true, webClientId: GOOGLE_WEB } };
    postReply = () => json(200, { username: "u-1", challengeAnswer: "google:x:y", created: false });
    appleSignIn = vi.fn(async (): Promise<unknown> => ({ authorization: { id_token: "apple.id.token", code: "c.1", state: appleInits.at(-1)!.state } }));
    (window as unknown as { AppleID: unknown }).AppleID = { auth: { init: (c: Init) => appleInits.push(c), signIn: () => appleSignIn() } };
    (window as unknown as { google: unknown }).google = {
        accounts: { id: { initialize: (c: Init) => googleInits.push(c), renderButton: (el: HTMLElement, o: Record<string, unknown>) => { googleRenders.push(o); el.innerHTML = "<div role=button>Google でログイン</div>"; } } },
    };
    fetchMock.mockReset().mockImplementation(async (path: string, init?: { body?: string }) => {
        const m = path.match(/^\/auth\/(apple|google)(\/status)?$/);
        if (m?.[2]) return json(200, statusReply[m[1]]);
        posts.push({ path, body: JSON.parse(init?.body ?? "{}") });
        return postReply();
    });
    loginWithTicket.mockReset().mockResolvedValue({ success: true, userId: "sub-1" });
    showToast.mockReset();
});
afterEach(() => {
    delete (window as unknown as { AppleID?: unknown }).AppleID;
    delete (window as unknown as { google?: unknown }).google;
});

describe("FederatedSignIn", () => {
    it("Apple と Google は同じ形: Google は白の形（outline・丸・大 40）、Apple も白の地・高さ 40・印 18・字 14 の中太・印と字の間 8（2026-11-25 owner）", async () => {
        render(<FederatedSignIn mode="signin" onError={vi.fn()} />);
        const apple = await screen.findByRole("button", { name: "Apple でサインイン" });
        await waitFor(() => expect(googleRenders.length).toBeGreaterThan(0));
        expect(googleRenders.at(-1)).toMatchObject({ type: "standard", theme: "outline", size: "large", shape: "pill", logo_alignment: "center" });
        const face = apple.querySelector("span")!;
        for (const c of ["h-10", "bg-white", "text-black", "text-[14px]", "font-medium", "gap-2", "justify-center", "rounded-full", "ring-[#DADCE0]"]) {
            expect(face.className.split(/\s+/), c).toContain(c);
        }
        expect(face.querySelector("svg")!.getAttribute("class")).toContain("h-[18px] w-[18px]");
        // 部品が読めるまでの場所取りも白の形（黒の地で置いてから白に替わらない）
        expect(screen.getByTestId("federated-google").className).toContain("min-h-10");
    });


    it("🔴 サーバーが Web の宛先を返さない間は、何も出さない（今の画面のまま）", async () => {
        statusReply = { apple: { available: true }, google: { available: true } };
        const { container } = render(<FederatedSignIn mode="signin" onError={vi.fn()} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(container.innerHTML).toBe("");
    });

    it("宛先が返れば、Apple → Google → 「またはメールアドレスで」の順に出す。登録の頁は「Apple で登録」", async () => {
        const { rerender } = render(<FederatedSignIn mode="signin" onError={vi.fn()} />);
        const apple = await screen.findByRole("button", { name: "Apple でサインイン" });
        await waitFor(() => expect(googleInits).toHaveLength(1));
        const box = screen.getByTestId("federated-signin");
        expect(box.textContent).toMatch(/Apple でサインイン.*Google でログイン.*またはメールアドレスで/);
        expect(apple).toBeTruthy();
        rerender(<FederatedSignIn mode="signup" onError={vi.fn()} />);
        expect(await screen.findByRole("button", { name: "Apple で登録" })).toBeTruthy();
    });

    it("🔴 Apple: 提供元には nonce の SHA-256・戻り先は /login・ポップアップ。押したその場で開き、サーバーには元の値を送る", async () => {
        const onError = vi.fn();
        render(<FederatedSignIn mode="signin" onError={onError} />);
        const btn = await screen.findByRole("button", { name: "Apple でサインイン" });
        await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
        const init = appleInits.at(-1)!;
        expect(init).toMatchObject({ clientId: APPLE_WEB, redirectURI: `${window.location.origin}/login`, usePopup: true, scope: "name email" });
        act(() => { fireEvent.click(btn); });
        // 待たずに開いている（押した手の動きの中）
        expect(appleSignIn).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(loginWithTicket).toHaveBeenCalledWith("u-1", "google:x:y"));
        const post = posts.find((p) => p.path === "/auth/apple")!;
        expect(post.body).toMatchObject({ identityToken: "apple.id.token", authorizationCode: "c.1" });
        expect(sha(post.body.nonce as string)).toBe(init.nonce);
        expect(showToast).toHaveBeenCalledWith("ログインしました", "success");
        // 次の1回のために nonce を作り直す
        await waitFor(() => expect(appleInits.length).toBe(2));
        expect(appleInits[1].nonce).not.toBe(init.nonce);
        expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/./));
    });

    it("🔴 Apple: state が違う答えはサーバーに送らない。ポップアップを閉じただけなら文を出さない", async () => {
        const onError = vi.fn();
        render(<FederatedSignIn mode="signin" onError={onError} />);
        const btn = await screen.findByRole("button", { name: "Apple でサインイン" });
        await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
        appleSignIn.mockResolvedValueOnce({ authorization: { id_token: "t", state: "other" } });
        act(() => { fireEvent.click(btn); });
        await waitFor(() => expect(onError).toHaveBeenCalledWith("ログインできませんでした。もう一度お試しください"));
        expect(posts).toHaveLength(0);

        onError.mockReset();
        await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
        appleSignIn.mockRejectedValueOnce({ error: "popup_closed_by_user" });
        act(() => { fireEvent.click(btn); });
        await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
        expect(onError.mock.calls.filter((c) => c[0] !== "")).toHaveLength(0);
        expect(loginWithTicket).not.toHaveBeenCalled();
    });

    it("🔴 Google: initialize に SHA-256 の nonce、ボタンは Google の部品（黒・丸・日本語）。答えのトークンと元の nonce をサーバーへ", async () => {
        render(<FederatedSignIn mode="signin" onError={vi.fn()} />);
        await waitFor(() => expect(googleInits).toHaveLength(1));
        const init = googleInits[0];
        expect(init).toMatchObject({ client_id: GOOGLE_WEB, ux_mode: "popup", auto_select: false });
        await act(async () => { init.callback!({ credential: "google.id.token" }); });
        await waitFor(() => expect(loginWithTicket).toHaveBeenCalled());
        const post = posts.find((p) => p.path === "/auth/google")!;
        expect(post.body.idToken).toBe("google.id.token");
        expect(sha(post.body.nonce as string)).toBe(init.nonce);
        // 次の1回のために作り直す
        await waitFor(() => expect(googleInits).toHaveLength(2));
        expect(googleInits[1].nonce).not.toBe(init.nonce);
    });

    it("サーバーが断ったら、サーバーの一文をそのまま出す（ほかの端末でログイン中、など）", async () => {
        postReply = () => json(409, { error: "ログイン中です。少し待ってからお試しください" });
        const onError = vi.fn();
        render(<FederatedSignIn mode="signin" onError={onError} />);
        await waitFor(() => expect(googleInits).toHaveLength(1));
        await act(async () => { googleInits[0].callback!({ credential: "t" }); });
        await waitFor(() => expect(onError).toHaveBeenCalledWith("ログイン中です。少し待ってからお試しください"));
        expect(loginWithTicket).not.toHaveBeenCalled();
    });

    it("新しく作った回は「登録しました」", async () => {
        postReply = () => json(200, { username: "u-2", challengeAnswer: "a", created: true });
        render(<FederatedSignIn mode="signup" onError={vi.fn()} />);
        await waitFor(() => expect(googleInits).toHaveLength(1));
        await act(async () => { googleInits[0].callback!({ credential: "t" }); });
        await waitFor(() => expect(showToast).toHaveBeenCalledWith("登録しました", "success"));
    });

    it("前に見た答えを覚え、次に開いたときは最初から出す。届かなかった回は控えを消さない", async () => {
        render(<FederatedSignIn mode="signin" onError={vi.fn()} />);
        await screen.findByRole("button", { name: "Apple でサインイン" });
        await waitFor(() => expect(localStorage.getItem("jp.federatedWebIds.v1")).toContain(APPLE_WEB));
        fetchMock.mockImplementation(async () => { throw new TypeError("offline"); });
        const { unmount } = render(<FederatedSignIn mode="signin" onError={vi.fn()} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(localStorage.getItem("jp.federatedWebIds.v1")).toContain(APPLE_WEB);
        unmount();
    });
});
