import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { customMessageFor, handler } from "../cognitoCustomMessage";

/**
 * **確認コードのメールの文面**（CustomMessage・2026-11-24）。
 * 🔴 本文にコードの差し込み口が無いと Cognito が断り、確認コードのメールが1通も届かなくなる
 */
const CODE = "{####}";
const SOURCES = [
    "CustomMessage_SignUp", "CustomMessage_ResendCode", "CustomMessage_ForgotPassword",
    "CustomMessage_UpdateUserAttribute", "CustomMessage_VerifyUserAttribute",
];

describe("文面", () => {
    it("🔴 4種類すべてで、本文にコードの差し込み口がちょうど1つ・2万字以内・件名は140字以内", () => {
        for (const s of SOURCES) {
            const m = customMessageFor(s, CODE)!;
            expect(m, s).not.toBeNull();
            expect(m.html.split(CODE).length - 1, s).toBe(1);
            expect([...m.html].length, s).toBeLessThanOrEqual(20000);
            expect([...m.subject].length, s).toBeLessThanOrEqual(140);
        }
    });

    it("種類ごとに件名が違う（何のコードか分かる）", () => {
        expect(customMessageFor("CustomMessage_SignUp", CODE)!.subject).toBe("journey.photo の登録の確認コード");
        expect(customMessageFor("CustomMessage_ResendCode", CODE)!.subject).toBe("journey.photo の登録の確認コード（再送）");
        expect(customMessageFor("CustomMessage_ForgotPassword", CODE)!.subject).toBe("journey.photo のパスワード再設定の確認コード");
        expect(customMessageFor("CustomMessage_UpdateUserAttribute", CODE)!.subject).toBe("journey.photo の新しいメールアドレスの確認");
        expect(customMessageFor("CustomMessage_VerifyUserAttribute", CODE)!.subject).toBe("journey.photo の新しいメールアドレスの確認");
    });

    it("英語の画面の人のために英語の1行を添える・外の画像や CSS を読まない", () => {
        for (const s of SOURCES) {
            const { html } = customMessageFor(s, CODE)!;
            expect(html, s).toMatch(/journey\.photo (sign-up|password reset|email confirmation) code|new journey\.photo sign-up code/);
            expect(html, s).not.toMatch(/<img|<link|url\(|https?:\/\//);
        }
    });

    it("期限の時間は登録（24時間）だけに書く", () => {
        expect(customMessageFor("CustomMessage_SignUp", CODE)!.html).toContain("24時間");
        expect(customMessageFor("CustomMessage_ForgotPassword", CODE)!.html).not.toMatch(/\d+時間/);
        expect(customMessageFor("CustomMessage_UpdateUserAttribute", CODE)!.html).not.toMatch(/\d+時間/);
    });

    it("使っていない種類（招待・多要素の認証）と、差し込み口の無い呼び出しは変えない", () => {
        expect(customMessageFor("CustomMessage_AdminCreateUser", CODE)).toBeNull();
        expect(customMessageFor("CustomMessage_Authentication", CODE)).toBeNull();
        expect(customMessageFor("CustomMessage_SignUp", "")).toBeNull();
    });
});

describe("handler", () => {
    it("知っている種類は件名と本文を入れ、ほかの応答の欄は残す", async () => {
        const out = await handler({ triggerSource: "CustomMessage_SignUp", request: { codeParameter: CODE }, response: { smsMessage: "sms" } });
        expect(out.response?.emailSubject).toBe("journey.photo の登録の確認コード");
        expect(out.response?.emailMessage).toContain(CODE);
        expect(out.response?.smsMessage).toBe("sms");
    });

    it("知らない種類は応答に触らない（AWS の既定の文面のまま）", async () => {
        const ev = { triggerSource: "CustomMessage_AdminCreateUser", request: { codeParameter: CODE, usernameParameter: "{username}" }, response: {} };
        expect((await handler(ev)).response).toEqual({});
    });
});

describe("配線（serverless.yml）", () => {
    const yml = readFileSync(join(__dirname, "..", "..", "serverless.yml"), "utf8");
    it("既にあるプールに CustomMessage として付ける（プール名は環境ごとの値・既定値なし）", () => {
        const fn = yml.slice(yml.indexOf("  customMessage:"));
        expect(fn.slice(0, 600)).toMatch(/handler: src\/cognitoCustomMessage\.handler/);
        expect(fn.slice(0, 600)).toMatch(/pool: \$\{param:cognitoPoolName\}/);
        expect(fn.slice(0, 600)).toMatch(/trigger: CustomMessage/);
        expect(fn.slice(0, 600)).toMatch(/existing: true/);
    });
});
