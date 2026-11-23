import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeUsersTable, makeToken } from "./appleTestKit";

/**
 * 外のアカウントでのサインインの Cognito のトリガー（CUSTOM_AUTH・札 journey.photo-ios#601）。
 * 🔴 ここが true を返すと Cognito がトークンを出す。通してよいのは「`POST /auth/apple` が出した券が合い、
 *    期限内で、その券の行がこの Cognito の利用者を指していて、まだ使っていない」ときだけ
 */
const db = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../dynamodb", () => ({ ddb: db, PHOTOS_TABLE: "photos-test" }));

import { handler, CHALLENGE, type AuthChallengeEvent } from "../appleAuthTrigger";
import { federatedDeps, issueTicket, ticketAnswer } from "../federatedAccount";

let users = fakeUsersTable();

beforeEach(() => {
    users = fakeUsersTable();
    users.table.set("apple#001234.apple", { userId: "apple#001234.apple", cognitoUsername: "uuid-1", cognitoSub: "sub-1" });
    federatedDeps.now = () => Date.now();
    db.send.mockReset().mockImplementation(users.send);
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
    it("問いの中身は無い（答えは `POST /auth/apple` が出した券）", async () => {
        const r = (await handler(ev("CreateAuthChallenge_Authentication", { challengeName: CHALLENGE }))).response;
        expect(r.publicChallengeParameters).toEqual({ kind: "ticket" });
        expect(r.challengeMetadata).toBe("FEDERATED_TICKET");
    });
});

describe("Verify（券を照らして消す）", () => {
    it("出した券で、結ばれた利用者なら通し、券を消す", async () => {
        const answer = await issueTicket("apple", "001234.apple");
        expect(await verifyAnswer(answer)).toBe(true);
        expect(users.table.get("apple#001234.apple")!.ticketHash).toBeUndefined();
    });

    it("🔴 同じ券は2回目を通さない（使い回し）", async () => {
        const answer = await issueTicket("apple", "001234.apple");
        expect(await verifyAnswer(answer)).toBe(true);
        expect(await verifyAnswer(answer)).toBe(false);
    });

    it("🔴 Apple の identity token をそのまま答えても通らない（前の作りの抜け道）", async () => {
        await issueTicket("apple", "001234.apple");
        expect(await verifyAnswer(makeToken())).toBe(false);
    });

    it("🔴 その券の行が別の利用者を指していれば通さない（他人のアカウントに入れない）", async () => {
        const answer = await issueTicket("apple", "001234.apple");
        expect(await verifyAnswer(answer, "uuid-other")).toBe(false);
        expect(await verifyAnswer(answer, "uuid-1", "sub-other")).toBe(false);
        expect(await verifyAnswer(answer.replace("001234.apple", "unknown.apple"))).toBe(false);
    });

    it("期限切れ・違う券・形の壊れた答えは通さない", async () => {
        const answer = await issueTicket("apple", "001234.apple");
        expect(await verifyAnswer(ticketAnswer("apple", "001234.apple", "B".repeat(43)))).toBe(false);
        expect(await verifyAnswer(undefined)).toBe(false);
        expect(await verifyAnswer("garbage")).toBe(false);
        const t0 = Date.now();
        federatedDeps.now = () => t0 + 5 * 60 * 1000 + 1;
        expect(await verifyAnswer(answer)).toBe(false);
    });

    it("表が落ちても投げずに「通さない」で返す（投げると文が端末に出る）", async () => {
        const answer = await issueTicket("apple", "001234.apple");
        db.send.mockRejectedValue(Object.assign(new Error("boom"), { name: "InternalServerError" }));
        await expect(verifyAnswer(answer)).resolves.toBe(false);
    });
});

it("知らないトリガーは何もしない", async () => {
    const e = ev("PreSignUp_SignUp");
    expect((await handler(e)).response).toEqual({});
});
