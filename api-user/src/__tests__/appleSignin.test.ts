import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetAppleKeysCache } from "../appleIdToken";
import { CLIENT_ID, fakeApple, fakeUsersTable, makeToken, p8Pem } from "./appleTestKit";

/**
 * 「Apple でサインイン」の口（札 journey.photo-ios#601）と、提供元によらない土台（`federatedAccount.ts`）。
 * nonce の照らし・使い回し・券・結び方（同じ確かめ済みのメール・管理者・別の ID と結び済み・非公開のメール）・
 * 同時に2回・鍵が無いときを見る。users 表は条件式まで真似る（`fakeUsersTable`）
 */
const db = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../dynamodb", () => ({ ddb: db, PHOTOS_TABLE: "photos-test" }));

import { appleDeps, appleRevoker, getAppleSigninStatus, revokeTokenHandler, startAppleSignin } from "../appleSignin";
import { appleRevokeViaStack, revokeClientDeps } from "../federatedRevokeClient";
import {
    federatedDeps, cleanDisplayName, filterValue, randomPassword, consumeTicket, parseTicketAnswer, ticketAnswer,
    revokeLinkedTokens, markProfile, USER_GROUP, TICKET_TTL_MS, CLAIM_STALE_MS,
} from "../federatedAccount";

type Result = { statusCode: number; body: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
const call = (fn: unknown, event: unknown): Promise<Result> => (fn as any)(event, {}, () => undefined);
const bodyOf = (r: Result) => JSON.parse(r.body);

const cfg = { clientId: CLIENT_ID, teamId: "TEAM123456", keyId: "DDYJB5893J", privateKey: p8Pem };
const RAW = "raw-nonce-0123456789abcdef";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** アプリと同じ形: Apple には SHA-256、サーバーには元の値 */
const signIn = (claims: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, raw = RAW) =>
    call(startAppleSignin, { body: JSON.stringify({ identityToken: makeToken({ nonce: sha(raw), ...claims }), nonce: raw, ...extra }) });

const cmd = (c: unknown) => ({ name: (c as { constructor: { name: string } }).constructor.name, input: (c as { input: Record<string, any> }).input });
let idpCalls: { name: string; input: Record<string, any> }[] = [];
let idpReply: (name: string, input: Record<string, any>) => unknown;
let apple = fakeApple();
let users = fakeUsersTable();
let notified: { sub: string; provider: string }[] = [];
let nonceSeq = 0;
const freshRaw = () => `raw-nonce-${String(++nonceSeq).padStart(16, "0")}`;

beforeEach(() => {
    resetAppleKeysCache();
    users = fakeUsersTable();
    apple = fakeApple();
    idpCalls = [];
    notified = [];
    idpReply = () => ({});
    vi.stubEnv("APPLE_SIGNIN_READY", "true");
    appleDeps.config = async () => cfg;
    appleDeps.fetchImpl = apple.fetchImpl;
    appleDeps.webClientIds = () => [];
    federatedDeps.poolId = () => "ap-northeast-1_TEST";
    federatedDeps.now = () => Date.now();
    federatedDeps.notifyLinked = async (sub, provider) => { notified.push({ sub, provider }); };
    federatedDeps.idp = {
        send: async (c: unknown) => {
            const { name, input } = cmd(c);
            idpCalls.push({ name, input });
            return idpReply(name, input);
        },
    };
    db.send.mockReset().mockImplementation(users.send);
});
afterEach(() => vi.unstubAllEnvs());

/** Cognito の利用者の一覧の答え */
const listed = (list: { username: string; sub: string; verified?: boolean; status?: string; enabled?: boolean }[]) =>
    ({
        Users: list.map((u) => ({
            Username: u.username, Enabled: u.enabled ?? true, UserStatus: u.status ?? "CONFIRMED",
            Attributes: [{ Name: "sub", Value: u.sub }, { Name: "email_verified", Value: u.verified === false ? "false" : "true" }],
        })),
    });

/** 新しい利用者を作るときの Cognito の答え */
const createdReply = (name: string, input: Record<string, any>) => {
    if (name === "ListUsersCommand") return { Users: [] };
    if (name === "AdminCreateUserCommand") return { User: { Username: input.Username, Attributes: [{ Name: "sub", Value: "sub-new" }] } };
    return {};
};
const names = () => idpCalls.map((c) => c.name);

describe("使えるか（GET /auth/apple/status）", () => {
    it("deploy が渡す「そろっているか」の真偽とプールで決める（鍵は読まない）", async () => {
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: true });
        vi.stubEnv("APPLE_SIGNIN_READY", "");
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: false });
        vi.stubEnv("APPLE_SIGNIN_READY", "true");
        federatedDeps.poolId = () => "";
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: false });
    });
});

describe("使えるか: 鍵を SSM に置く形（本線）", () => {
    it("SSM から読めるかだけを見る（読めなければ false）。答えに鍵は出ない", async () => {
        vi.stubEnv("APPLE_SIGNIN_READY", "");
        vi.stubEnv("APPLE_SIGNIN_KEY_PARAM", "/journey-photo/prod/apple-signin/private-key");
        const res = await call(getAppleSigninStatus, {});
        expect(bodyOf(res)).toEqual({ available: true });
        expect(res.body).not.toContain("PRIVATE");
        appleDeps.config = async () => null;
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: false });
    });
});

describe("退会の取り消しを Apple のスタックに頼む（federatedRevokeClient・revokeTokenHandler）", () => {
    afterEach(() => {
        revokeClientDeps.functionName = () => (process.env.APPLE_REVOKE_FUNCTION ?? "").trim();
    });

    it("取り消しの関数は、渡された更新トークンを Apple に取り消しとして送るだけ。形の違う頼みは断る", async () => {
        expect(await revokeTokenHandler({ provider: "apple", refreshToken: "r.9" })).toEqual({ result: "revoked" });
        expect(new URLSearchParams(apple.calls.at(-1)!.body).get("token")).toBe("r.9");
        for (const bad of [{}, { provider: "google", refreshToken: "x" }, { provider: "apple", refreshToken: "" }, { provider: "apple", refreshToken: 1 }]) {
            expect(await revokeTokenHandler(bad as never)).toEqual({ result: "rejected" });
        }
    });

    it("user API 側は関数を呼んで結果を読む。関数が無い・権限が無いは unavailable、混雑・壊れた答えは failed", async () => {
        const calls: { fn: string; payload: string }[] = [];
        revokeClientDeps.functionName = () => "photo-gallery-apple-signin-prod-appleRevoke";
        revokeClientDeps.invoke = async (fn, payload) => { calls.push({ fn, payload }); return { payload: JSON.stringify(await revokeTokenHandler(JSON.parse(payload))) }; };
        expect(await appleRevokeViaStack("r.1")).toBe("revoked");
        expect(JSON.parse(calls[0].payload)).toEqual({ provider: "apple", refreshToken: "r.1" });
        appleDeps.fetchImpl = fakeApple({ revokeStatus: 400 }).fetchImpl;
        expect(await appleRevokeViaStack("r.1")).toBe("rejected");
        for (const name of ["ResourceNotFoundException", "AccessDeniedException"]) {
            revokeClientDeps.invoke = async () => { throw Object.assign(new Error("x"), { name }); };
            expect(await appleRevokeViaStack("r.1"), name).toBe("unavailable");
        }
        revokeClientDeps.invoke = async () => { throw Object.assign(new Error("x"), { name: "TooManyRequestsException" }); };
        expect(await appleRevokeViaStack("r.1")).toBe("failed");
        revokeClientDeps.invoke = async () => ({ functionError: "Unhandled" });
        expect(await appleRevokeViaStack("r.1")).toBe("failed");
        revokeClientDeps.invoke = async () => ({ payload: '{"result":"ok"}' });
        expect(await appleRevokeViaStack("r.1")).toBe("failed");
        revokeClientDeps.functionName = () => "";
        expect(await appleRevokeViaStack("r.1")).toBe("unavailable");
    });
});

describe("nonce と使い回し（2026-11-23 確かめ役の指摘 1）", () => {
    beforeEach(() => { idpReply = createdReply; });

    it("元の nonce の SHA-256 が token の nonce と同じなら通り、使い捨ての券を返す", async () => {
        const res = await signIn({ is_private_email: "true" });
        expect(res.statusCode).toBe(200);
        const b = bodyOf(res);
        expect(b.username).toMatch(/^[0-9a-f-]{36}$/);
        expect(parseTicketAnswer(b.challengeAnswer)).toMatchObject({ provider: "apple", sub: "001234.apple" });
        // 使った nonce は1回きりの行に残る（期限付き）
        expect(users.table.get(`nonce#apple#${sha(RAW)}`)).toMatchObject({ ttl: expect.any(Number) });
    });

    it("🔴 同じ token と元の nonce をもう一度送っても通らない（使い回し）", async () => {
        const token = makeToken({ nonce: sha(RAW), is_private_email: "true" });
        const body = JSON.stringify({ identityToken: token, nonce: RAW });
        expect((await call(startAppleSignin, { body })).statusCode).toBe(200);
        const before = idpCalls.length;
        const again = await call(startAppleSignin, { body });
        expect(again.statusCode).toBe(401);
        expect(bodyOf(again).code).toBe("apple_token_invalid");
        // 2回目は利用者を探しも作りもしない
        expect(idpCalls.length).toBe(before);
    });

    it("🔴 token だけ盗まれても通らない（元の nonce が無い・違う・token の nonce をそのまま送る）", async () => {
        const token = makeToken({ nonce: sha(RAW) });
        for (const nonce of [undefined, "", "x".repeat(20), sha(RAW), 123]) {
            const res = await call(startAppleSignin, { body: JSON.stringify({ identityToken: token, nonce }) });
            expect(res.statusCode, String(nonce)).toBe(401);
        }
        // nonce の無い token も通さない
        const noNonce = await call(startAppleSignin, { body: JSON.stringify({ identityToken: makeToken({ nonce: undefined }), nonce: RAW }) });
        expect(noNonce.statusCode).toBe(401);
        expect(idpCalls).toHaveLength(0);
    });
});

describe("券（CUSTOM_AUTH の答え）", () => {
    beforeEach(() => { idpReply = createdReply; });

    it("券の行には SHA-256 だけ。照らせば1回だけ通り、2回目は通らない", async () => {
        const b = bodyOf(await signIn({ is_private_email: "true" }));
        const row = users.table.get("apple#001234.apple")!;
        const ticket = parseTicketAnswer(b.challengeAnswer)!.ticket;
        expect(row.ticketHash).toBe(sha(ticket));
        expect(JSON.stringify(row)).not.toContain(ticket);
        expect(await consumeTicket(b.challengeAnswer, b.username, "sub-new")).toBe(true);
        expect(await consumeTicket(b.challengeAnswer, b.username, "sub-new")).toBe(false);
    });

    it("🔴 同じ券で同時に2回来ても、通るのは1回だけ（読んでから消すまでの間を条件で守る）", async () => {
        const b = bodyOf(await signIn({ is_private_email: "true" }));
        const results = await Promise.all([1, 2, 3].map(() => consumeTicket(b.challengeAnswer, b.username, "sub-new")));
        expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("🔴 違う券・期限切れ・別の利用者・形の壊れた答えは通らない", async () => {
        const b = bodyOf(await signIn({ is_private_email: "true" }));
        const p = parseTicketAnswer(b.challengeAnswer)!;
        const wrong = ticketAnswer("apple", p.sub, "A".repeat(43));
        expect(await consumeTicket(wrong, b.username, "sub-new")).toBe(false);
        expect(await consumeTicket(b.challengeAnswer, "someone-else", "sub-new")).toBe(false);
        expect(await consumeTicket(b.challengeAnswer, b.username, "sub-other")).toBe(false);
        for (const bad of [undefined, "", "apple", "apple:x", "evil:001234.apple:" + p.ticket, makeToken()]) {
            expect(await consumeTicket(bad, b.username, "sub-new"), String(bad)).toBe(false);
        }
        const t0 = Date.now();
        federatedDeps.now = () => t0 + TICKET_TTL_MS + 1;
        expect(await consumeTicket(b.challengeAnswer, b.username, "sub-new")).toBe(false);
        // 外したもので券は消えていない（期限内なら本人は使える）
        federatedDeps.now = () => t0;
        expect(await consumeTicket(b.challengeAnswer, b.username, "sub-new")).toBe(true);
    });

    it("新しくサインインすると、前の券は使えなくなる", async () => {
        const first = bodyOf(await signIn({ is_private_email: "true" }));
        await signIn({ is_private_email: "true" }, {}, freshRaw());
        expect(await consumeTicket(first.challengeAnswer, first.username, "sub-new")).toBe(false);
    });
});

describe("サインイン（POST /auth/apple）", () => {
    it("鍵が無い環境は 503 で「使えません」（Apple にも Cognito にも話しかけない）", async () => {
        appleDeps.config = async () => null;
        const res = await signIn();
        expect(res.statusCode).toBe(503);
        expect(bodyOf(res).code).toBe("apple_signin_unavailable");
        expect(apple.calls).toHaveLength(0);
        expect(idpCalls).toHaveLength(0);
    });

    it("確かめられない token は 401（利用者を作らない）", async () => {
        const res = await call(startAppleSignin, { body: JSON.stringify({ identityToken: makeToken({ aud: "evil", nonce: sha(RAW) }), nonce: RAW }) });
        expect(res.statusCode).toBe(401);
        expect(idpCalls).toHaveLength(0);
    });

    it("壊れた本文は 400", async () => {
        expect((await call(startAppleSignin, { body: "{" })).statusCode).toBe(400);
    });

    it("確かめ済みのメールが、確かめ済みのアカウントと同じなら、そのアカウントに結ぶ。持ち主の端末に知らせる", async () => {
        idpReply = (name) => (name === "ListUsersCommand" ? listed([{ username: "old-user", sub: "sub-old" }]) : { Groups: [] });
        users.table.set("sub-old", { userId: "sub-old", displayName: "前の名前" });
        const res = await signIn({}, { displayName: "山田 太郎" });
        expect(res.statusCode).toBe(200);
        expect(bodyOf(res)).toMatchObject({ username: "old-user", created: false });
        expect(names()).not.toContain("AdminCreateUserCommand");
        expect(users.table.get("apple#001234.apple")).toMatchObject({ cognitoUsername: "old-user", cognitoSub: "sub-old", linkedBy: "email" });
        // 名前は上書きしない
        expect(users.table.get("sub-old")).toMatchObject({ appleSub: "001234.apple", displayName: "前の名前" });
        expect(notified).toEqual([{ sub: "sub-old", provider: "apple" }]);
    });

    it("🔴 admin グループの人には、メールが同じでも自動で結ばない（新しいアカウント）", async () => {
        idpReply = (name, input) => {
            if (name === "ListUsersCommand") return listed([{ username: "admin-user", sub: "sub-admin" }]);
            if (name === "AdminListGroupsForUserCommand") return { Groups: [{ GroupName: "user" }, { GroupName: "admin" }] };
            // メールは管理者が持っているので、メール付きでは作れない（Cognito の別名の決まり）
            if (name === "AdminCreateUserCommand" && input.UserAttributes.length) throw Object.assign(new Error("alias"), { name: "AliasExistsException" });
            return createdReply(name, input);
        };
        const res = await signIn();
        expect(res.statusCode).toBe(200);
        expect(bodyOf(res).created).toBe(true);
        expect(users.table.get("apple#001234.apple")!.cognitoSub).toBe("sub-new");
        expect(users.table.get("sub-admin")).toBeUndefined();
        expect(notified).toHaveLength(0);
    });

    it("🔴 別の Apple ID と結び済みのアカウントには自動で結ばない。番号も上書きしない", async () => {
        idpReply = (name, input) => {
            if (name === "ListUsersCommand") return listed([{ username: "old-user", sub: "sub-old" }]);
            if (name === "AdminListGroupsForUserCommand") return { Groups: [] };
            if (name === "AdminCreateUserCommand") return createdReply(name, input);
            return {};
        };
        users.table.set("sub-old", { userId: "sub-old", appleSub: "999.other" });
        const res = await signIn();
        expect(bodyOf(res).created).toBe(true);
        expect(users.table.get("sub-old")!.appleSub).toBe("999.other");
    });

    it("🔴 プロフィールの番号は、別の Apple ID のものを上書きしない（同時に結んだときの守り）", async () => {
        users.table.set("sub-old", { userId: "sub-old", appleSub: "999.other" });
        await markProfile("apple", "sub-old", "001234.apple", undefined);
        expect(users.table.get("sub-old")!.appleSub).toBe("999.other");
        users.table.set("sub-2", { userId: "sub-2" });
        await markProfile("apple", "sub-2", "001234.apple", "名前");
        expect(users.table.get("sub-2")).toMatchObject({ appleSub: "001234.apple", displayName: "名前" });
    });

    it("同じメールでも、アカウント側のメールが確かめていなければ結ばない（新しいアカウント）", async () => {
        idpReply = (name, input) => (name === "ListUsersCommand"
            ? listed([{ username: "old-user", sub: "sub-old", verified: false }])
            : createdReply(name, input));
        const res = await signIn();
        expect(bodyOf(res).created).toBe(true);
        expect(names()).toContain("AdminCreateUserCommand");
    });

    it("Apple がメールを確かめていなければ、同じメールのアカウントを探さない", async () => {
        idpReply = createdReply;
        await signIn({ email_verified: "false" });
        expect(names()).not.toContain("ListUsersCommand");
    });

    it("メールを非公開にした人は新しいアカウント。確認済みにし、user グループに入れ、名前は初回に入れる", async () => {
        idpReply = createdReply;
        const res = await signIn({ email: "x@privaterelay.appleid.com", is_private_email: "true" }, { displayName: " 山田\n太郎 " });
        expect(res.statusCode).toBe(200);
        expect(bodyOf(res).created).toBe(true);
        expect(names()).not.toContain("ListUsersCommand");
        const create = idpCalls.find((c) => c.name === "AdminCreateUserCommand")!.input;
        expect(create.MessageAction).toBe("SUPPRESS");
        expect(idpCalls.find((c) => c.name === "AdminSetUserPasswordCommand")!.input.Permanent).toBe(true);
        expect(idpCalls.find((c) => c.name === "AdminAddUserToGroupCommand")!.input.GroupName).toBe(USER_GROUP);
        expect(users.table.get("sub-new")).toMatchObject({ displayName: "山田 太郎", appleSub: "001234.apple" });
    });

    it("2回目からは前に結んだアカウント（Cognito に居れば）。作らない・探さない", async () => {
        users.table.set("apple#001234.apple", { userId: "apple#001234.apple", cognitoUsername: "u1", cognitoSub: "s1" });
        const res = await signIn();
        expect(bodyOf(res)).toMatchObject({ username: "u1", created: false });
        expect(names()).toEqual(["AdminGetUserCommand"]);
    });

    it("前の回でプロフィールの書き込みが落ちていても、次のサインインで直る（無いときだけ作る・番号を書く）", async () => {
        users.table.set("apple#001234.apple", { userId: "apple#001234.apple", cognitoUsername: "u1", cognitoSub: "s1" });
        await signIn({}, { displayName: "山田" });
        expect(users.table.get("s1")).toMatchObject({ appleSub: "001234.apple", displayName: "山田" });
        // 本人が付けた名前は上書きしない
        users.table.set("s1", { userId: "s1", appleSub: "001234.apple", displayName: "自分の名前" });
        await signIn({}, { displayName: "山田" }, freshRaw());
        expect(users.table.get("s1")!.displayName).toBe("自分の名前");
    });

    it("前に結んだアカウントが退会で消えていたら、古い行を消して新しく作る", async () => {
        users.table.set("apple#001234.apple", { userId: "apple#001234.apple", cognitoUsername: "gone", cognitoSub: "s-gone" });
        idpReply = (name, input) => {
            if (name === "AdminGetUserCommand") throw Object.assign(new Error("nf"), { name: "UserNotFoundException" });
            return createdReply(name, input);
        };
        const res = await signIn({ is_private_email: "true" });
        expect(bodyOf(res).created).toBe(true);
        expect(users.table.get("apple#001234.apple")).toMatchObject({ cognitoSub: "sub-new" });
    });

    it("認可コードを Apple の更新トークンに替えて行に控える。答えに更新トークンは出さない", async () => {
        idpReply = createdReply;
        const res = await signIn({ is_private_email: "true" }, { authorizationCode: "c.1" });
        expect(users.table.get("apple#001234.apple")!.refreshToken).toBe("r.apple.1");
        expect(res.body).not.toContain("r.apple.1");
    });

    it("更新トークンが取れなくてもログインは止めない", async () => {
        apple = fakeApple({ tokenStatus: 400 });
        appleDeps.fetchImpl = apple.fetchImpl;
        idpReply = createdReply;
        const res = await signIn({ is_private_email: "true" }, { authorizationCode: "c.1" });
        expect(res.statusCode).toBe(200);
        expect(users.table.get("apple#001234.apple")!.refreshToken).toBeUndefined();
    });
});

describe("「サインインの方法」で解除した Apple ID（2026-11-23 確かめ役の見直し）", () => {
    it("🔴 解除して行を残した ID で入り直すと 409（code apple_signin_unlinked）。Cognito に何も作らない", async () => {
        idpReply = createdReply;
        users.table.set("sub-me", { userId: "sub-me" });
        users.table.set("apple#001234.apple", {
            userId: "apple#001234.apple", provider: "apple", cognitoUsername: "u-me", cognitoSub: "sub-me", unlinkedAt: "2026-11-23T00:00:00Z",
        });
        const res = await signIn({ is_private_email: "true" });
        expect(res.statusCode).toBe(409);
        expect(bodyOf(res)).toEqual({
            error: "この Apple ID の連携は解除されています。メールアドレスでログインしてください",
            code: "apple_signin_unlinked",
        });
        expect(names()).not.toContain("AdminCreateUserCommand");
    });
});

describe("同時に2回来たとき（2026-11-23 確かめ役の指摘）", () => {
    it("🔴 先に行を取った回だけが利用者を作る。後の回は 409 で、Cognito に何も作らない", async () => {
        idpReply = createdReply;
        users.table.set("apple#001234.apple", { userId: "apple#001234.apple", provider: "apple", claimedAt: Date.now() });
        const res = await signIn({ is_private_email: "true" });
        expect(res.statusCode).toBe(409);
        expect(bodyOf(res).code).toBe("apple_signin_busy");
        expect(names()).not.toContain("AdminCreateUserCommand");
    });

    it("🔴 2つの端末で同時に押しても、Cognito の利用者は1人しか作らない", async () => {
        idpReply = createdReply;
        const results = await Promise.all([signIn({ is_private_email: "true" }, {}, freshRaw()), signIn({ is_private_email: "true" }, {}, freshRaw())]);
        expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
        expect(names().filter((n) => n === "AdminCreateUserCommand")).toHaveLength(1);
    });

    it("落ちた回の古い印は取り直せる", async () => {
        idpReply = createdReply;
        users.table.set("apple#001234.apple", { userId: "apple#001234.apple", provider: "apple", claimedAt: Date.now() - CLAIM_STALE_MS - 1 });
        expect((await signIn({ is_private_email: "true" })).statusCode).toBe(200);
    });

    it("🔴 作ったあとで行に書けなかったら、作った利用者を消し、印も外す（結び先の無い利用者を残さない）", async () => {
        idpReply = createdReply;
        db.send.mockImplementation(async (c: unknown) => {
            const { name, input } = cmd(c);
            if (name === "UpdateCommand" && input.UpdateExpression?.startsWith("SET cognitoUsername")) {
                throw Object.assign(new Error("boom"), { name: "InternalServerError" });
            }
            return users.send(c);
        });
        const res = await signIn({ is_private_email: "true" });
        expect(res.statusCode).toBe(500);
        const created = idpCalls.find((c) => c.name === "AdminCreateUserCommand")!.input.Username;
        expect(idpCalls.find((c) => c.name === "AdminDeleteUserCommand")?.input.Username).toBe(created);
        expect(users.table.has("apple#001234.apple")).toBe(false);
    });

    it("🔴 メールで結んだ回で行に書けなかったら、印は外すが、結んだ相手（既にある利用者）は消さない", async () => {
        idpReply = (name) => (name === "ListUsersCommand" ? listed([{ username: "old-user", sub: "sub-old" }]) : { Groups: [] });
        db.send.mockImplementation(async (c: unknown) => {
            const { name, input } = cmd(c);
            if (name === "UpdateCommand" && input.UpdateExpression?.startsWith("SET cognitoUsername")) {
                throw Object.assign(new Error("boom"), { name: "InternalServerError" });
            }
            return users.send(c);
        });
        expect((await signIn()).statusCode).toBe(500);
        expect(names()).not.toContain("AdminDeleteUserCommand");
        expect(users.table.has("apple#001234.apple")).toBe(false);
    });

    it("作る途中（パスワード・グループ）で落ちても、作りかけの利用者を消す", async () => {
        idpReply = (name, input) => {
            if (name === "AdminAddUserToGroupCommand") throw Object.assign(new Error("x"), { name: "TooManyRequestsException" });
            return createdReply(name, input);
        };
        expect((await signIn({ is_private_email: "true" })).statusCode).toBe(500);
        expect(names()).toContain("AdminDeleteUserCommand");
        expect(users.table.has("apple#001234.apple")).toBe(false);
    });
});

describe("退会のときの取り消し（appleRevoker・revokeLinkedTokens）", () => {
    it("Apple に更新トークンを取り消しとして送る。成功で revoked、失敗で failed、鍵が無ければ unavailable", async () => {
        expect(await appleRevoker("r.1")).toBe("revoked");
        expect(new URLSearchParams(apple.calls.at(-1)!.body).get("token")).toBe("r.1");
        appleDeps.fetchImpl = fakeApple({ revokeStatus: 500 }).fetchImpl;
        expect(await appleRevoker("r.1")).toBe("failed");
        appleDeps.fetchImpl = fakeApple({ revokeStatus: 503 }).fetchImpl;
        expect(await appleRevoker("r.1")).toBe("failed");
        // 🔴 4xx は断られた（やり直しても変わらない）。退会を止めない側
        for (const status of [400, 401, 403]) {
            appleDeps.fetchImpl = fakeApple({ revokeStatus: status }).fetchImpl;
            expect(await appleRevoker("r.1"), String(status)).toBe("rejected");
        }
        appleDeps.fetchImpl = async () => { throw new Error("net"); };
        expect(await appleRevoker("r.1")).toBe("failed");
        appleDeps.config = async () => null;
        expect(await appleRevoker("r.1")).toBe("unavailable");
    });

    it("🔴 Apple が 4xx で断っても退会は止めない（true）。見張りに出し、トークンは行に残す", async () => {
        users.table.set("apple#a", { userId: "apple#a", cognitoSub: "me", cognitoUsername: "u", refreshToken: "r.1" });
        appleDeps.fetchImpl = fakeApple({ revokeStatus: 400 }).fetchImpl;
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        expect(await revokeLinkedTokens("me", { appleSub: "a" }, { apple: appleRevoker })).toBe(true);
        expect(err.mock.calls.some((c) => String(c[0]).includes("rejected"))).toBe(true);
        err.mockRestore();
        expect(users.table.get("apple#a")!.refreshToken).toBe("r.1");
        // 5xx は止める（やり直せば通る）
        appleDeps.fetchImpl = fakeApple({ revokeStatus: 502 }).fetchImpl;
        expect(await revokeLinkedTokens("me", { appleSub: "a" }, { apple: appleRevoker })).toBe(false);
    });

    it("取り消したら行からトークンだけ消す（結び付けは残す）。何度呼んでも同じ", async () => {
        users.table.set("apple#a", { userId: "apple#a", cognitoSub: "me", cognitoUsername: "u", refreshToken: "r.1" });
        const revoke = vi.fn(async () => "revoked" as const);
        expect(await revokeLinkedTokens("me", { appleSub: "a" }, { apple: revoke })).toBe(true);
        expect(await revokeLinkedTokens("me", { appleSub: "a" }, { apple: revoke })).toBe(true);
        expect(revoke).toHaveBeenCalledTimes(1);
        expect(users.table.get("apple#a")).toMatchObject({ cognitoSub: "me" });
        expect(users.table.get("apple#a")!.refreshToken).toBeUndefined();
    });
});

describe("小さな部品", () => {
    it("名前は空白を整え、100 字で切る。空なら無し", () => {
        expect(cleanDisplayName("  山田\t太郎 ")).toBe("山田 太郎");
        expect(cleanDisplayName("あ".repeat(150))).toHaveLength(100);
        expect(cleanDisplayName("   ")).toBeUndefined();
        expect(cleanDisplayName(1)).toBeUndefined();
    });

    it("検索の絞り込みの値は \" と \\ を逃がす", () => {
        expect(filterValue('a"b\\c')).toBe('a\\"b\\\\c');
    });

    it("本人も知らないパスワードはプールの決まり（大小英字・数字・記号）を満たし、毎回違う", () => {
        const a = randomPassword();
        expect(a).toMatch(/[a-z]/);
        expect(a).toMatch(/[A-Z]/);
        expect(a).toMatch(/[0-9]/);
        expect(a).toMatch(/[^A-Za-z0-9]/);
        expect(a.length).toBeGreaterThanOrEqual(40);
        expect(randomPassword()).not.toBe(a);
    });

    it("db の命令は users 表だけに向く", async () => {
        idpReply = createdReply;
        await signIn({ is_private_email: "true" });
        for (const c of db.send.mock.calls) expect(cmd(c[0]).input.TableName).toBe("test-photo-gallery-users");
    });
});

describe("配り方（serverless.apple-signin.yml・deploy-api.yml・serverless.yml）", () => {
    const root = join(__dirname, "..", "..", "..");
    const yml = readFileSync(join(root, "api-user", "serverless.apple-signin.yml"), "utf8");
    const userYml = readFileSync(join(root, "api-user", "serverless.yml"), "utf8");
    const wf = readFileSync(join(root, ".github", "workflows", "deploy-api.yml"), "utf8");
    const fnBlock = (name: string) => yml.slice(yml.indexOf(`  ${name}:`), yml.indexOf("\n  # ", yml.indexOf(`  ${name}:`) + 5));
    const step = wf.slice(wf.indexOf("- name: Serverless deploy（Apple でサインイン"), wf.indexOf("- name: Serverless deploy\n", wf.indexOf("Apple でサインイン・別スタック")));

    it("🔴 スタックは明示の切り替え（変数 APPLE_SIGNIN_ENABLED が true）のときだけ配る。既定は配らない", () => {
        expect(step).toContain("if: ${{ vars.APPLE_SIGNIN_ENABLED == 'true' }}");
        // 鍵の有無では決めない（鍵はもうある）
        expect(step).not.toMatch(/exit 0/);
    });

    it("鍵は APNs の鍵（Secrets の APNS_PRIVATE_KEY）。専用の鍵の Secrets は使わない。1行にした値はログで伏せる", () => {
        expect(step).toContain("secrets.APNS_PRIVATE_KEY");
        expect(wf).not.toContain("APPLE_SIGNIN_PRIVATE_KEY");
        expect(wf).not.toContain("APPLE_SIGNIN_KEY_ID");
        expect(step).toMatch(/echo "::add-mask::\$apns_key"\n\s+extra\+=\(--param "apnsPrivateKey=\$apns_key"\)/);
    });

    it("🔴 使えるかの口には鍵を配らない（真偽だけ）", () => {
        const status = fnBlock("appleSigninStatus");
        expect(status).toContain("APPLE_SIGNIN_READY: ${param:appleSigninReady, 'false'}");
        expect(status).not.toMatch(/PRIVATE_KEY|apnsPrivateKey/);
    });

    it("取り消しの口は無い（退会の中で取り消す）", () => {
        expect(yml).not.toContain("/auth/apple/revoke");
    });

    it("🔴 鍵の置き場を決めるのは deploy-api.yml の1か所（APPLE_SIGNIN_KEY_SOURCE・本線は ssm）。user API には鍵を置かない", () => {
        expect(wf.match(/^\s+APPLE_SIGNIN_KEY_SOURCE: (\w+)$/gm)).toEqual(["      APPLE_SIGNIN_KEY_SOURCE: ssm"]);
        expect(step).toContain('appleSigninKeyParam=/journey-photo/${{ needs.config.outputs.envName }}/apple-signin/private-key');
        const del = userYml.slice(userYml.indexOf("  deleteAccount:"), userYml.indexOf("\n  # ", userYml.indexOf("  deleteAccount:") + 5));
        expect(del).not.toMatch(/APNS_PRIVATE_KEY|apnsPrivateKey|APPLE_SIGNIN_KEY_PARAM/);
        expect(del).toContain("APPLE_REVOKE_FUNCTION: photo-gallery-apple-signin-${sls:stage}-appleRevoke");
        // 呼べるのはその1つの関数だけ（退会だけの役・`appleRevokeInvokeScope.test.ts`）
        const pol = userYml.slice(userYml.indexOf("    DeleteAccountRole:"), userYml.indexOf("  Outputs:"));
        expect(pol).toMatch(/- lambda:InvokeFunction\n\s+Resource:\n\s+- arn:aws:lambda:\$\{aws:region\}:\$\{aws:accountId\}:function:photo-gallery-apple-signin-\$\{sls:stage\}-appleRevoke\n/);
        expect(yml).toMatch(/^  appleRevoke:\n\s+handler: src\/appleSignin.revokeTokenHandler/m);
    });

    it("🔴 退会の取り消しの関数が落ち続けたら鳴る（定義だけ。知らせ先は alarmTopicArn を渡したときだけ）", () => {
        const alarm = yml.slice(yml.indexOf("    AppleRevokeErrorsAlarm:"), yml.indexOf("\n    # ", yml.indexOf("    AppleRevokeErrorsAlarm:")));
        expect(alarm).toContain("Type: AWS::CloudWatch::Alarm");
        expect(alarm).toMatch(/MetricName: Errors/);
        expect(alarm).toContain("Value: ${self:service}-${sls:stage}-appleRevoke");
        expect(alarm).toMatch(/- HasAlarmTopic/);
    });

    it("🔴 サインインの口は知らせの鍵を持たない。知らせは linkNotice に頼む（Apple の口の鍵は認可コードの交換のためだけ）", () => {
        const start = fnBlock("appleSigninStart");
        expect(start).not.toMatch(/APNS_TOPIC|APNS_HOST/);
        expect(start).toContain("FEDERATED_NOTICE_FUNCTION: ${self:service}-${sls:stage}-linkNotice");
        expect(yml).toMatch(/^  linkNotice:\n\s+handler: src\/federatedNotice.linkNoticeHandler/m);
    });

    it("🔴 POST /auth/apple は段の流量で絞る（スタックを配る環境だけ）", () => {
        const settings = userYml.slice(userYml.indexOf("  Conditions:"));
        expect(settings).toMatch(/AppleSigninOn:\n\s+Fn::Equals: \["\$\{param:appleSigninEnabled, 'false'\}", "true"\]/);
        expect(settings).toMatch(/- AppleSigninOn\n[\s\S]*"POST \/auth\/apple":\n\s+ThrottlingRateLimit: \d+\n\s+ThrottlingBurstLimit: \d+/);
        expect(wf).toMatch(/if \[ "\$\{APPLE_SIGNIN_ENABLED:-\}" = "true" \]; then extra\+=\(--param "appleSigninEnabled=true"\); fi/);
    });
});

describe("Web の「Apple でサインイン」（Services ID・札 journey.photo-ios#730）", () => {
    const WEB = "com.journeyphoto.web";
    const bodyOfCall = (c: { body?: string }) => new URLSearchParams(c.body ?? "");

    it("🔴 Services ID が無い間は、Web あての token を断り、status も Web の ID を返さない（今までどおり iOS だけ）", async () => {
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: true });
        idpReply = createdReply;
        expect((await signIn({ aud: WEB })).statusCode).toBe(401);
    });

    it("Services ID があれば、status が Web の ID を返す。鍵が無い環境では返さない", async () => {
        appleDeps.webClientIds = () => [WEB];
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: true, webClientId: WEB });
        vi.stubEnv("APPLE_SIGNIN_READY", "false");
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: false });
    });

    it("Web あての token を通し、認可コードは Services ID で替え、行に宛先を残す", async () => {
        appleDeps.webClientIds = () => [WEB];
        idpReply = createdReply;
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const res = await signIn({ aud: WEB, is_private_email: "true" }, { authorizationCode: "c.web" });
        expect(res.statusCode).toBe(200);
        const token = apple.calls.find((c) => c.url.endsWith("/auth/token"))!;
        expect(bodyOfCall(token).get("client_id")).toBe(WEB);
        // client secret の sub も Services ID（Apple は client_id と sub が同じことを求める）
        const secret = bodyOfCall(token).get("client_secret")!;
        expect(JSON.parse(Buffer.from(secret.split(".")[1], "base64url").toString()).sub).toBe(WEB);
        expect(users.table.get("apple#001234.apple")).toMatchObject({ refreshToken: "r.apple.1", refreshClientId: WEB });
        expect(log.mock.calls.map((c) => String(c[0]))).toContain(JSON.stringify({ metric: "signup", platform: "web", from: "apple" }));
        log.mockRestore();
    });

    it("iOS の token は今までどおり Bundle ID で替え、行にも Bundle ID を残す", async () => {
        appleDeps.webClientIds = () => [WEB];
        idpReply = createdReply;
        await signIn({ is_private_email: "true" }, { authorizationCode: "c.ios" });
        const token = apple.calls.find((c) => c.url.endsWith("/auth/token"))!;
        expect(bodyOfCall(token).get("client_id")).toBe(CLIENT_ID);
        expect(users.table.get("apple#001234.apple")!.refreshClientId).toBe(CLIENT_ID);
    });

    it("🔴 別の宛先（知らない Services ID）の token は断る", async () => {
        appleDeps.webClientIds = () => [WEB];
        expect((await signIn({ aud: "com.evil.web" })).statusCode).toBe(401);
    });

    it("退会の取り消しは、行の宛先で頼む。宛先の無い前からの行は Bundle ID。知らない宛先では頼まない", async () => {
        appleDeps.webClientIds = () => [WEB];
        expect(await appleRevoker("r.web", WEB)).toBe("revoked");
        expect(await appleRevoker("r.ios")).toBe("revoked");
        const revokes = apple.calls.filter((c) => c.url.endsWith("/auth/revoke")).map((c) => bodyOfCall(c).get("client_id"));
        expect(revokes).toEqual([WEB, CLIENT_ID]);
        expect(await appleRevoker("r.x", "com.evil.web")).toBe("rejected");
        expect(apple.calls.filter((c) => c.url.endsWith("/auth/revoke"))).toHaveLength(2);
    });

    it("revokeLinkedTokens と取り消しの関数は、行の宛先をそのまま渡す", async () => {
        appleDeps.webClientIds = () => [WEB];
        users.table.set("apple#a", { userId: "apple#a", cognitoSub: "me", cognitoUsername: "u", refreshToken: "r.1", refreshClientId: WEB });
        expect(await revokeLinkedTokens("me", { appleSub: "a" }, { apple: appleRevoker })).toBe(true);
        expect(bodyOfCall(apple.calls.find((c) => c.url.endsWith("/auth/revoke"))!).get("client_id")).toBe(WEB);
        expect(await revokeTokenHandler({ provider: "apple", refreshToken: "r.2", clientId: WEB })).toEqual({ result: "revoked" });
        for (const bad of [1, "", "x".repeat(300)]) {
            expect(await revokeTokenHandler({ provider: "apple", refreshToken: "r.3", clientId: bad })).toEqual({ result: "rejected" });
        }
    });

    it("🔴 Web の ID（Services ID）は本番だけに渡す（戻り先は本番のドメインだけ）", () => {
        const root = join(__dirname, "..", "..", "..");
        const yml = readFileSync(join(root, "api-user", "serverless.apple-signin.yml"), "utf8");
        const wf = readFileSync(join(root, ".github", "workflows", "deploy-api.yml"), "utf8");
        expect(yml).toContain("APPLE_SIGNIN_WEB_CLIENT_ID: ${param:appleSigninWebClientId, ''}");
        expect(wf).toContain("APPLE_SIGNIN_WEB_CLIENT_ID: ${{ needs.config.outputs.envName == 'prod' && 'com.journeyphoto.web' || '' }}");
        expect(wf).not.toContain("appleSigninWebClientId=${");
    });
});
