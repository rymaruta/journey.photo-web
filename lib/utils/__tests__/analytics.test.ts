import { describe, it, expect, beforeEach } from "vitest";
import {
    track, gaInitSnippet, signupFromVia, signupErrorReason, uploadErrorReason, sanitizeParams,
    PENDING_QUEUE, PENDING_MAX, EVENT_SPEC, COUNT_MAX,
} from "../analytics";
import { LANDING_STORAGE_KEY } from "../landingType";

/**
 * 登録までの数え方（journey.photo-ios#432 の 5・2026-10-31）と、
 * 漏斗・アプリの入口・投稿・推奨イベント（2026-11-04）。
 * GA4 は `lazyOnload` なので、読み込み前に押されたイベントを落とさないことを固定する
 */
type W = Window & { gtag?: unknown; dataLayer?: unknown[]; [PENDING_QUEUE]?: unknown };
const w = window as W;

beforeEach(() => {
    delete w.gtag;
    delete w.dataLayer;
    delete w[PENDING_QUEUE];
    sessionStorage.clear();
    sessionStorage.setItem(LANDING_STORAGE_KEY, "learn");
});

function capture() {
    const calls: unknown[][] = [];
    w.gtag = (...a: unknown[]) => { calls.push(a); };
    return calls;
}

describe("track", () => {
    it("gtag があればそのまま送る（既存の欄に landing_type が足される）", () => {
        const calls = capture();
        track("wish_tap", { signed_in: 1, kind: "spot" });
        expect(calls).toEqual([["event", "wish_tap", { signed_in: 1, kind: "spot", landing_type: "learn" }]]);
    });

    it("gtag の前は列に積み、初期化の行が config のあとに送る", () => {
        track("wish_tap", { signed_in: 0, kind: "location" });
        track("sign_up", { method: "email", from: "wish" });
        expect(w[PENDING_QUEUE]).toHaveLength(2);

        // `Analytics.tsx` の初期化の行をそのまま走らせる（中身は文字列で渡される）。
        // ブラウザの `<script>` と同じく大域で動かす（間接の eval＝`function gtag` が大域に載る）
        (0, eval)(gaInitSnippet("G-TEST"));
        const dl = (w.dataLayer as IArguments[]).map((a) => Array.from(a));
        expect(dl.map((a) => a[0])).toEqual(["js", "config", "event", "event"]);
        expect(dl[1]).toEqual(["config", "G-TEST"]);
        expect(dl[2]).toEqual(["event", "wish_tap", { signed_in: 0, kind: "location", landing_type: "learn" }]);
        expect(dl[3]).toEqual(["event", "sign_up", { method: "email", from: "wish", landing_type: "learn" }]);
        // 吐き出したら空に（二度送らない）。以後は gtag へ直に
        expect(w[PENDING_QUEUE]).toBeNull();
        track("wish_tap", { signed_in: 1, kind: "spot" });
        expect((w.dataLayer as unknown[]).length).toBe(5);
    });

    it("GA4 の無い環境で積み続けない（頭打ち）", () => {
        for (let i = 0; i < PENDING_MAX + 10; i++) track("wish_tap", { signed_in: 0, kind: "spot" });
        expect(w[PENDING_QUEUE]).toHaveLength(PENDING_MAX);
    });

    it("gtag が壊れていて投げても、呼び出し側には出さない（広告ブロック等）", () => {
        w.gtag = () => { throw new Error("blocked"); };
        expect(() => track("like_photo", {})).not.toThrow();
    });

    it("sessionStorage が使えなくても送れる（landing_type は other）", () => {
        const calls = capture();
        const orig = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
        Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("denied"); } });
        try {
            track("login", { method: "email" });
        } finally {
            Object.defineProperty(window, "sessionStorage", orig);
        }
        expect(calls).toEqual([["event", "login", { method: "email", landing_type: "other" }]]);
    });
});

/** 足したイベントごとに: 呼ばれたら送る形・値の範囲・個人情報が入らないこと */
describe("イベントごとの形", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ["view_signup", { from: "wish" }],
        ["signup_start", { from: "other" }],
        ["signup_error", { step: "form", reason: "password_rule" }],
        ["signup_error", { step: "confirm", reason: "code_mismatch" }],
        ["login", { method: "email" }],
        ["app_store_click", { placement: "footer" }],
        ["app_store_click", { placement: "banner" }],
        ["upload_start", { photo_count: 3 }],
        ["upload_complete", { photo_count: 3 }],
        ["upload_error", { reason: "network" }],
        ["select_content", { content_type: "spot", item_id: "hanauma-bay" }],
        ["search", { search_term_length: 4, result_count: 12 }],
        ["share", { method: "line", content_type: "photo" }],
        ["like_photo", {}],
        ["follow_user", {}],
    ];
    it.each(cases)("%s %j → 欄はそのまま・landing_type が付く", (name, params) => {
        const calls = capture();
        (track as (n: string, p: unknown) => void)(name, params);
        expect(calls).toEqual([["event", name, { ...params, landing_type: "learn" }]]);
    });

    it("値が範囲外なら、そのイベントごと送らない（自由な文字列を通さない）", () => {
        const calls = capture();
        const t = track as (n: string, p: unknown) => void;
        t("signup_error", { step: "form", reason: "Password does not conform to policy: foo@example.com" });
        t("app_store_click", { placement: "somewhere" });
        t("share", { method: "email", content_type: "photo" });
        t("select_content", { content_type: "spot-slug-hanauma-bay" });
        t("upload_start", { photo_count: "3" });
        t("upload_start", { photo_count: Number.NaN });
        t("view_signup", {});
        t("not_an_event", { a: 1 });
        expect(calls).toEqual([]);
    });

    it("表に無い欄（検索語・メール・uid）は落ちる。検索には item_id も付かない", () => {
        const calls = capture();
        (track as (n: string, p: unknown) => void)("search", {
            search_term_length: 3, result_count: 0,
            search_term: "花火", item_id: "hanauma-bay", email: "u@example.com", uid: "abc",
        });
        (track as (n: string, p: unknown) => void)("select_content", {
            content_type: "photo", item_id: "p123", email: "u@example.com", uid: "abc",
        });
        const sent = JSON.stringify(calls);
        for (const leak of ["花火", "hanauma", "u@example.com", "abc", "search_term\""]) {
            expect(sent).not.toContain(leak);
        }
        expect(calls).toHaveLength(2);
        expect(calls.find((c) => c[1] === "select_content")?.[2]).toMatchObject({ content_type: "photo", item_id: "p123" });
    });

    it("select_content の item_id は公開の識別子の形だけ（英数字・-・_・80字以内）。外れたら送らない", () => {
        expect(sanitizeParams("select_content", { content_type: "spot", item_id: "hanauma-bay" }))
            .toEqual({ content_type: "spot", item_id: "hanauma-bay" });
        for (const bad of ["", "a b", "花火", "x?q=1", "a/b", "u@example.com", "a".repeat(81), 12, undefined]) {
            expect(sanitizeParams("select_content", { content_type: "spot", item_id: bad })).toBeNull();
        }
    });

    it("数は整数に丸め、0〜上限に収める", () => {
        expect(sanitizeParams("upload_complete", { photo_count: 2.9 })).toEqual({ photo_count: 2 });
        expect(sanitizeParams("upload_complete", { photo_count: -5 })).toEqual({ photo_count: 0 });
        expect(sanitizeParams("upload_complete", { photo_count: 10 ** 9 })).toEqual({ photo_count: COUNT_MAX });
    });

    it("既存の wish_tap・sign_up の欄と値は変えていない", () => {
        expect(EVENT_SPEC.wish_tap).toEqual({ signed_in: [0, 1], kind: ["spot", "location"] });
        expect(EVENT_SPEC.sign_up).toEqual({ method: ["email"], from: ["wish", "other"] });
    });
});

describe("signupFromVia", () => {
    it("via=wish だけが wish。それ以外（無い・別の値）は other", () => {
        expect(signupFromVia("wish")).toBe("wish");
        expect(signupFromVia(null)).toBe("other");
        expect(signupFromVia("")).toBe("other");
        expect(signupFromVia("WISH")).toBe("other");
    });
});

describe("signupErrorReason", () => {
    it("Cognito の例外名を決まった理由に分ける。文言は見ない", () => {
        expect(signupErrorReason("form", "InvalidPasswordException")).toBe("password_rule");
        expect(signupErrorReason("form", "InvalidParameterException")).toBe("invalid_input");
        expect(signupErrorReason("form", "UsernameExistsException")).toBe("already_registered");
        expect(signupErrorReason("form", "AliasExistsException")).toBe("already_registered");
        expect(signupErrorReason("confirm", "AliasExistsException")).toBe("alias_exists");
        expect(signupErrorReason("confirm", "CodeMismatchException")).toBe("code_mismatch");
        expect(signupErrorReason("confirm", "ExpiredCodeException")).toBe("code_expired");
        expect(signupErrorReason("confirm", "LimitExceededException")).toBe("rate_limit");
        expect(signupErrorReason("form", "NetworkError")).toBe("network");
        expect(signupErrorReason("form", undefined)).toBe("other");
        expect(signupErrorReason("form", "a@example.com")).toBe("other");
    });
});

describe("uploadErrorReason", () => {
    it("通信・サーバー・その他に分ける。メッセージは返さない", () => {
        expect(uploadErrorReason(new TypeError("x"))).toBe("network");
        expect(uploadErrorReason(new Error("Failed to fetch"))).toBe("network");
        expect(uploadErrorReason(new Error("Load failed"))).toBe("network");
        expect(uploadErrorReason(new Error("S3 403"))).toBe("server");
        expect(uploadErrorReason(new Error("写真は100枚までです"))).toBe("server");
        expect(uploadErrorReason(new Error("boom"))).toBe("other");
        expect(uploadErrorReason("string")).toBe("other");
    });
});
