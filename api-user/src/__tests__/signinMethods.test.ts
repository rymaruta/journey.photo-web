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

import { listSigninMethods, removeSigninMethod, methodsDeps, LAST_METHOD_MESSAGE, LAST_METHOD_NO_EMAIL_MESSAGE } from "../signinMethods";
import {
    federatedDeps, findLinkableEmailUser, linkOrCreate, consumeTicket, linkedFields, revokeLinkedTokens, unlinkAfterDelete,
    UnlinkedProviderError, type FederatedIdentity,
} from "../federatedAccount";
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
const identity = (extra: Partial<FederatedIdentity> = {}): FederatedIdentity => ({
    provider: "apple", sub: "001.apple", email: "taro@example.com", emailVerified: true, isPrivateEmail: false, ...extra,
});
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
    it("メールで作った人: メールは入れる、連携している Apple は解除できる、Google は連携していない", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        const r = await call(listSigninMethods, ev());
        expect(r.statusCode).toBe(200);
        expect((r as any).headers["Cache-Control"]).toBe("no-store");
        expect(method(r, "email")).toEqual({ id: "email", linked: true, removable: false, email: "taro@example.com" });
        expect(method(r, "apple")).toEqual({ id: "apple", linked: true, removable: true });
        expect(method(r, "google")).toEqual({ id: "google", linked: false, removable: false });
    });

    it("🔴 Apple で新しく作った人（パスワードを知らない）: メールでは入れず、Apple は最後の1つなので解除できない（理由つき）", async () => {
        seed({ appleSub: "001.apple", federatedSignup: "apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) });
        const r = await call(listSigninMethods, ev());
        expect(method(r, "email").linked).toBe(false);
        expect(method(r, "apple")).toEqual({ id: "apple", linked: true, removable: false, blockedReason: LAST_METHOD_MESSAGE });
    });

    it("Apple で作った人でも、パスワードを決め直していればメールで入れるので解除できる", async () => {
        seed({ appleSub: "001.apple", federatedSignup: "apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) }, true);
        const r = await call(listSigninMethods, ev());
        expect(method(r, "email").linked).toBe(true);
        expect(method(r, "apple").removable).toBe(true);
    });

    it("🔴 プロフィールの印が無くても、行が「新しく作った」なら、パスワードを知らない人として扱う", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) });
        expect(method(await call(listSigninMethods, ev()), "apple").removable).toBe(false);
    });

    it("🔴 結び付けの行が無い・どう結んだか（linkedBy）が無い連携は、外の提供元で作った人と扱い、パスワードの印を求める", async () => {
        seed({ appleSub: "001.apple" });   // 行が無い
        expect(method(await call(listSigninMethods, ev()), "apple").removable).toBe(false);
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(409);
        users = fakeUsersTable();
        db.send.mockReset().mockImplementation(users.send);
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow({ linkedBy: undefined }) });
        expect(method(await call(listSigninMethods, ev()), "apple").removable).toBe(false);
        // パスワードを決めた印があれば解除でき、プロフィールに作った印を残す（あとで Google だけになったときも守る）
        users.table.set(`password#${ME}`, { userId: `password#${ME}` });
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(200);
        expect(users.table.get(ME)!.federatedSignup).toBe("apple");
    });

    it("解除できない理由は、実際にできる道で書く（メールがあれば「パスワードを忘れた」、無ければ「問い合わせ」）", async () => {
        expect(LAST_METHOD_MESSAGE).toContain("ログイン画面の「パスワードを忘れた」から、パスワードを設定できます");
        expect(LAST_METHOD_NO_EMAIL_MESSAGE).toContain("設定の「問い合わせ」");
        for (const m of [LAST_METHOD_MESSAGE, LAST_METHOD_NO_EMAIL_MESSAGE]) expect(m).not.toMatch(/・|外せ|設定してください/);
        seed({ appleSub: "001.apple", federatedSignup: "apple" }, { "apple#001.apple": appleRow({ linkedBy: "new" }) });
        expect(method(await call(listSigninMethods, ev()), "apple").blockedReason).toBe(LAST_METHOD_MESSAGE);
        email = undefined;
        expect(method(await call(listSigninMethods, ev()), "apple").blockedReason).toBe(LAST_METHOD_NO_EMAIL_MESSAGE);
        expect(body(await call(removeSigninMethod, ev("apple"))).error).toBe(LAST_METHOD_NO_EMAIL_MESSAGE);
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

    it("Apple で作った人が Google も連携していれば Apple は解除できる。解除すると作った印をプロフィールに残し、次の Google は解除できない", async () => {
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
        // 🔴 条件の確かめは取り消しより前。断った回はトークンも取り消さない
        expect(revoked).toEqual([]);
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
        // 🔴 戻すのは解除の印も含めて（押し直せば続きから）
        expect(users.table.get(ME)).not.toHaveProperty("appleUnlinkedAt");
        expect(users.table.get("apple#001.apple")!.refreshToken).toBe("r.apple");
    });

    it("🔴 Apple が断った・鍵が無いときは、退会と同じく行を消さずに ttl と解除の印を付けて残す（トークンは残す・券は消す）", async () => {
        for (const result of ["rejected", "unavailable"] as const) {
            users = fakeUsersTable();
            db.send.mockReset().mockImplementation(users.send);
            seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow({ ticketHash: "h", ticketExpiresAt: 1 }) });
            revokeResult = result;
            expect((await call(removeSigninMethod, ev("apple"))).statusCode, result).toBe(200);
            const kept = users.table.get("apple#001.apple")!;
            expect(kept, result).toMatchObject({ refreshToken: "r.apple", cognitoSub: ME, unlinkedAt: "2026-11-23T12:00:00.000Z" });
            expect(kept.ttl).toBe(Math.floor(Date.parse("2026-11-23T12:00:00Z") / 1000) + 30 * 24 * 60 * 60);
            expect(kept).not.toHaveProperty("ticketHash");
            expect(users.table.get(ME)).not.toHaveProperty("appleSub");
        }
    });

    it("🔴 残した行の番号をプロフィールに控え、退会の取り消しと掃除がその行も扱う", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        revokeResult = "rejected";
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(200);
        const profile = users.table.get(ME)!;
        expect(profile.appleUnlinkedSub).toBe("001.apple");
        // 退会（account.ts と同じ順: 墓石に写す → 取り消す → 墓石 → 掃除）
        const fields = linkedFields(profile);
        expect(fields).toEqual({ appleUnlinkedSub: "001.apple" });
        revokeResult = "revoked";
        revoked = [];
        expect(await revokeLinkedTokens(ME, fields, methodsDeps.revokers)).toBe(true);
        expect(revoked).toEqual(["r.apple"]);
        users.table.set(ME, { userId: ME, deletedAt: "2026-11-24T00:00:00Z", ...fields });
        await unlinkAfterDelete(ME, fields, 123);
        expect(users.table.has("apple#001.apple")).toBe(false);
        expect(users.table.get(ME)).not.toHaveProperty("appleUnlinkedSub");
    });

    it("控えの欄が書けなくても（条件以外の失敗）解除は 200 で済ませ、人の情報の無いログに出すだけ", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        revokeResult = "rejected";
        db.send.mockImplementation(async (c: any) => {
            if (c.constructor.name === "UpdateCommand" && c.input.Key.userId === ME && c.input.UpdateExpression === "SET #k = :s") {
                throw Object.assign(new Error("t"), { name: "ProvisionedThroughputExceededException" });
            }
            return users.send(c);
        });
        const logged: string[] = [];
        const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
        try {
            expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(200);
        } finally {
            spy.mockRestore();
        }
        expect(users.table.get("apple#001.apple")!.unlinkedAt).toBeDefined();
        const line = logged.find((l) => l.includes("federated_unlink_note_failed"));
        expect(line).toBeDefined();
        expect(line).not.toContain(ME);
        expect(line).not.toContain("001.apple");
        expect(line).not.toContain("taro@example.com");
    });

    it("🔴 解除して残した行では入れない。解除の前に出した券も通さない", async () => {
        seed({}, { "apple#001.apple": appleRow({ unlinkedAt: "2026-11-23T00:00:00Z" }) });
        await expect(linkOrCreate(identity({ sub: "001.apple" }), undefined)).rejects.toBeInstanceOf(UnlinkedProviderError);
        const { sha256Hex } = await import("../federatedAccount");
        const ticket = "T".repeat(43);
        users.table.set("apple#001.apple", { ...users.table.get("apple#001.apple")!, ticketHash: sha256Hex(ticket), ticketExpiresAt: Date.parse("2026-11-23T12:05:00Z") });
        expect(await consumeTicket(`apple:001.apple:${ticket}`, "u-me", ME)).toBe(false);
        const row = { ...users.table.get("apple#001.apple")! };
        delete row.unlinkedAt;
        users.table.set("apple#001.apple", row);
        expect(await consumeTicket(`apple:001.apple:${ticket}`, "u-me", ME), "印が無ければ通る（試験の作りの確かめ）").toBe(true);
    });

    it("🔴 解除の行を消す条件は「本人を指している行」だけ（読んだあとに別の人を指すようになった行は消さない）", async () => {
        seed({ appleSub: "001.apple" }, { "apple#001.apple": appleRow() });
        db.send.mockImplementation(async (c: any) => {
            if (c.constructor.name === "DeleteCommand" && c.input.Key.userId === "apple#001.apple") {
                users.table.set("apple#001.apple", { ...users.table.get("apple#001.apple")!, cognitoSub: "someone-else" });
            }
            return users.send(c);
        });
        expect((await call(removeSigninMethod, ev("apple"))).statusCode).toBe(200);
        expect(users.table.get("apple#001.apple")!.cognitoSub).toBe("someone-else");
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

describe("🔴 解除した後に、もう一度その提供元で入る（2026-11-23 確かめ役の指摘: 黙って空の別アカウントを作らない）", () => {
    let created: string[] = [];
    let aliasExists = false;
    let ownerGone = false;
    beforeEach(() => {
        created = [];
        aliasExists = false;
        ownerGone = false;
        const base = federatedDeps.idp.send;
        federatedDeps.idp = {
            send: async (c: any) => {
                const name = c.constructor.name;
                if (name === "AdminCreateUserCommand") {
                    created.push(JSON.stringify(c.input.UserAttributes));
                    if (aliasExists && c.input.UserAttributes.length > 0) throw Object.assign(new Error("a"), { name: "AliasExistsException" });
                    return { User: { Attributes: [{ Name: "sub", Value: "sub-new" }] } };
                }
                if (name === "AdminListGroupsForUserCommand") return { Groups: [] };
                if (name === "AdminGetUserCommand" && ownerGone) throw Object.assign(new Error("n"), { name: "UserNotFoundException" });
                return base(c);
            },
        };
    });

    it("同じ確かめ済みメールの持ち主が Apple を解除していたら、作らずに断る（途中の印も残さない）", async () => {
        seed({ appleUnlinkedAt: "2026-11-23T00:00:00Z" });
        await expect(linkOrCreate(identity({ sub: "002.apple" }), undefined)).rejects.toBeInstanceOf(UnlinkedProviderError);
        expect(created).toEqual([]);
        expect(users.table.has("apple#002.apple")).toBe(false);
    });

    it("非公開の転送アドレスでも、前に結んだ人のもの（作る途中で AliasExists）なら同じく断る", async () => {
        seed({ appleUnlinkedAt: "2026-11-23T00:00:00Z" });
        aliasExists = true;
        await expect(linkOrCreate(identity({ sub: "002.apple", email: "x@privaterelay.appleid.com", isPrivateEmail: true }), undefined))
            .rejects.toBeInstanceOf(UnlinkedProviderError);
        expect(created).toHaveLength(1);   // メール付きの1回目だけ
    });

    it("メールが確かめ済みでなく、作る途中で同じメールの持ち主にぶつかった（AliasExists）ときも、解除していればメール無しで作らない", async () => {
        seed({ appleUnlinkedAt: "2026-11-23T00:00:00Z" });
        aliasExists = true;
        await expect(linkOrCreate(identity({ sub: "002.apple", emailVerified: false }), undefined)).rejects.toBeInstanceOf(UnlinkedProviderError);
        expect(created).toHaveLength(1);   // メール付きの1回目だけ。メール無しの2回目は作らない
    });

    it("🔴 解除して残した行でも、持ち主が退会していれば（Cognito に居ない・プロフィールが墓石）消して作り直す", async () => {
        // Cognito に居ない
        seed({}, { "apple#001.apple": appleRow({ unlinkedAt: "2026-11-23T00:00:00Z" }) });
        users.table.delete(ME);
        ownerGone = true;
        await expect(linkOrCreate(identity({ sub: "001.apple", email: undefined, emailVerified: false }), undefined))
            .resolves.toMatchObject({ via: "new", sub: "sub-new" });
        expect(users.table.get("apple#001.apple")).toMatchObject({ cognitoSub: "sub-new" });
        expect(users.table.get("apple#001.apple")).not.toHaveProperty("unlinkedAt");

        // Cognito にはまだ居るが、プロフィールが墓石（退会の途中で Cognito を消せなかった）
        users = fakeUsersTable();
        db.send.mockReset().mockImplementation(users.send);
        ownerGone = false;
        created = [];
        seed({ deletedAt: "2026-11-23T01:00:00Z" }, { "apple#001.apple": appleRow({ unlinkedAt: "2026-11-23T00:00:00Z" }) });
        await expect(linkOrCreate(identity({ sub: "001.apple", email: undefined, emailVerified: false }), undefined))
            .resolves.toMatchObject({ via: "new" });
        expect(created).toHaveLength(1);
    });

    it("🔴 同じメールの持ち主が退会済み（墓石）なら、解除の印があっても断らない", async () => {
        seed({ deletedAt: "2026-11-23T01:00:00Z", appleUnlinkedAt: "2026-11-23T00:00:00Z" });
        await expect(linkOrCreate(identity({ sub: "004.apple" }), undefined)).resolves.toMatchObject({ via: "new" });
    });

    it("解除していない提供元・別のメールなら今までどおり", async () => {
        seed({ appleUnlinkedAt: "2026-11-23T00:00:00Z" });
        await expect(linkOrCreate(identity({ provider: "google", sub: "g-2" }), undefined)).resolves.toMatchObject({ via: "email" });
        users.table.delete(ME);
        await expect(linkOrCreate(identity({ sub: "003.apple" }), undefined)).resolves.toMatchObject({ via: "email" });
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

    it("題は短く、本文は「こちらから連携を解除できます」とリンク1つ。差出人は journey.photo。HTML とテキストの両方", async () => {
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
