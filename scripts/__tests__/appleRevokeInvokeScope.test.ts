import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 🔴 **Apple の取り消しの関数（`photo-gallery-apple-signin-<stage>-appleRevoke`）を呼べるのは退会（`deleteAccount`）だけ**
 * （札 journey.photo-ios#601・2026-11-23 確かめ役の3回目）。
 *
 * - user API の共通の役（provider）には `lambda:InvokeFunction` を置かない（全部の関数が呼べてしまう）
 * - 呼ぶ権限は退会だけの役 `DeleteAccountRole` に置き、その役を使うのは `deleteAccount` だけ
 * - 退会だけの役は、共通の役の文を `${self:provider.iam.role.statements}` で写す（手で写すと、共通の役に足した権限が抜ける）
 */
const ROOT = join(__dirname, "..", "..");
const dir = join(ROOT, "api-user");
const strip = (s: string) => s.replace(/^\s*#.*$/gm, "");
const userYml = readFileSync(join(dir, "serverless.yml"), "utf8");
const [provider, rest] = userYml.split(/\nfunctions:\n/);
const role = (() => {
    const i = userYml.indexOf("\n    DeleteAccountRole:\n");
    if (i < 0) return "";
    const after = userYml.slice(i + 1);
    const next = after.slice(1).search(/\n {4}[A-Z]\w+:\n|\n {2}Outputs:/);
    return strip(next < 0 ? after : after.slice(0, next + 1));
})();

describe("Apple の取り消しの関数を呼べるのは退会だけ", () => {
    it("共通の役（provider）には lambda:InvokeFunction を置かない", () => {
        expect(strip(provider)).not.toContain("lambda:InvokeFunction");
    });

    it("退会だけの役が共通の役の文を写し、取り消しの関数1つだけを呼べる", () => {
        expect(role).toContain("Type: AWS::IAM::Role");
        expect(role).toContain("Statement: ${self:provider.iam.role.statements}");
        const resources = [...role.matchAll(/arn:aws:lambda:[^\s]+/g)].map((m) => m[0]);
        expect(resources).toEqual(["arn:aws:lambda:${aws:region}:${aws:accountId}:function:photo-gallery-apple-signin-${sls:stage}-appleRevoke"]);
    });

    it("その役を使うのは deleteAccount だけ", () => {
        const fnSection = rest.split(/\n(?=[a-zA-Z#])/)[0];
        const users = ("\n" + fnSection).split(/\n(?=  \w+:\n)/)
            .filter((part) => /role:\s*DeleteAccountRole/.test(strip(part)))
            .map((part) => /^\n?  (\w+):/.exec(part)?.[1]);
        expect(users).toEqual(["deleteAccount"]);
    });

    it("ほかの設定（別のスタック）にも、取り消しの関数を呼ぶ権限は無い", () => {
        for (const f of readdirSync(dir).filter((n) => /^serverless\.[\w-]+\.yml$/.test(n))) {
            expect(strip(readFileSync(join(dir, f), "utf8")), f).not.toMatch(/arn:aws:lambda:[^\s]*-appleRevoke/);
        }
    });
});
