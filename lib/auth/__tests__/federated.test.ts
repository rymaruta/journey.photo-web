import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

/**
 * Web の「Apple でサインイン」「Google でログイン」の部品（札 journey.photo-ios#730）。
 * 券での Cognito のログイン（CUSTOM_AUTH）と、小さな部品（宛先の形・戻り先・名前・nonce）を見る
 */
vi.mock("../config", () => ({
    cognitoConfig: { userPoolId: "ap-northeast-1_test", clientId: "test-client-id", region: "ap-northeast-1" },
    ADMIN_GROUP_NAME: "admin",
    USER_GROUP_NAME: "user",
}));

const user = vi.hoisted(() => ({
    flow: "" as string,
    answers: [] as string[],
    initiate: vi.fn(),
}));
vi.mock("amazon-cognito-identity-js", () => ({
    CognitoUserPool: vi.fn(function () { return { getCurrentUser: () => null }; }),
    AuthenticationDetails: vi.fn(function (o: unknown) { return o; }),
    CognitoUserAttribute: vi.fn(function (o: unknown) { return o; }),
    CognitoUser: vi.fn(function () {
        return {
            setAuthenticationFlowType: (f: string) => { user.flow = f; },
            initiateAuth: (...a: unknown[]) => user.initiate(...a),
            sendCustomChallengeAnswer: (answer: string, cb: { onSuccess: (s: unknown) => void; customChallenge: () => void }) => {
                user.answers.push(answer);
                if (answer === "ok") cb.onSuccess({ getIdToken: () => ({ payload: { sub: "s-1", "cognito:groups": ["user"] } }) });
                else cb.customChallenge();
            },
        };
    }),
}));

import { signInWithTicket } from "../cognito";
import { appleDisplayName, appleRedirectUri, makeNonce, validWebClientId } from "../federated";

beforeEach(() => {
    user.flow = "";
    user.answers = [];
    user.initiate.mockReset().mockImplementation((_d: unknown, cb: { customChallenge: () => void }) => cb.customChallenge());
});

describe("signInWithTicket（券で Cognito に入る）", () => {
    it("CUSTOM_AUTH で入り、問いに券を1回だけ答える", async () => {
        const r = await signInWithTicket("u-1", "ok");
        expect(user.flow).toBe("CUSTOM_AUTH");
        expect(user.answers).toEqual(["ok"]);
        expect(r).toMatchObject({ success: true, groups: ["user"] });
    });

    it("🔴 2回目の問いには答えない（券は1回きり・トリガーも2回目を断る）。失敗の文は日本語の決まった一文", async () => {
        const r = await signInWithTicket("u-1", "bad");
        expect(user.answers).toEqual(["bad"]);
        expect(r).toEqual({ success: false, error: "ログインできませんでした。もう一度お試しください" });
    });

    it("Cognito が断ったら失敗（理由の英語は出さない）", async () => {
        user.initiate.mockImplementation((_d: unknown, cb: { onFailure: (e: unknown) => void }) => cb.onFailure({ code: "NotAuthorizedException", message: "Incorrect" }));
        expect(await signInWithTicket("u-1", "ok")).toEqual({ success: false, error: "ログインできませんでした。もう一度お試しください" });
    });
});

describe("小さな部品", () => {
    it("宛先は形の合う値だけ使う", () => {
        expect(validWebClientId("apple", "com.journeyphoto.web")).toBe("com.journeyphoto.web");
        expect(validWebClientId("apple", "javascript:alert(1)")).toBeNull();
        expect(validWebClientId("google", "280167931666-00gh6an2dpgg2rsmrdn8phgapgcpsrv1.apps.googleusercontent.com")).not.toBeNull();
        expect(validWebClientId("google", "com.journeyphoto.web")).toBeNull();
        expect(validWebClientId("google", 1)).toBeNull();
    });

    it("Apple の戻り先は Apple Developer に登録した形（末尾の / 無しの /login）", () => {
        expect(appleRedirectUri("https://journey-photo.com")).toBe("https://journey-photo.com/login");
        expect(appleRedirectUri("https://www.journey-photo.com/")).toBe("https://www.journey-photo.com/login");
    });

    it("Apple の名前: 日本語は姓・名の順で続けて、英字は名・姓の順で空ける。無ければ入れない", () => {
        expect(appleDisplayName({ name: { firstName: "花子", lastName: "山田" } })).toBe("山田花子");
        expect(appleDisplayName({ name: { firstName: "Taro", lastName: "Yamada" } })).toBe("Taro Yamada");
        expect(appleDisplayName({ name: { firstName: "", lastName: "" } })).toBeUndefined();
        expect(appleDisplayName(undefined)).toBeUndefined();
    });

    it("nonce: 元の値は毎回違い、提供元に渡す値はその SHA-256（16進）", async () => {
        const a = await makeNonce();
        const b = await makeNonce();
        expect(a.raw).not.toBe(b.raw);
        expect(a.raw.length).toBeGreaterThanOrEqual(40);
        expect(a.hashed).toBe(createHash("sha256").update(a.raw).digest("hex"));
    });
});
