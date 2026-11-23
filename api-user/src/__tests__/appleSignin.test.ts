import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetAppleKeysCache } from "../appleIdToken";
import { CLIENT_ID, fakeApple, makeToken, p8Pem } from "./appleTestKit";

/**
 * 「Apple でサインイン」の口（札 journey.photo-ios#601）。
 * 結び方（同じ確かめ済みのメール・非公開のメール・前に結んだ人）・取り消し・鍵が無いときを見る
 */
const db = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../dynamodb", () => ({ ddb: db, PHOTOS_TABLE: "photos-test" }));

import {
    appleDeps, getAppleSigninStatus, startAppleSignin, revokeAppleSignin, cleanDisplayName, filterValue,
    randomPassword, USER_GROUP,
} from "../appleSignin";

type Result = { statusCode: number; body: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
const call = (fn: unknown, event: unknown): Promise<Result> => (fn as any)(event, {}, () => undefined);
const bodyOf = (r: Result) => JSON.parse(r.body);
const post = (body: unknown) => ({ body: JSON.stringify(body) });
const authed = (sub: string) => ({ requestContext: { authorizer: { jwt: { claims: { sub } } } } });

const cfg = { clientId: CLIENT_ID, teamId: "TEAM123456", keyId: "KEY1234567", privateKey: p8Pem };

/** 命令の名前と中身 */
const cmd = (c: unknown) => ({ name: (c as { constructor: { name: string } }).constructor.name, input: (c as { input: Record<string, any> }).input });
const dbCalls = () => db.send.mock.calls.map((c) => cmd(c[0]));
let idpCalls: { name: string; input: Record<string, any> }[] = [];
let idpReply: (name: string, input: Record<string, any>) => unknown;
let apple = fakeApple();

/** users 表の中身（鍵 → 行） */
let table: Map<string, Record<string, any>>;

function conditionFailed() {
    return Object.assign(new Error("cc"), { name: "ConditionalCheckFailedException" });
}

beforeEach(() => {
    resetAppleKeysCache();
    table = new Map();
    apple = fakeApple();
    idpCalls = [];
    idpReply = () => ({});
    appleDeps.config = () => cfg;
    appleDeps.poolId = () => "ap-northeast-1_TEST";
    appleDeps.fetchImpl = apple.fetchImpl;
    appleDeps.idp = {
        send: async (c: unknown) => {
            const { name, input } = cmd(c);
            idpCalls.push({ name, input });
            return idpReply(name, input);
        },
    };
    // users 表の代わり（Get・Put・Update・Delete の条件は使う分だけ真似る）
    db.send.mockReset().mockImplementation(async (c: unknown) => {
        const { name, input } = cmd(c);
        const key = input.Key?.userId ?? input.Item?.userId;
        const row = table.get(key);
        if (name === "GetCommand") return { Item: row };
        if (name === "PutCommand") {
            if (input.ConditionExpression?.includes("attribute_not_exists(userId)") && row) throw conditionFailed();
            table.set(key, { ...input.Item });
            return {};
        }
        if (name === "DeleteCommand") {
            table.delete(key);
            return {};
        }
        if (name === "UpdateCommand") {
            if (input.ConditionExpression?.includes("attribute_exists(userId)") && !row) throw conditionFailed();
            if (input.ConditionExpression?.includes("attribute_not_exists(deletedAt)") && row?.deletedAt) throw conditionFailed();
            const next = { ...(row ?? { userId: key }) };
            const v = input.ExpressionAttributeValues ?? {};
            if (input.UpdateExpression.startsWith("REMOVE appleSub")) delete next.appleSub;
            if (input.UpdateExpression.includes("appleSub = :a")) next.appleSub = v[":a"];
            if (input.UpdateExpression.includes("if_not_exists(displayName")) next.displayName ??= v[":n"];
            if (input.UpdateExpression.includes("refreshToken = :t")) next.refreshToken = v[":t"];
            table.set(key, next);
            return {};
        }
        throw new Error(`知らない命令 ${name}`);
    });
});

/** Cognito の利用者の一覧の答え */
const listed = (users: { username: string; sub: string; verified?: boolean; status?: string; enabled?: boolean }[]) =>
    ({
        Users: users.map((u) => ({
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

describe("使えるか（GET /auth/apple/status）", () => {
    it("鍵とプールがそろっていれば true、鍵が無ければ false", async () => {
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: true });
        appleDeps.config = () => null;
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: false });
        appleDeps.config = () => cfg;
        appleDeps.poolId = () => "";
        expect(bodyOf(await call(getAppleSigninStatus, {}))).toEqual({ available: false });
    });
});

describe("サインイン（POST /auth/apple）", () => {
    it("鍵が無い環境は 503 で「使えません」（Apple にも Cognito にも話しかけない）", async () => {
        appleDeps.config = () => null;
        const r = await call(startAppleSignin, post({ identityToken: makeToken() }));
        expect(r.statusCode).toBe(503);
        expect(bodyOf(r).code).toBe("apple_signin_unavailable");
        expect(apple.calls).toHaveLength(0);
        expect(idpCalls).toHaveLength(0);
    });

    it("確かめられない token・nonce の無い token は 401（利用者を作らない）", async () => {
        for (const token of ["nope", makeToken({ aud: "com.other" }), makeToken({ nonce: undefined })]) {
            const r = await call(startAppleSignin, post({ identityToken: token }));
            expect(r.statusCode).toBe(401);
            expect(bodyOf(r).code).toBe("apple_token_invalid");
        }
        expect(idpCalls).toHaveLength(0);
        expect(table.size).toBe(0);
    });

    it("壊れた本文は 400", async () => {
        expect((await call(startAppleSignin, { body: "{" })).statusCode).toBe(400);
    });

    it("確かめ済みのメールが、確かめ済みのアカウントと同じなら、そのアカウントに結ぶ（新しく作らない）", async () => {
        table.set("sub-taro", { userId: "sub-taro", displayName: "たろう" });
        idpReply = (name) => (name === "ListUsersCommand" ? listed([{ username: "uuid-taro", sub: "sub-taro" }]) : {});
        const r = await call(startAppleSignin, post({ identityToken: makeToken(), displayName: "Taro Yamada" }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ username: "uuid-taro", created: false });
        expect(idpCalls.map((c) => c.name)).toEqual(["ListUsersCommand"]);
        expect(idpCalls[0].input.Filter).toBe("email = \"taro@example.com\"");
        expect(table.get("apple#001234.apple")).toMatchObject({ cognitoUsername: "uuid-taro", cognitoSub: "sub-taro", linkedBy: "email" });
        // プロフィールには Apple の番号。本人が付けた名前は上書きしない
        expect(table.get("sub-taro")).toMatchObject({ appleSub: "001234.apple", displayName: "たろう" });
    });

    it("同じメールでも、アカウント側のメールが確かめていなければ結ばない（新しいアカウント）", async () => {
        idpReply = (name, input) => (name === "ListUsersCommand"
            ? listed([{ username: "uuid-x", sub: "sub-x", verified: false }, { username: "uuid-y", sub: "sub-y", status: "UNCONFIRMED" }])
            : createdReply(name, input));
        const r = await call(startAppleSignin, post({ identityToken: makeToken() }));
        expect(bodyOf(r).created).toBe(true);
        expect(table.get("apple#001234.apple")).toMatchObject({ cognitoSub: "sub-new", linkedBy: "new" });
    });

    it("Apple がメールを確かめていなければ、同じメールのアカウントを探さない", async () => {
        idpReply = createdReply;
        await call(startAppleSignin, post({ identityToken: makeToken({ email_verified: "false" }) }));
        expect(idpCalls.map((c) => c.name)).not.toContain("ListUsersCommand");
    });

    it("メールを非公開にした人は新しいアカウント。確認済みにし、user グループに入れ、名前は初回に入れる", async () => {
        idpReply = createdReply;
        const r = await call(startAppleSignin, post({
            identityToken: makeToken({ email: "abc@privaterelay.appleid.com", is_private_email: true }),
            displayName: "  山田\n太郎  ",
        }));
        expect(r.statusCode).toBe(200);
        const body = bodyOf(r);
        expect(body.created).toBe(true);
        expect(body.username).toMatch(/^[0-9a-f-]{36}$/);
        const names = idpCalls.map((c) => c.name);
        expect(names).not.toContain("ListUsersCommand");
        expect(names).toEqual(["AdminCreateUserCommand", "AdminSetUserPasswordCommand", "AdminAddUserToGroupCommand"]);
        const create = idpCalls[0].input;
        expect(create.MessageAction).toBe("SUPPRESS");
        expect(create.UserAttributes).toEqual([
            { Name: "email", Value: "abc@privaterelay.appleid.com" }, { Name: "email_verified", Value: "true" },
        ]);
        expect(idpCalls[1].input.Permanent).toBe(true);
        expect(idpCalls[2].input.GroupName).toBe(USER_GROUP);
        expect(USER_GROUP).toBe("user");
        expect(table.get("sub-new")).toMatchObject({ userId: "sub-new", displayName: "山田 太郎", appleSub: "001234.apple" });
    });

    it("2回目からは前に結んだアカウント（Cognito に居れば）。作らない・探さない", async () => {
        table.set("apple#001234.apple", { userId: "apple#001234.apple", cognitoUsername: "uuid-1", cognitoSub: "sub-1" });
        const r = await call(startAppleSignin, post({ identityToken: makeToken() }));
        expect(bodyOf(r)).toEqual({ username: "uuid-1", created: false });
        expect(idpCalls.map((c) => c.name)).toEqual(["AdminGetUserCommand"]);
    });

    it("前に結んだアカウントが退会で消えていたら、古い行を消して新しく作る", async () => {
        table.set("apple#001234.apple", { userId: "apple#001234.apple", cognitoUsername: "uuid-gone", cognitoSub: "sub-gone" });
        idpReply = (name, input) => {
            if (name === "AdminGetUserCommand") throw Object.assign(new Error("x"), { name: "UserNotFoundException" });
            return createdReply(name, input);
        };
        const r = await call(startAppleSignin, post({ identityToken: makeToken() }));
        expect(bodyOf(r).created).toBe(true);
        expect(table.get("apple#001234.apple")).toMatchObject({ cognitoUsername: bodyOf(r).username, cognitoSub: "sub-new" });
    });

    it("認可コードを Apple の更新トークンに替えて行に控える。答えに更新トークンは出さない", async () => {
        apple = fakeApple({ refreshToken: "r.apple.9" });
        appleDeps.fetchImpl = apple.fetchImpl;
        idpReply = createdReply;
        const r = await call(startAppleSignin, post({ identityToken: makeToken(), authorizationCode: "c.1" }));
        expect(table.get("apple#001234.apple")?.refreshToken).toBe("r.apple.9");
        expect(r.body).not.toContain("r.apple.9");
    });

    it("更新トークンが取れなくてもログインは止めない", async () => {
        apple = fakeApple({ tokenStatus: 400 });
        appleDeps.fetchImpl = apple.fetchImpl;
        idpReply = createdReply;
        const r = await call(startAppleSignin, post({ identityToken: makeToken(), authorizationCode: "c.1" }));
        expect(r.statusCode).toBe(200);
        expect(table.get("apple#001234.apple")?.refreshToken).toBeUndefined();
    });
});

describe("退会の取り消し（POST /auth/apple/revoke）", () => {
    it("Apple で入っていない人は何もしない", async () => {
        table.set("sub-1", { userId: "sub-1" });
        const r = await call(revokeAppleSignin, authed("sub-1"));
        expect(bodyOf(r)).toEqual({ revoked: false });
        expect(apple.calls).toHaveLength(0);
    });

    it("Apple の更新トークンを取り消し、Apple の行とプロフィールの番号を消す", async () => {
        table.set("sub-1", { userId: "sub-1", appleSub: "a.1" });
        table.set("apple#a.1", { userId: "apple#a.1", cognitoSub: "sub-1", cognitoUsername: "u-1", refreshToken: "r.1" });
        const r = await call(revokeAppleSignin, authed("sub-1"));
        expect(bodyOf(r)).toEqual({ revoked: true });
        expect(apple.calls.map((c) => c.url)).toEqual(["https://appleid.apple.com/auth/revoke"]);
        expect(new URLSearchParams(apple.calls[0].body).get("token")).toBe("r.1");
        expect(table.has("apple#a.1")).toBe(false);
        expect(table.get("sub-1")?.appleSub).toBeUndefined();
    });

    it("退会の墓石に残った番号でも取り消せる（退会の途中で止まった人のやり直し）", async () => {
        table.set("sub-1", { userId: "sub-1", deletedAt: "2026-11-23T00:00:00Z", appleSub: "a.1" });
        table.set("apple#a.1", { userId: "apple#a.1", cognitoSub: "sub-1", refreshToken: "r.1" });
        expect(bodyOf(await call(revokeAppleSignin, authed("sub-1")))).toEqual({ revoked: true });
        expect(table.has("apple#a.1")).toBe(false);
    });

    it("Apple が失敗したら 502 で、行は残す（やり直せる）", async () => {
        apple = fakeApple({ revokeStatus: 500 });
        appleDeps.fetchImpl = apple.fetchImpl;
        table.set("sub-1", { userId: "sub-1", appleSub: "a.1" });
        table.set("apple#a.1", { userId: "apple#a.1", cognitoSub: "sub-1", refreshToken: "r.1" });
        const r = await call(revokeAppleSignin, authed("sub-1"));
        expect(r.statusCode).toBe(502);
        expect(table.get("apple#a.1")?.refreshToken).toBe("r.1");
    });

    it("🔴 行が別の人のものなら触らない", async () => {
        table.set("sub-1", { userId: "sub-1", appleSub: "a.2" });
        table.set("apple#a.2", { userId: "apple#a.2", cognitoSub: "sub-2", refreshToken: "r.2" });
        expect(bodyOf(await call(revokeAppleSignin, authed("sub-1")))).toEqual({ revoked: false });
        expect(apple.calls).toHaveLength(0);
        expect(table.has("apple#a.2")).toBe(true);
    });

    it("鍵が無い環境で、取り消すトークンがあれば 503（黙って消さない）", async () => {
        appleDeps.config = () => null;
        table.set("sub-1", { userId: "sub-1", appleSub: "a.1" });
        table.set("apple#a.1", { userId: "apple#a.1", cognitoSub: "sub-1", refreshToken: "r.1" });
        expect((await call(revokeAppleSignin, authed("sub-1"))).statusCode).toBe(503);
        expect(table.has("apple#a.1")).toBe(true);
    });
});

describe("小さな部品", () => {
    it("名前は空白を整え、100 字で切る。空なら無し", () => {
        expect(cleanDisplayName(" a\tb ")).toBe("a b");
        expect(cleanDisplayName("   ")).toBeUndefined();
        expect(cleanDisplayName(42)).toBeUndefined();
        expect([...cleanDisplayName("あ".repeat(150))!]).toHaveLength(100);
    });

    it("検索の絞り込みの値は \" と \\ を逃がす", () => {
        expect(filterValue("a\"b\\c")).toBe("a\\\"b\\\\c");
    });

    it("本人も知らないパスワードはプールの決まり（大小英字・数字・記号）を満たし、毎回違う", () => {
        const p = randomPassword();
        expect(p).toMatch(/[A-Z]/);
        expect(p).toMatch(/[a-z]/);
        expect(p).toMatch(/[0-9]/);
        expect(p).toMatch(/[^A-Za-z0-9]/);
        expect(p.length).toBeGreaterThanOrEqual(40);
        expect(randomPassword()).not.toBe(p);
    });

    it("db の命令は users 表だけに向く", async () => {
        idpReply = createdReply;
        await call(startAppleSignin, post({ identityToken: makeToken() }));
        expect(new Set(dbCalls().map((c) => c.input.TableName))).toEqual(new Set([process.env.USERS_TABLE]));
    });
});
