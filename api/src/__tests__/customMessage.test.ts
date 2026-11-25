import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { customMessage, mailKindFor, verificationEmail, COPY, LOGO_URL, PHOTO_URL, SITE, type CustomMessageEvent } from "../customMessage";

const ev = (triggerSource: string, codeParameter: string | undefined = "{####}"): CustomMessageEvent => ({
    triggerSource,
    request: { codeParameter, usernameParameter: null, userAttributes: { email: "a@example.com", sub: "s" } },
    response: { emailSubject: null, emailMessage: null, smsMessage: null },
});

describe("確認コードのメール（CustomMessage）", () => {
    // 2026-11-25: 再設定で受け取ったのに「ご登録を完了させるために」と届いた。用途で文面を分ける
    it("新規登録と再設定で、件名も本文も違う", async () => {
        const up = await customMessage(ev("CustomMessage_SignUp"));
        const re = await customMessage(ev("CustomMessage_ForgotPassword"));
        expect(up.response?.emailSubject).toBe(COPY.signup.subject);
        expect(re.response?.emailSubject).toBe(COPY.reset.subject);
        expect(up.response?.emailSubject).not.toBe(re.response?.emailSubject);
        expect(re.response?.emailMessage).toContain("パスワードの再設定");
        expect(re.response?.emailMessage).not.toContain("ようこそ");
        expect(re.response?.emailMessage).not.toContain("登録の画面");
    });

    it("送り直しは新規登録と同じ文面。メールアドレスの確認は別の文面", () => {
        expect(mailKindFor("CustomMessage_SignUp")).toBe("signup");
        expect(mailKindFor("CustomMessage_ResendCode")).toBe("signup");
        expect(mailKindFor("CustomMessage_ForgotPassword")).toBe("reset");
        expect(mailKindFor("CustomMessage_UpdateUserAttribute")).toBe("verifyEmail");
        expect(mailKindFor("CustomMessage_VerifyUserAttribute")).toBe("verifyEmail");
    });

    // 管理者が作る人（仮のパスワードと {username} が要る）や MFA は、プールの今の文面のまま
    it("知らない種類には何も書かない", async () => {
        for (const t of ["CustomMessage_AdminCreateUser", "CustomMessage_Authentication", "PreSignUp_SignUp", ""]) {
            const out = await customMessage(ev(t));
            expect(out.response?.emailMessage).toBeNull();
            expect(out.response?.emailSubject).toBeNull();
        }
    });

    // Cognito はコードの置き場が本文に無いと断る（登録ごと失敗する）。1回だけ書く
    it("本文に Cognito のコードの置き場がちょうど1つある", async () => {
        for (const t of ["CustomMessage_SignUp", "CustomMessage_ForgotPassword", "CustomMessage_UpdateUserAttribute"]) {
            const html = (await customMessage(ev(t))).response?.emailMessage ?? "";
            expect(html.split("{####}").length - 1).toBe(1);
        }
    });

    it("コードの置き場が来なければ何も書かない（プールの今の文面のまま）", async () => {
        const out = await customMessage(ev("CustomMessage_SignUp", ""));
        expect(out.response?.emailMessage).toBeNull();
    });

    // 投げると Cognito は登録ごと失敗にする
    it("壊れた入力でも投げない", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(customMessage(null as any)).resolves.toBeNull();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(customMessage({ triggerSource: "CustomMessage_SignUp" } as any)).resolves.toBeTruthy();
        spy.mockRestore();
    });

    // Cognito の emailMessage の上限は 20,000 字
    it("本文は Cognito の上限より十分短い", () => {
        for (const k of ["signup", "reset", "verifyEmail"] as const) {
            expect(verificationEmail(k, "{####}").html.length).toBeLessThan(12000);
        }
    });

    // コピーしても空白が入らない（字の間は letter-spacing）
    it("コードは空白なしの1つの文字列で置く", () => {
        const html = verificationEmail("signup", "482913").html;
        expect(html).toMatch(/>482913<\/td>/);
        expect(html).not.toMatch(/4\s8\s2/);
    });

    it("有効期限: 登録は24時間、再設定は1時間", () => {
        expect(verificationEmail("signup", "1").html).toContain("24時間");
        expect(verificationEmail("reset", "1").html).toContain("1時間");
        expect(verificationEmail("reset", "1").html).not.toContain("24時間");
    });

    // owner の好み: 「捨てる」系（破棄）を言わない、「・」で区切らない、硬い言い回しをしない。年の入った © を置かない
    it("言葉の決まりを守る", () => {
        for (const k of ["signup", "reset", "verifyEmail"] as const) {
            const { subject, html } = verificationEmail(k, "{####}");
            const text = html.replace(/<[^>]+>/g, " ");
            for (const ng of ["破棄", "捨て", "・", "·", "誠に", "恐れ入", "©", "撮りどき"]) {
                expect(text, `${k}: ${ng}`).not.toContain(ng);
                expect(subject).not.toContain(ng);
            }
            // 件名にコードを入れない
            expect(subject).not.toContain("{####}");
            expect(text).toContain("心当たりが無ければ、このメールは無視してください。");
        }
    });

    // 画像が出ない受信箱でも名前は文字で残る。写真には説明の文字を付ける
    it("名前は文字で、写真には alt がある", () => {
        const html = verificationEmail("signup", "1").html;
        expect(html).toMatch(/>Journey Photo<\/td>/);
        expect(html).toMatch(/<img src="[^"]*hero-opera-garnier\.jpg"[^>]*alt="[^"]+"/);
    });

    // 画像はサイトの公開の URL から読む。リポジトリの public に無い名前を指すと、受信箱で割れる
    it("画像の URL は public に在るファイルを指す", () => {
        for (const url of [LOGO_URL, PHOTO_URL]) {
            expect(url.startsWith(`${SITE}/`)).toBe(true);
            const rel = url.slice(SITE.length + 1);
            expect(existsSync(path.join(__dirname, "../../../public", rel)), rel).toBe(true);
        }
    });

    // メールの決まり: 表の組み、幅 600
    it("表で組み、幅は 600 まで", () => {
        const html = verificationEmail("signup", "1").html;
        expect(html).toContain('role="presentation"');
        expect(html).toContain("max-width:600px");
        expect(html).not.toMatch(/display:\s*(flex|grid)/);
    });
});
