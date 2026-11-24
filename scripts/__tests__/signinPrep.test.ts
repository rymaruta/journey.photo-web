import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 「Apple でサインイン」「Google でログイン」を使い始める準備の台本（札 journey.photo-ios#601・#715）。
 * どれも本番の Cognito・SSM・users 表を触る道具なので、判断の部分を純関数で直接見る。
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const stage = require("../lib/signinStage.js") as {
    assertStage: (s: string) => string;
    poolNameForStage: (s: string) => string;
    usersTableForStage: (s: string) => string;
    keyParamForStage: (s: string) => string;
    triggerFunctionForStage: (s: string) => string;
    assertUsersTable: (s: string, t: string) => string;
    assertPoolName: (s: string, id: string, name: string) => void;
};
const auth = require("../allow-custom-auth.js") as {
    FLOW: string;
    CLIENT_READ_ONLY: string[];
    planFlows: (c: Record<string, unknown>, o?: { remove?: boolean }) => { action: string; flows: string[] };
    buildClientUpdate: (c: Record<string, unknown>, flows: string[]) => Record<string, unknown>;
    changedClientKeys: (a: Record<string, unknown>, b: Record<string, unknown>) => string[];
};
const key = require("../apple-signin-key-to-ssm.js") as {
    normalizePem: (raw: string) => { pem: string; info: { length: number; lines: number; curve: string; publicFingerprint: string } };
    planPut: (a: { existingSha: string; newSha: string }) => string;
};
const ttl = require("../enable-users-ttl.js") as {
    ATTR: string;
    classifyRow: (r: Record<string, unknown>) => string;
    summarize: (rows: Array<{ userId: string; deletedAt?: string; ttl: number }>, now: number) => {
        total: number; kinds: Record<string, number>; expired: number; earliestTombstone: number | null; tombstonesSoon: number;
    };
    planTtl: (d: Record<string, unknown> | undefined) => string;
};
const ready = require("../signin-readiness.js") as {
    stableJson: (v: unknown) => string;
    fingerprints: (o: Record<string, unknown>, skip: string[]) => Record<string, string>;
    triggerState: (lc: Record<string, string> | undefined, arn: string) => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

describe("環境の取り違えの見張り", () => {
    // deploy-api.yml の値と同じ規則（ずれると Lambda の役が SSM を読めない・別の環境を触る）
    it("名前の規則は deploy-api.yml・serverless.apple-signin.yml と同じ", () => {
        expect(stage.poolNameForStage("prod")).toBe("prod-journey-photo-client-spa");
        expect(stage.usersTableForStage("staging")).toBe("staging-photo-gallery-users");
        expect(stage.keyParamForStage("prod")).toBe("/journey-photo/prod/apple-signin/private-key");
        expect(stage.triggerFunctionForStage("staging")).toBe("photo-gallery-apple-signin-staging-appleAuthChallenge");
        const deploy = readFileSync(join(process.cwd(), ".github/workflows/deploy-api.yml"), "utf8");
        expect(deploy).toContain("/journey-photo/${{ needs.config.outputs.envName }}/apple-signin/private-key");
        const sls = readFileSync(join(process.cwd(), "api-user/serverless.apple-signin.yml"), "utf8");
        expect(sls).toContain("parameter/journey-photo/${sls:stage}/apple-signin/*");
        expect(sls).toMatch(/\n {2}appleAuthChallenge:\n/);
    });

    it("知らない環境・別の環境の表やプールは止める", () => {
        expect(() => stage.assertStage("dev")).toThrow();
        expect(() => stage.assertUsersTable("staging", "prod-photo-gallery-users")).toThrow();
        expect(() => stage.assertPoolName("prod", "p", "staging-journey-photo-client-spa")).toThrow();
        expect(() => stage.assertPoolName("prod", "p", "prod-journey-photo-client-spa")).not.toThrow();
    });
});

describe("allow-custom-auth", () => {
    // 2026-11-24 に読んだ本番のクライアントの形（値は架空のものに替えた）
    const prodLike = {
        UserPoolId: "ap-northeast-1_X", ClientName: "c", ClientId: "id",
        ClientSecret: "SECRET", LastModifiedDate: 1, CreationDate: 0,
        RefreshTokenValidity: 3650, AccessTokenValidity: 60, IdTokenValidity: 60,
        TokenValidityUnits: { AccessToken: "minutes", IdToken: "minutes", RefreshToken: "days" },
        ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"],
        SupportedIdentityProviders: ["COGNITO"], CallbackURLs: ["https://example.com/"], LogoutURLs: ["https://example.com/"],
        AllowedOAuthFlows: ["code"], AllowedOAuthScopes: ["email", "openid", "phone"], AllowedOAuthFlowsUserPoolClient: true,
        PreventUserExistenceErrors: "ENABLED", EnableTokenRevocation: true, EnablePropagateAdditionalUserContextData: false,
        AuthSessionValidity: 3,
    };

    it("足すのは1つだけで、今の流れは全部残す", () => {
        const plan = auth.planFlows(prodLike);
        expect(plan.action).toBe("add");
        expect(plan.flows).toEqual([...prodLike.ExplicitAuthFlows, "ALLOW_CUSTOM_AUTH"].sort());
    });

    it("もう付いていれば何もしない・外すときは1つだけ外す", () => {
        const withIt = { ...prodLike, ExplicitAuthFlows: [...prodLike.ExplicitAuthFlows, "ALLOW_CUSTOM_AUTH"] };
        expect(auth.planFlows(withIt).action).toBe("none");
        const r = auth.planFlows(withIt, { remove: true });
        expect(r.action).toBe("remove");
        expect(r.flows).toEqual([...prodLike.ExplicitAuthFlows].sort());
        expect(auth.planFlows(prodLike, { remove: true }).action).toBe("none");
    });

    // 空のクライアントは既定の流れで動いている。1つだけ渡すと、ふだんのログインが止まる
    it("ExplicitAuthFlows が空なら止める", () => {
        expect(() => auth.planFlows({ ...prodLike, ExplicitAuthFlows: [] })).toThrow();
        expect(() => auth.planFlows({ ClientId: "id" })).toThrow();
        expect(() => auth.planFlows({ ExplicitAuthFlows: ["ALLOW_CUSTOM_AUTH"] }, { remove: true })).toThrow();
    });

    // 🔴 UpdateUserPoolClient は渡さなかった項目を既定に戻す。書ける項目は1つも落とさない
    it("送り返す本文は、読み取り専用の3つのほかを全部持つ", () => {
        expect([...auth.CLIENT_READ_ONLY].sort()).toEqual(["ClientSecret", "CreationDate", "LastModifiedDate"]);
        const p = auth.buildClientUpdate(prodLike, auth.planFlows(prodLike).flows);
        expect(p.ClientSecret).toBeUndefined();
        const kept = Object.keys(prodLike).filter((k) => !auth.CLIENT_READ_ONLY.includes(k)).sort();
        expect(Object.keys(p).sort()).toEqual(kept);
        expect(p.CallbackURLs).toEqual(prodLike.CallbackURLs);
        expect(p.RefreshTokenValidity).toBe(3650);
        expect(p.ExplicitAuthFlows).toContain("ALLOW_CUSTOM_AUTH");
    });

    it("前後の比べは ExplicitAuthFlows と更新日時を見ず、ほかの違いを名前で出す", () => {
        const after = { ...prodLike, LastModifiedDate: 2, ExplicitAuthFlows: ["x"] };
        expect(auth.changedClientKeys(prodLike, after)).toEqual([]);
        const lost: Record<string, unknown> = { ...after };
        delete lost.CallbackURLs;
        lost.RefreshTokenValidity = 30;
        expect(auth.changedClientKeys(prodLike, lost)).toEqual(["CallbackURLs", "RefreshTokenValidity"]);
    });
});

describe("apple-signin-key-to-ssm", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();

    it("Apple の形（EC の P-256・PKCS#8）を受け、改行・CR・1行の形をそろえる", () => {
        const a = key.normalizePem(ec);
        expect(a.info.curve).toBe("prime256v1");
        expect(a.info.publicFingerprint).toMatch(/^[0-9a-f]{16}$/);
        // Secrets に CRLF で貼った回・`\n` の1行にした回も、同じ中身になる
        expect(key.normalizePem(ec.replace(/\n/g, "\r\n")).pem).toBe(a.pem);
        expect(key.normalizePem(ec.trim().replace(/\n/g, "\\n")).pem).toBe(a.pem);
    });

    it("壊れた鍵・別の形の鍵は止める", () => {
        expect(() => key.normalizePem("")).toThrow();
        expect(() => key.normalizePem("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----")).toThrow();
        const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
        expect(() => key.normalizePem(p384)).toThrow(/P-256/);
        const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
        expect(() => key.normalizePem(rsa)).toThrow(/P-256/);
    });

    // 🔴 誤りの文に鍵の中身を混ぜない（ログに出る）
    it("誤りの文に鍵の中身が混じらない", () => {
        const broken = ec.replace("PRIVATE KEY-----\n", "PRIVATE KEY-----\n!!");
        try { key.normalizePem(broken); } catch (e) {
            expect(String((e as Error).message)).not.toContain(ec.split("\n")[1].slice(0, 20));
        }
    });

    it("無ければ作る・同じなら何もしない・違えば上書き", () => {
        expect(key.planPut({ existingSha: "", newSha: "a" })).toBe("create");
        expect(key.planPut({ existingSha: "a", newSha: "a" })).toBe("none");
        expect(key.planPut({ existingSha: "b", newSha: "a" })).toBe("overwrite");
    });
});

describe("enable-users-ttl", () => {
    const now = 1_800_000_000;
    const day = 86400;

    it("行の種類を分ける", () => {
        expect(ttl.classifyRow({ userId: "u1", deletedAt: "2026-01-01" })).toBe("tombstone");
        expect(ttl.classifyRow({ userId: "nonce#apple#abc" })).toBe("nonce");
        expect(ttl.classifyRow({ userId: "apple#001" })).toBe("federated");
        expect(ttl.classifyRow({ userId: "google#1" })).toBe("federated");
        expect(ttl.classifyRow({ userId: "u2" })).toBe("other");
    });

    it("期限の過ぎた数・いちばん早い墓石・30 日以内の墓石を数える", () => {
        const s = ttl.summarize([
            { userId: "nonce#apple#a", ttl: now - 10 },
            { userId: "u1", deletedAt: "x", ttl: now + 400 * day },
            { userId: "u2", deletedAt: "x", ttl: now + 10 * day },
            { userId: "apple#1", ttl: now + 100 * day },
        ], now);
        expect(s.total).toBe(4);
        expect(s.kinds).toEqual({ tombstone: 2, nonce: 1, federated: 1, other: 0 });
        expect(s.expired).toBe(1);
        expect(s.earliestTombstone).toBe(now + 10 * day);
        expect(s.tombstonesSoon).toBe(1);
    });

    it("無効なら有効に・欄が ttl で有効なら何もしない・別の欄や切り替え中は止める", () => {
        expect(ttl.planTtl(undefined)).toBe("enable");
        expect(ttl.planTtl({ TimeToLiveStatus: "DISABLED" })).toBe("enable");
        expect(ttl.planTtl({ TimeToLiveStatus: "ENABLED", AttributeName: "ttl" })).toBe("none");
        expect(() => ttl.planTtl({ TimeToLiveStatus: "ENABLED", AttributeName: "expiresAt" })).toThrow();
        expect(() => ttl.planTtl({ TimeToLiveStatus: "ENABLING" })).toThrow();
    });

    // 墓石の ttl（account.ts）と nonce の ttl（federatedAccount.ts）が同じ欄の名前であること
    it("欄の名前は account.ts・federatedAccount.ts と同じ ttl", () => {
        expect(ttl.ATTR).toBe("ttl");
        for (const f of ["api-user/src/account.ts", "api-user/src/federatedAccount.ts"]) {
            expect(readFileSync(join(process.cwd(), f), "utf8")).toMatch(/\bttl\b/);
        }
    });
});

describe("signin-readiness", () => {
    it("指紋は鍵の順に左右されず、値の違いで変わる", () => {
        expect(ready.stableJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(ready.stableJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
        const a = ready.fingerprints({ X: { p: 1 }, LambdaConfig: { a: 1 }, Y: 2 }, ["LambdaConfig"]);
        expect(Object.keys(a)).toEqual(["X", "Y"]);
        expect(ready.fingerprints({ X: { p: 2 }, Y: 2 }, [])).not.toEqual(a);
        expect(ready.fingerprints({ X: { p: 1 }, Y: 2 }, [])).toEqual(a);
    });

    it("トリガー3つが同じ関数を指しているかを見る", () => {
        const arn = "arn:fn";
        expect(ready.triggerState({ PostConfirmation: "p" }, "")).toBe("none");
        expect(ready.triggerState({ DefineAuthChallenge: arn, CreateAuthChallenge: arn, VerifyAuthChallengeResponse: arn }, arn)).toBe("ok");
        expect(ready.triggerState({ DefineAuthChallenge: arn }, arn)).toBe("partial");
        expect(ready.triggerState({ DefineAuthChallenge: "x", CreateAuthChallenge: "x", VerifyAuthChallengeResponse: "x" }, arn)).toBe("other");
    });
});
