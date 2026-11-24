import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { customMessageFor, handler, LOGO_URL, SITE_URL, TAGLINE, DO_NOT_SHARE } from "../cognitoCustomMessage";

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

    it("種類ごとに件名が違う（何のコードか分かる）・先頭の【Journey Photo】で誰からか分かる", () => {
        expect(customMessageFor("CustomMessage_SignUp", CODE)!.subject).toBe("【Journey Photo】登録の確認コード");
        expect(customMessageFor("CustomMessage_ResendCode", CODE)!.subject).toBe("【Journey Photo】登録の確認コード（再送）");
        expect(customMessageFor("CustomMessage_ForgotPassword", CODE)!.subject).toBe("【Journey Photo】パスワード再設定の確認コード");
        expect(customMessageFor("CustomMessage_UpdateUserAttribute", CODE)!.subject).toBe("【Journey Photo】メールアドレス変更の確認コード");
        expect(customMessageFor("CustomMessage_VerifyUserAttribute", CODE)!.subject).toBe("【Journey Photo】メールアドレス変更の確認コード");
    });

    it("名前は「Journey Photo」に揃える（古い表記の journey.photo を本文に残さない）", () => {
        for (const s of SOURCES) {
            const { html, subject } = customMessageFor(s, CODE)!;
            expect(html, s).not.toMatch(/journey\.photo(?!\.official)/);
            expect(subject, s).not.toMatch(/journey\.photo/);
        }
    });

    it("4種類すべてに「コードを人に教えない」・心当たりが無いとき・英語の要約・サイトの言葉を書く（返信の行き先は書かない）", () => {
        for (const s of SOURCES) {
            const { html } = customMessageFor(s, CODE)!;
            expect(html, s).toContain(DO_NOT_SHARE);
            expect(html, s).toContain("心当たりが無い場合は");
            expect(html, s).toMatch(/<div [^>]*lang="en">Your (new )?Journey Photo [a-z -]+code\./);
            expect(html, s).toContain(TAGLINE);
            // 返信の行き先は書かない（既定の送り方に戻すと返信先が消え、嘘になる）
            expect(html, s).not.toMatch(/返信/);
        }
        // サイトの言葉は、ログインの画面（AuthPhotoBand）と同じ文
        const band = readFileSync(join(__dirname, "..", "..", "..", "app", "components", "AuthPhotoBand.tsx"), "utf8");
        expect(band).toContain(TAGLINE);
    });

    it("受信箱の一覧の1行（preheader）は本文の先頭に隠し、暗い面なので color-scheme を dark と宣言する", () => {
        for (const s of SOURCES) {
            const { html } = customMessageFor(s, CODE)!;
            const body = html.slice(html.indexOf("<body"));
            expect(body, s).toMatch(/^<body[^>]*><div style="display:none;[^"]*">[^<]+/);
            expect(html, s).toContain('<meta name="color-scheme" content="dark">');
        }
    });

    it("外から読むのは公式のアイコン1つだけ・リンクはサイトへの1本だけ（CSS・字体は読まない）", () => {
        for (const s of SOURCES) {
            const { html } = customMessageFor(s, CODE)!;
            expect(html, s).not.toMatch(/<link|url\(|<style/);
            expect(html.match(/https?:\/\/[^"' )]+/g), s).toEqual([LOGO_URL, SITE_URL]);
            expect(html.match(/<img /g), s).toHaveLength(1);
            expect(html.match(/<a /g), s).toHaveLength(1);
        }
    });

    it("頭は公式のロゴ: 絞りのアイコンと、文字ロゴの字体の「Journey Photo」（サイトの --font-wordmark と同じ並び）", () => {
        const { html } = customMessageFor("CustomMessage_SignUp", CODE)!;
        expect(LOGO_URL).toBe("https://journey-photo.com/logo-aperture.png");
        expect(html).toContain(`<img src="${LOGO_URL}" width="36" height="36"`);
        expect(html).toMatch(/font-family:ui-serif,'New York',Georgia,serif;[^>]*>Journey Photo</);
        const css = readFileSync(join(__dirname, "..", "..", "..", "app", "globals.css"), "utf8");
        expect(css).toContain('--font-wordmark: ui-serif, "New York", Georgia, serif;');
        // アイコンはサイトの公開物にある（配っている物と同じ）
        expect(existsSync(join(__dirname, "..", "..", "..", "public", "logo-aperture.png"))).toBe(true);
    });

    it("🔴 長すぎない（owner「文章長すぎるかも」）: 見える日本語の文は見出しを除いて5文まで", () => {
        for (const s of SOURCES) {
            const { html } = customMessageFor(s, CODE)!;
            const body = html.slice(html.indexOf("</div>", html.indexOf("<body")));
            const visible = body.replace(/<[^>]+>/g, "\n");
            const sentences = visible.match(/[^\n。]+。/g) ?? [];
            // 足もとのサイトの言葉（1文）は数えない
            expect(sentences.length - 1, s).toBeLessThanOrEqual(5);
        }
    });

    it("期限の時間は登録（24時間・再送も同じ）だけに書く", () => {
        expect(customMessageFor("CustomMessage_SignUp", CODE)!.html).toContain("有効期限は24時間です。");
        expect(customMessageFor("CustomMessage_ResendCode", CODE)!.html).toContain("有効期限は24時間です。");
        expect(customMessageFor("CustomMessage_ForgotPassword", CODE)!.html).not.toMatch(/\d+時間/);
        for (const s of ["CustomMessage_ForgotPassword", "CustomMessage_UpdateUserAttribute", "CustomMessage_VerifyUserAttribute"]) {
            const { html } = customMessageFor(s, CODE)!;
            expect(html, s).not.toMatch(/\d+時間|\d+ ?hours?|expires/);
        }
    });

    it("使っていない種類（招待・多要素の認証）と、差し込み口の無い呼び出しは変えない", () => {
        expect(customMessageFor("CustomMessage_AdminCreateUser", CODE)).toBeNull();
        expect(customMessageFor("CustomMessage_Authentication", CODE)).toBeNull();
        expect(customMessageFor("CustomMessage_SignUp", "")).toBeNull();
    });
    it("確かめていないことは書かない（再送で前のコードが無効か・確認までアドレスが変わらないか）", () => {
        expect(customMessageFor("CustomMessage_ResendCode", CODE)!.html).not.toMatch(/以前|前の(コード|お送り)/);
        expect(customMessageFor("CustomMessage_UpdateUserAttribute", CODE)!.html).not.toMatch(/変わりません|これまでの/);
    });
});

describe("handler", () => {
    it("知っている種類は件名と本文を入れ、ほかの応答の欄は残す", async () => {
        const out = await handler({ triggerSource: "CustomMessage_SignUp", request: { codeParameter: CODE }, response: { smsMessage: "sms" } });
        expect(out.response?.emailSubject).toBe("【Journey Photo】登録の確認コード");
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
