import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetAppleKeysCache } from "../appleIdToken";
import { CLIENT_ID, fakeApple, makeToken } from "./appleTestKit";

/**
 * 「Apple でサインイン」の Cognito のトリガー（CUSTOM_AUTH・札 journey.photo-ios#601）。
 * 🔴 ここが true を返すと Cognito がトークンを出す。通してよいのは「Apple の token が正しく、
 *    その Apple の人がこの Cognito の利用者に結ばれていて、その token を初めて使う」ときだけ
 */
const db = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../dynamodb", () => ({ ddb: db, PHOTOS_TABLE: "photos-test" }));

import { handler, triggerDeps, CHALLENGE, type AuthChallengeEvent } from "../appleAuthTrigger";

let rows: Map<string, Record<string, unknown>>;

beforeEach(() => {
    resetAppleKeysCache();
    triggerDeps.fetchImpl = fakeApple().fetchImpl;
    triggerDeps.clientIds = () => [CLIENT_ID];
    triggerDeps.now = () => Date.now();
    rows = new Map([["apple#001234.apple", { userId: "apple#001234.apple", cognitoUsername: "uuid-1", cognitoSub: "sub-1" }]]);
    db.send.mockReset().mockImplementation(async (c: { constructor: { name: string }; input: Record<string, any> }) => {
        const key = c.input.Key.userId;
        const row = rows.get(key);
        if (c.constructor.name === "GetCommand") return { Item: row };
        if (c.constructor.name === "UpdateCommand") {
            const v = c.input.ExpressionAttributeValues;
            if (!row || row.cognitoUsername !== v[":u"] || row.lastNonce === v[":n"]) {
                throw Object.assign(new Error("cc"), { name: "ConditionalCheckFailedException" });
            }
            rows.set(key, { ...row, lastNonce: v[":n"] });
            return {};
        }
        throw new Error("知らない命令");
    });
});

const ev = (triggerSource: string, request: AuthChallengeEvent["request"] = {}, userName = "uuid-1"): AuthChallengeEvent =>
    ({ triggerSource, userName, request: { userAttributes: { sub: "sub-1" }, ...request }, response: {} });

const verifyAnswer = async (answer: unknown, userName = "uuid-1", sub = "sub-1") =>
    (await handler(ev("VerifyAuthChallengeResponse_Authentication",
        { challengeAnswer: answer as string, userAttributes: { sub } }, userName))).response.answerCorrect;

describe("Define（次の段）", () => {
    const define = (session: AuthChallengeEvent["request"]["session"], extra: Partial<AuthChallengeEvent["request"]> = {}) =>
        handler(ev("DefineAuthChallenge_Authentication", { session, ...extra })).then((e) => e.response);

    it("1回目は CUSTOM_CHALLENGE を出す", async () => {
        expect(await define([])).toEqual({ challengeName: CHALLENGE, issueTokens: false, failAuthentication: false });
    });

    it("CUSTOM_CHALLENGE が1回通ったときだけトークンを出す", async () => {
        expect(await define([{ challengeName: CHALLENGE, challengeResult: true }])).toEqual({ issueTokens: true, failAuthentication: false });
    });

    it("違った答え・2回目の答え・SRP の段が混じる・利用者がいない、は全部断る", async () => {
        const failed = { issueTokens: false, failAuthentication: true };
        expect(await define([{ challengeName: CHALLENGE, challengeResult: false }])).toEqual(failed);
        expect(await define([{ challengeName: CHALLENGE, challengeResult: false }, { challengeName: CHALLENGE, challengeResult: true }])).toEqual(failed);
        expect(await define([{ challengeName: "SRP_A", challengeResult: true }])).toEqual(failed);
        expect(await define([], { userNotFound: true })).toEqual(failed);
    });
});

describe("Create（問い）", () => {
    it("問いの中身は無い（答えは Apple の token）", async () => {
        const r = (await handler(ev("CreateAuthChallenge_Authentication", { challengeName: CHALLENGE }))).response;
        expect(r.publicChallengeParameters).toEqual({ provider: "apple" });
        expect(r.challengeMetadata).toBe("APPLE_ID_TOKEN");
    });
});

describe("Verify（答えの確かめ）", () => {
    it("正しい token で、結ばれた利用者なら通し、使った nonce を書く", async () => {
        expect(await verifyAnswer(makeToken())).toBe(true);
        expect(rows.get("apple#001234.apple")?.lastNonce).toBe("n0nce");
    });

    it("🔴 同じ token（同じ nonce）は2回目を通さない", async () => {
        expect(await verifyAnswer(makeToken())).toBe(true);
        expect(await verifyAnswer(makeToken())).toBe(false);
        expect(await verifyAnswer(makeToken({ nonce: "n2" }))).toBe(true);
    });

    it("🔴 その Apple の人が別の利用者に結ばれていれば通さない（他人のアカウントに入れない）", async () => {
        expect(await verifyAnswer(makeToken(), "uuid-other")).toBe(false);
        expect(await verifyAnswer(makeToken(), "uuid-1", "sub-other")).toBe(false);
        expect(await verifyAnswer(makeToken({ sub: "unknown.apple" }))).toBe(false);
    });

    it("確かめられない token・nonce の無い token・別のアプリあては通さない", async () => {
        expect(await verifyAnswer("garbage")).toBe(false);
        expect(await verifyAnswer(makeToken({ nonce: undefined }))).toBe(false);
        expect(await verifyAnswer(makeToken({ aud: "com.other" }))).toBe(false);
        expect(await verifyAnswer(undefined)).toBe(false);
    });

    it("宛先が設定されていない環境では通さない", async () => {
        triggerDeps.clientIds = () => [];
        expect(await verifyAnswer(makeToken())).toBe(false);
    });

    it("表が落ちても投げずに「通さない」で返す（投げると文が端末に出る）", async () => {
        db.send.mockRejectedValue(Object.assign(new Error("boom"), { name: "InternalServerError" }));
        await expect(verifyAnswer(makeToken())).resolves.toBe(false);
    });
});

it("知らないトリガーは何もしない", async () => {
    const e = ev("PreSignUp_SignUp");
    expect((await handler(e)).response).toEqual({});
});
