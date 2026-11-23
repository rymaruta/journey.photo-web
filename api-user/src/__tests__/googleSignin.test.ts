import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeGoogle, fakeUsersTable, makeGoogleToken, GOOGLE_CLIENT_ID, otherPrivate, CLIENT_ID } from "./appleTestKit";

/**
 * 「Google でログイン」（札 journey.photo-ios#715）。Apple と同じ土台（`federatedAccount.ts`）に乗る。
 * ID トークンの確かめ（発行元2つ・宛先・期限・署名）・nonce・結び方（Gmail と Workspace だけメールで結ぶ）・券・退会を見る
 */
const db = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../dynamodb", () => ({ ddb: db, PHOTOS_TABLE: "photos-test" }));

import { googleDeps, getGoogleSigninStatus, startGoogleSignin } from "../googleSignin";
import { verifyGoogleIdToken, resetGoogleKeysCache, GoogleTokenError } from "../googleIdToken";
import { KEYS_REFETCH_MIN_MS } from "../oidcToken";
import { consumeTicket, federatedDeps, parseTicketAnswer, unlinkAfterDelete, revokeLinkedTokens } from "../federatedAccount";

type Result = { statusCode: number; body: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
const call = (fn: unknown, event: unknown): Promise<Result> => (fn as any)(event, {}, () => undefined);
const bodyOf = (r: Result) => JSON.parse(r.body);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const cmd = (c: unknown) => ({ name: (c as { constructor: { name: string } }).constructor.name, input: (c as { input: Record<string, any> }).input });

let users = fakeUsersTable();
let google = fakeGoogle();
let idpCalls: { name: string; input: Record<string, any> }[] = [];
let idpReply: (name: string, input: Record<string, any>) => unknown;
let seq = 0;
const raw = () => `google-raw-nonce-${String(++seq).padStart(12, "0")}`;
const signIn = (claims: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const r = raw();
    return call(startGoogleSignin, { body: JSON.stringify({ idToken: makeGoogleToken({ nonce: sha(r), ...claims }), nonce: r, ...extra }) });
};
const createdReply = (name: string, input: Record<string, any>) => {
    if (name === "ListUsersCommand") return { Users: [] };
    if (name === "AdminCreateUserCommand") return { User: { Username: input.Username, Attributes: [{ Name: "sub", Value: "sub-new" }] } };
    return {};
};
const listedOld = () => ({
    Users: [{ Username: "old-user", Enabled: true, UserStatus: "CONFIRMED",
        Attributes: [{ Name: "sub", Value: "sub-old" }, { Name: "email_verified", Value: "true" }] }],
});
const names = () => idpCalls.map((c) => c.name);

beforeEach(() => {
    resetGoogleKeysCache();
    users = fakeUsersTable();
    google = fakeGoogle();
    idpCalls = [];
    idpReply = createdReply;
    googleDeps.fetchImpl = google.fetchImpl;
    googleDeps.clientIds = () => [GOOGLE_CLIENT_ID];
    federatedDeps.poolId = () => "ap-northeast-1_TEST";
    federatedDeps.now = () => Date.now();
    federatedDeps.notifyLinked = async () => undefined;
    federatedDeps.idp = { send: async (c: unknown) => { const { name, input } = cmd(c); idpCalls.push({ name, input }); return idpReply(name, input); } };
    db.send.mockReset().mockImplementation(users.send);
});
afterEach(() => vi.unstubAllEnvs());

describe("ID トークンの確かめ", () => {
    const verifyWith = (token: string, now?: number) => verifyGoogleIdToken(token, { clientIds: [GOOGLE_CLIENT_ID], fetchImpl: google.fetchImpl, now });
    const reason = async (p: Promise<unknown>) => p.then(() => "通った", (e) => { expect(e).toBeInstanceOf(GoogleTokenError); return (e as GoogleTokenError).reason; });

    it("Google の鍵で署名された、このアプリあての token を通す。発行元は2つの書き方のどちらも受ける", async () => {
        await expect(verifyWith(makeGoogleToken())).resolves.toMatchObject({ sub: "1098765432101234567890", emailVerified: true, emailAuthoritative: true });
        await expect(verifyWith(makeGoogleToken({ iss: "accounts.google.com" }))).resolves.toMatchObject({ sub: "1098765432101234567890" });
    });

    it("🔴 別の発行元（Apple を含む）・別のアプリあて・期限切れ・別の鍵の署名は落とす", async () => {
        expect(await reason(verifyWith(makeGoogleToken({ iss: "https://appleid.apple.com" })))).toBe("iss");
        expect(await reason(verifyWith(makeGoogleToken({ iss: "https://evil.example" })))).toBe("iss");
        expect(await reason(verifyWith(makeGoogleToken({ aud: CLIENT_ID })))).toBe("aud");
        expect(await reason(verifyWith(makeGoogleToken({ aud: [GOOGLE_CLIENT_ID] })))).toBe("aud");
        const old = Math.floor(Date.now() / 1000) - 3600;
        expect(await reason(verifyWith(makeGoogleToken({ iat: old, exp: old + 60 })))).toBe("expired");
        expect(await reason(verifyWith(makeGoogleToken({}, { key: otherPrivate })))).toBe("signature");
        expect(await reason(verifyWith(makeGoogleToken({}, { header: { alg: "none" } })))).toBe("alg");
    });

    it("🔴 自動で結んでよいメールは、確かめ済みの Gmail と Google Workspace（hd）のものだけ", async () => {
        await expect(verifyWith(makeGoogleToken({ email: "a@example.com" }))).resolves.toMatchObject({ emailVerified: true, emailAuthoritative: false });
        await expect(verifyWith(makeGoogleToken({ email: "a@corp.example", hd: "corp.example" }))).resolves.toMatchObject({ emailAuthoritative: true });
        await expect(verifyWith(makeGoogleToken({ email_verified: false }))).resolves.toMatchObject({ emailVerified: false, emailAuthoritative: false });
    });

    it("🔴 知らない kid を送り続けても、Google への取り直しは 60 秒に1回まで", async () => {
        const t0 = Date.now();
        for (let i = 0; i < 10; i++) expect(await reason(verifyWith(makeGoogleToken({}, { header: { kid: "NOPE" } }), t0 + i * 1000))).toBe("unknown kid");
        expect(google.calls).toHaveLength(1);
        await reason(verifyWith(makeGoogleToken({}, { header: { kid: "NOPE" } }), t0 + KEYS_REFETCH_MIN_MS));
        expect(google.calls).toHaveLength(2);
    });
});

describe("ログイン（POST /auth/google）", () => {
    it("使えるかは、クライアント ID とプールがそろっているか", async () => {
        expect(bodyOf(await call(getGoogleSigninStatus, {}))).toEqual({ available: true });
        googleDeps.clientIds = () => [];
        expect(bodyOf(await call(getGoogleSigninStatus, {}))).toEqual({ available: false });
        expect((await signIn()).statusCode).toBe(503);
    });

    it("元の nonce を照らして通り、券を返す。券は Cognito のトリガーで1回だけ通る", async () => {
        const res = await signIn({ email: "x@example.com" });
        expect(res.statusCode).toBe(200);
        const b = bodyOf(res);
        expect(parseTicketAnswer(b.challengeAnswer)).toMatchObject({ provider: "google", sub: "1098765432101234567890" });
        expect(await consumeTicket(b.challengeAnswer, b.username, "sub-new")).toBe(true);
        expect(await consumeTicket(b.challengeAnswer, b.username, "sub-new")).toBe(false);
        expect(users.table.get("google#1098765432101234567890")).toMatchObject({ provider: "google", cognitoSub: "sub-new" });
        expect(users.table.get("sub-new")).toMatchObject({ googleSub: "1098765432101234567890", displayName: "山田 太郎" });
    });

    it("🔴 同じ token と元の nonce の使い回し・元の nonce の無い token は通らない", async () => {
        const r = raw();
        const body = JSON.stringify({ idToken: makeGoogleToken({ nonce: sha(r), email: "x@example.com" }), nonce: r });
        expect((await call(startGoogleSignin, { body })).statusCode).toBe(200);
        expect((await call(startGoogleSignin, { body })).statusCode).toBe(401);
        const noRaw = JSON.stringify({ idToken: makeGoogleToken({ nonce: sha(r) }) });
        expect((await call(startGoogleSignin, { body: noRaw })).statusCode).toBe(401);
        const noNonce = JSON.stringify({ idToken: makeGoogleToken(), nonce: raw() });
        expect((await call(startGoogleSignin, { body: noNonce })).statusCode).toBe(401);
    });

    it("🔴 Apple の券を Google の行で使えない（提供元で行が分かれる）", async () => {
        const b = bodyOf(await signIn({ email: "x@example.com" }));
        const forged = b.challengeAnswer.replace(/^google:/, "apple:");
        expect(await consumeTicket(forged, b.username, "sub-new")).toBe(false);
    });

    it("確かめ済みの Gmail が、確かめ済みのアカウントと同じなら結ぶ", async () => {
        idpReply = (name) => (name === "ListUsersCommand" ? listedOld() : { Groups: [] });
        const res = await signIn();
        expect(bodyOf(res)).toMatchObject({ username: "old-user", created: false });
        expect(names()).not.toContain("AdminCreateUserCommand");
    });

    it("🔴 Gmail でも Workspace でもないメールでは、同じメールのアカウントを探さない（新しく作る）", async () => {
        idpReply = (name, input) => (name === "ListUsersCommand" ? listedOld() : createdReply(name, input));
        const res = await signIn({ email: "taro@example.com" });
        expect(bodyOf(res).created).toBe(true);
        expect(names()).not.toContain("ListUsersCommand");
    });

    it("同時に2回来たら、後の回は 409（google_signin_busy）", async () => {
        users.table.set("google#1098765432101234567890", { userId: "google#1098765432101234567890", provider: "google", claimedAt: Date.now() });
        const res = await signIn({ email: "x@example.com" });
        expect(res.statusCode).toBe(409);
        expect(bodyOf(res).code).toBe("google_signin_busy");
    });
});

describe("退会", () => {
    it("Google は更新トークンを持たないので取り消さない。行と墓石の番号は片付ける", async () => {
        users.table.set("google#g1", { userId: "google#g1", cognitoSub: "me", cognitoUsername: "u" });
        users.table.set("me", { userId: "me", deletedAt: "x", googleSub: "g1" });
        const revoke = vi.fn();
        expect(await revokeLinkedTokens("me", { googleSub: "g1" }, { apple: revoke })).toBe(true);
        expect(revoke).not.toHaveBeenCalled();
        await unlinkAfterDelete("me", { googleSub: "g1" }, 1);
        expect(users.table.has("google#g1")).toBe(false);
        expect(users.table.get("me")!.googleSub).toBeUndefined();
    });
});

describe("配り方（serverless.google-signin.yml・deploy-api.yml）", () => {
    const root = join(__dirname, "..", "..", "..");
    const yml = readFileSync(join(root, "api-user", "serverless.google-signin.yml"), "utf8");
    const appleYml = readFileSync(join(root, "api-user", "serverless.apple-signin.yml"), "utf8");
    const userYml = readFileSync(join(root, "api-user", "serverless.yml"), "utf8");
    const wf = readFileSync(join(root, ".github", "workflows", "deploy-api.yml"), "utf8");

    it("🔴 Google の段は GOOGLE_SIGNIN_ENABLED と APPLE_SIGNIN_ENABLED の両方が true のときだけ（トリガーは Apple のスタック・審査 4.8）", () => {
        expect(wf).toContain("if: ${{ vars.GOOGLE_SIGNIN_ENABLED == 'true' && vars.APPLE_SIGNIN_ENABLED == 'true' }}");
        expect(appleYml).toMatch(/dynamodb:LeadingKeys:\n\s+- apple#\*\n\s+- google#\*/);
    });

    it("宛先は iOS のクライアント ID（公開の値）。トリガーは足さない（Cognito のプールは Apple のスタックだけが変える）", () => {
        expect(wf).toContain(GOOGLE_CLIENT_ID);
        expect(yml).not.toContain("cognitoUserPool:");
        expect(yml).toMatch(/path: \/auth\/google\n\s+method: POST/);
    });

    it("🔴 POST /auth/google も段の流量で絞る（両方配る環境だけ）", () => {
        expect(userYml).toMatch(/GoogleSigninOn:\n\s+Fn::And:/);
        expect(userYml).toMatch(/"POST \/auth\/google":\n\s+ThrottlingRateLimit: \d+\n\s+ThrottlingBurstLimit: \d+/);
    });
});
