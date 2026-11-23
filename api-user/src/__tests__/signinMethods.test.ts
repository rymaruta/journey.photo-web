import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeUsersTable } from "./appleTestKit";

/**
 * 「サインインの方法」（札 journey.photo-ios#601・2026-11-23 owner）と、メールでの知らせ（SES）。
 * 🔴 最後に残る入り方は外させない。Apple は取り消してから外す。外した提供元には自動で結び直さない
 */
const db = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../dynamodb", () => ({ ddb: db, PHOTOS_TABLE: "photos-test" }));

import { listSigninMethods, removeSigninMethod, methodsDeps, LAST_METHOD_MESSAGE } from "../signinMethods";
import { federatedDeps, findLinkableEmailUser } from "../federatedAccount";
import { linkNoticeHandler, linkNoticeEmail, noticeDeps, fromHeader, SIGNIN_METHODS_URL } from "../federatedNotice";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Result = { statusCode: number; body: string };
const call = (fn: unknown, event: unknown): Promise<Result> => (fn as any)(event, {}, () => undefined);
const ME = "11111111-2222-3333-4444-555555555555";
const ev = (provider?: string, sub = ME) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: provider ? { provider } : undefined,
});
const body = (r: Result) => JSON.parse(r.body);
const method = (r: Result, id: string) => body(r).methods.find((m: { id: string }) => m.id === id);

let users = fakeUsersTable();
let email: string | undefined = "taro@example.com";
let revoked: string[] = [];
let revokeResult: "revoked" | "failed" | "rejected" | "unavailable" = "revoked";

function seed(profile: Record<string, unknown>, rows: Record<string, Record<string, unknown>> = {}, passwordSet = false) {
    users.table.set(ME, { userId: ME, ...profile });
    for (const [k, v] of Object.entries(rows)) users.table.set(k, { userId: k, ...v });
    if (passwordSet) users.table.set(`password#${ME}`, { userId: `password#${ME}`, setAt: "x" });
}
const appleRow = (extra: Record<string, unknown> = {}) => ({ provider: "apple", cognitoSub: ME, cognitoUsername: "u-me", linkedBy: "email", refreshToken: "r.apple", ...extra });
const googleRow = (extra: Record<string, unknown> = {}) => ({ provider: "google", cognitoSub: ME, cognitoUsername: "u-me", linkedBy: "email", ...extra });

beforeEach(() => {
    users = fakeUsersTable();
    email = "taro@example.com";
    revoked = [];
    revokeResult = "revoked";
    db.send.mockReset().mockImplementation(users.send);
    federatedDeps.poolId = () => "ap-northeast-1_TEST";
    federatedDeps.now = () => Date.parse("2026-11-23T12:00:00Z");
    federatedDeps.idp = {
        send: async (c: any) => {
            if (c.constructor.name !== "ListUsersCommand") return {};
            if (c.input.Filter === `sub = "${ME}"`) return { Users: [{ Attributes: email ? [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }] : [] }] };
            if (/^email = /.test(c.input.Filter)) {
                return { Users: [{ Username: "u-me", Enabled: true, UserStatus: "CONFIRMED", Attributes: [{ Name: "sub", Value: ME }, { Name: "email_verified", Value: "true" }] }] };
            }
            return { Users: [] };
        },
    };
    federatedDeps.notifyLinked = async () => undefined;
    methodsDeps.revokers = { apple: async (t) => { revoked.push(t); return revokeResult; } };
});

describe("GET /user/signin-methods", () => {
    it("メールで作った人: メールは入れる、つながっている Apple は外せる、Google はつながっていない", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        const r = await call(listSigninMethods, ev());
        expect(r.statusCode).toBe(200);
        expect((r as any).headers["Cache-Control"]).toBe("no-store");
        expect(method(r, "email")).toEqual({ id: "email", linked: true, removable: false, email: "taro@example.com" });
        expect(method(r, "apple")).toEqual({ id: "apple", linked: true, removable: true });
        expect(method(r, "google")).toEqual({ id: "google", linked: false, removable: false });
    });

    it("🔴 Apple で新しく作った人（パスワードを知らない）: メールでは入れず、Apple は最後の1つなので外せない（理由つき）", async () => {
        seed({ appleSub: "001.apple", federatedSignup: "apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) });
        const r = await call(listSigninMethods, ev());
        expect(method(r, "email").linked).toBe(false);
        expect(method(r, "apple")).toEqual({ id: "apple", linked: true, removable: false, blockedReason: LAST_METHOD_MESSAGE });
    });

    it("Apple で作った人でも、パスワードを決め直していればメールで入れるので外せる", async () => {
        seed({ appleSub: "001.apple", federatedSignup: "apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) }, true);
        const r = await call(listSigninMethods, ev());
        expect(method(r, "email").linked).toBe(true);
        expect(method(r, "apple").removable).toBe(true);
    });

    it("🔴 プロフィールの印が無くても、行が「新しく作った」なら、パスワードを知らない人として扱う", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) });
        expect(method(await call(listSigninMethods, ev()), "apple").removable).toBe(false);
    });

    it("メールが無い人（パスワードを決め直せない）も、メールでは入れない", async () => {
        email = undefined;
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        const r = await call(listSigninMethods, ev());
        expect(method(r, "email")).toEqual({ id: "email", linked: false, removable: false });
        expect(method(r, "apple").removable).toBe(false);
    });

    it("ログインしていない・退会済みは断る", async () => {
        expect((await call(listSigninMethods, ev(undefined, ""))).statusCode).toBe(401);
        seed({ deletedAt: "x", appleSub: "001.apple" });
        expect((await call(listSigninMethods, ev())).statusCode).toBe(404);
    });
});

describe("DELETE /user/signin-methods/{provider}", () => {
    it("Apple: 更新トークンを取り消してから、行とプロフィールの番号を消す。外した印を残す", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        const r = await call(removeSigninMethod, ev("apple"));
        expect(r.statusCode).toBe(200);
        expect(revoked).toEqual(["r.apple"]);
        expect(users.table.has("apple#001.apple")).toBe(false);
        expect(users.table.get(ME)).not.toHaveProperty("appleSub");
        expect(users.table.get(ME)!.appleUnlinkedAt).toBe("2026-11-23T12:00:00.000Z");
        expect(method(r, "apple")).toEqual({ id: "apple", linked: false, removable: false });
    });

    it("Google: 取り消しはせず、行と googleSub を消す", async () => {
        seed({ googleSub: "g-1" }, { "google#g-1": googleRow() });
        expect((await call(removeSigninMethod, ev("google"))).statusCode).toBe(200);
        expect(revoked).toEqual([]);
        expect(users.table.has("google#g-1")).toBe(false);
        expect(users.table.get(ME)).not.toHaveProperty("googleSub");
    });

    it("🔴 最後に残る入り方は外させない（409・理由つき）。何も変えない", async () => {
        seed({ appleSub: "001.apple", federatedSignup: "apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) });
        const before = JSON.stringify([...users.table]);
        const r = await call(removeSigninMethod, ev("apple"));
        expect(r.statusCode).toBe(409);
        expect(body(r)).toEqual({ error: LAST_METHOD_MESSAGE, code: "last_signin_method" });
        expect(revoked).toEqual([]);
        expect(JSON.stringify([...users.table])).toBe(before);
    });

    it("Apple で作った人が Google もつないでいれば Apple は外せる。外すと作った印をプロフィールに残し、次の Google は外せない", async () => {
        seed({ appleSub: "001.apple", googleSub: "g-1" }, { "apple#001.apple": appleRow({ linkedBy: "new" }), "google#g-1": googleRow() });
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(200);
        expect(users.table.get(ME)!.federatedSignup).toBe("apple");
        const r = await call(removeSigninMethod, ev("google"));
        expect(r.statusCode).toBe(409);
        expect(users.table.has("google#g-1")).toBe(true);
    });

    it("🔴 同時に2つ外す回: 読んだあとでほかの入り方が消えていたら、書き換えの条件で止める（0にしない）", async () => {
        seed({ appleSub: "001.apple", googleSub: "g-1", federatedSignup: "apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }), "google#g-1": googleRow() });
        db.send.mockImplementation(async (c: any) => {
            // プロフィールを書き換える直前に、別の回が Google を外し終えた
            if (c.constructor.name === "UpdateCommand" && c.input.Key.userId === ME) {
                const p = { ...users.table.get(ME)! };
                delete p.googleSub;
                users.table.set(ME, p);
            }
            return users.send(c);
        });
        const r = await call(removeSigninMethod, ev("apple"));
        expect(r.statusCode).toBe(409);
        expect(users.table.get(ME)!.appleSub).toBe("001.apple");
        expect(users.table.has("apple#001.apple")).toBe(true);
    });

    it("Apple に届かない（failed）なら 503 で何も変えない。断られた・鍵が無いときは外すのを進める", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        revokeResult = "failed";
        const r = await call(removeSigninMethod, ev("apple"));
        expect(r.statusCode).toBe(503);
        expect(body(r).code).toBe("revoke_failed");
        expect(users.table.get(ME)!.appleSub).toBe("001.apple");
        revokeResult = "rejected";
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(200);
        expect(users.table.has("apple#001.apple")).toBe(false);
    });

    it("🔴 行が別の人を指していれば、その行には触らない（つながりとして数えない）", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow({ cognitoSub: "someone-else" }) });
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(404);
        expect(users.table.get("apple#001.apple")!.cognitoSub).toBe("someone-else");
        expect(revoked).toEqual([]);
    });

    it("つながっていない・知らない提供元・ログインしていないは断る", async () => {
        seed({});
        expect(body(await call(removeSigninMethod, ev("apple"))).code).toBe("not_linked");
        expect((await call(removeSigninMethod, ev("email"))).statusCode).toBe(400);
        expect((await call(removeSigninMethod, ev("evil"))).statusCode).toBe(400);
        expect((await call(removeSigninMethod, ev("apple", "not-a-uuid"))).statusCode).toBe(401);
    });

    it("🔴 退会した人の残ったトークンでは解除させない（410・何も変えない）", async () => {
        seed({ deletedAt: "2026-11-23T00:00:00Z", appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(410);
        expect(revoked).toEqual([]);
        expect(users.table.has("apple#001.apple")).toBe(true);
    });

    it("🔴 外した提供元には、メールが同じでも自動で結び直さない（ほかの提供元は今までどおり）", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        expect(await findLinkableEmailUser("apple", "taro@example.com")).toBeNull();
        await call(removeSigninMethod, ev("apple"));
        expect(await findLinkableEmailUser("apple", "taro@example.com")).toBeNull();
        expect(await findLinkableEmailUser("google", "taro@example.com")).toEqual({ username: "u-me", sub: ME });
    });
});

describe("メールでの知らせ（SES・2026-11-23 owner）", () => {
    const sent: { from: string; msg: any }[] = [];
    beforeEach(() => {
        sent.length = 0;
        noticeDeps.tokens = async () => [];
        noticeDeps.email = async () => "taro@example.com";
        noticeDeps.sendEmail = async (from, msg) => { sent.push({ from, msg }); };
        noticeDeps.emailEnabled = () => true;
        noticeDeps.from = () => "no-reply@journey-photo.com";
    });

    it("題は短く、本文は「こちらから外せます」とリンク1つ。差出人は journey.photo。HTML とテキストの両方", async () => {
        expect(await linkNoticeHandler({ cognitoSub: ME, provider: "apple" })).toEqual({ sent: 0, emailed: true });
        expect(sent[0].from).toBe("\"journey.photo\" <no-reply@journey-photo.com>");
        expect(sent[0].msg.to).toBe("taro@example.com");
        expect(sent[0].msg.subject).toBe("Apple でサインインできます");
        expect(sent[0].msg.text).toContain("心当たりが無ければ、こちらから連携を解除できます。");
        expect(sent[0].msg.text).toContain(SIGNIN_METHODS_URL);
        expect(sent[0].msg.html).toContain(`href="${SIGNIN_METHODS_URL}"`);
        expect(sent[0].msg.html.match(/href=/g)).toHaveLength(1);
        await linkNoticeHandler({ cognitoSub: ME, provider: "google" });
        expect(sent[1].msg.subject).toBe("Google でログインできます");
        for (const p of ["apple", "google"] as const) {
            const m = linkNoticeEmail(p, "x@example.com");
            expect(`${m.subject}${m.text}${m.html}`).not.toMatch(/・|パスワード|結ば|外せ/);
        }
        expect(SIGNIN_METHODS_URL).toBe("https://journey-photo.com/signin-methods");
        expect(fromHeader("a@b.c")).toBe("\"journey.photo\" <a@b.c>");
    });

    it("🔴 変数で有効にしていない環境は送らない。宛先が無い・送れないときもプッシュとサインインは止めない", async () => {
        noticeDeps.emailEnabled = () => false;
        expect((await linkNoticeHandler({ cognitoSub: ME, provider: "apple" })).emailed).toBe(false);
        expect(sent).toHaveLength(0);

        noticeDeps.emailEnabled = () => true;
        noticeDeps.email = async () => undefined;
        expect((await linkNoticeHandler({ cognitoSub: ME, provider: "apple" })).emailed).toBe(false);

        noticeDeps.email = async () => "taro@example.com";
        noticeDeps.sendEmail = async () => { throw Object.assign(new Error("x"), { name: "MessageRejected" }); };
        const pushed: unknown[] = [];
        noticeDeps.tokens = async () => ["tok"];
        noticeDeps.pushKey = async () => "";
        noticeDeps.push = async (t, m) => { pushed.push(m); return { sent: t.length, invalid: [] }; };
        await expect(linkNoticeHandler({ cognitoSub: ME, provider: "apple" })).resolves.toEqual({ sent: 1, emailed: false });
        expect(pushed).toHaveLength(1);
    });
});

describe("配り方（serverless）", () => {
    const yml = readFileSync(join(__dirname, "../../serverless.apple-signin.yml"), "utf8");
    const userYml = readFileSync(join(__dirname, "../../serverless.yml"), "utf8");
    const block = (name: string) => yml.slice(yml.indexOf(`\n  ${name}:`), yml.indexOf("\n\n", yml.indexOf(`\n  ${name}:`) + 3));
    const role = (name: string) => yml.slice(yml.indexOf(`\n    ${name}:`), yml.indexOf("\n\n", yml.indexOf(`\n    ${name}:`) + 3));

    it("🔴 口は2つともログイン必須（Cognito の認可を取り込む）", () => {
        for (const fn of ["signinMethodsList", "signinMethodsRemove"]) {
            expect(block(fn)).toContain("authorizer:");
            expect(block(fn)).toContain("Fn::ImportValue: sls-photo-gallery-user-api-${sls:stage}-CognitoAuthorizerId");
        }
        expect(block("signinMethodsRemove")).toContain("path: /user/signin-methods/{provider}");
        expect(block("signinMethodsRemove")).toContain("method: DELETE");
    });

    it("🔴 「サインインの方法」の役は鍵（SSM）を読めず、取り消しは appleRevoke を呼ぶだけ", () => {
        const r = role("SigninMethodsRole");
        expect(r).not.toContain("ssm:");
        expect(r).not.toContain("APNS");
        expect(r).toContain("function:${self:service}-${sls:stage}-appleRevoke");
        expect(r).not.toMatch(/AdminDeleteUser|AdminCreateUser/);
        expect(block("signinMethodsRemove")).not.toMatch(/APNS_PRIVATE_KEY|APPLE_SIGNIN_KEY_PARAM/);
    });

    it("🔴 流量: 2つの口も段の経路ごとの設定で絞る（スタックを配る環境だけ）", () => {
        expect(userYml).toMatch(/"DELETE \/user\/signin-methods\/\{provider\}":\n\s+ThrottlingRateLimit: \d+\n\s+ThrottlingBurstLimit: \d+/);
        expect(userYml.match(/"DELETE \/user\/signin-methods\/\{provider\}"/g)).toHaveLength(2);
        expect(userYml.match(/"GET \/user\/signin-methods"/g)).toHaveLength(2);
    });

    it("🔴 SES は切り替えが true のときだけ作り、送る権限はその送り元に限る", () => {
        expect(yml).toMatch(/SigninEmailOn:\n\s+Fn::Equals: \["\$\{param:signinEmailEnabled, 'false'\}", "true"\]/);
        const ident = role("SigninEmailIdentity");
        expect(ident).toContain("Type: AWS::SES::EmailIdentity");
        // ドメインの登録はアカウントと地域で1つ。本番のスタックだけが作る（staging と同じアカウント）
        expect(ident).toContain("Condition: SigninEmailIdentityOn");
        expect(yml).toMatch(/SigninEmailIdentityOn:\n\s+Fn::And:\n\s+- Condition: SigninEmailOn\n\s+- Fn::Equals: \["\$\{sls:stage\}", "prod"\]/);
        const notice = role("LinkNoticeRole");
        expect(notice).toMatch(/Fn::If:\n\s+- SigninEmailOn\n\s+- Effect: Allow\n\s+Action:\n\s+- ses:SendEmail/);
        expect(notice).toMatch(/\n\s+Condition:\n\s+StringEquals:\n\s+ses:FromAddress: \$\{param:signinEmailFrom, 'no-reply@journey-photo.com'\}/);
        expect(notice).not.toMatch(/ses:\*|"\*"/);
        expect(block("linkNotice")).toContain("SIGNIN_EMAIL_ENABLED: ${param:signinEmailEnabled, 'false'}");
    });
});
