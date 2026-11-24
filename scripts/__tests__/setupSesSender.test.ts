import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **確認コードのメールの送り元を journey-photo.com にする道具**（`scripts/setup-ses-sender.js`・2026-11-24）。
 * AWS には触らない。決め事（純関数）と、保守のワークフローの配線を見る
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../setup-ses-sender.js") as {
    dkimRecords: (tokens: string[], domain?: string) => Array<{ Name: string; Type: string; ResourceRecords: Array<{ Value: string }> }>;
    planRecordChanges: (a: { tokens: string[]; existing: Array<Record<string, unknown>>; domain?: string }) => Array<{ Action: string; ResourceRecordSet: { Name: string; Type: string; ResourceRecords: Array<{ Value: string }> } }>;
    canSwitch: (a: { verified: boolean; dkimStatus?: string; productionAccess: boolean }) => { ok: boolean; reasons: string[] };
    buildEmailUpdate: (pool: Record<string, unknown>, arn: string) => Record<string, unknown>;
    FROM: string; FROM_ADDRESS: string; REPLY_TO: string; DOMAIN: string;
    PRODUCTION_REQUEST: { MailType: string; UseCaseDescription: string; WebsiteURL: string };
};
const root = join(__dirname, "..", "..");

describe("DNS のレコード", () => {
    it("DKIM は SES の決まった形の CNAME 3本", () => {
        const r = mod.dkimRecords(["aaa", "bbb", "ccc"]);
        expect(r.map((x) => x.Name)).toEqual(["aaa._domainkey.journey-photo.com.", "bbb._domainkey.journey-photo.com.", "ccc._domainkey.journey-photo.com."]);
        expect(r.every((x) => x.Type === "CNAME")).toBe(true);
        expect(r[0].ResourceRecords[0].Value).toBe("aaa.dkim.amazonses.com");
    });

    it("何も無ければ DKIM 3本と DMARC（p=none）を書く", () => {
        const c = mod.planRecordChanges({ tokens: ["a", "b", "c"], existing: [] });
        expect(c.filter((x) => x.ResourceRecordSet.Type === "CNAME")).toHaveLength(3);
        const dmarc = c.find((x) => x.ResourceRecordSet.Name === "_dmarc.journey-photo.com.")!;
        expect(dmarc.Action).toBe("CREATE");
        expect(dmarc.ResourceRecordSet.ResourceRecords[0].Value).toBe('"v=DMARC1; p=none"');
    });

    it("🔴 揃っていれば何も書かない・既にある DMARC は上書きしない", () => {
        const existing = [
            ...mod.dkimRecords(["a", "b", "c"]),
            { Name: "_dmarc.journey-photo.com.", Type: "TXT", ResourceRecords: [{ Value: '"v=DMARC1; p=reject"' }] },
        ];
        expect(mod.planRecordChanges({ tokens: ["a", "b", "c"], existing })).toEqual([]);
    });

    it("DKIM の値が違えば直す（UPSERT）", () => {
        const existing = [{ Name: "a._domainkey.journey-photo.com.", Type: "CNAME", ResourceRecords: [{ Value: "old.example" }] }];
        const c = mod.planRecordChanges({ tokens: ["a"], existing });
        expect(c.find((x) => x.ResourceRecordSet.Name.startsWith("a._domainkey"))!.Action).toBe("UPSERT");
    });
});

describe("🔴 切り替えてよいか（どちらかが欠けたまま切り替えると、登録の確認コードが届かなくなる）", () => {
    it("ドメインの確認と本番での利用が両方済んでいれば通す", () => {
        expect(mod.canSwitch({ verified: true, dkimStatus: "SUCCESS", productionAccess: true })).toEqual({ ok: true, reasons: [] });
    });
    it("本番での利用がまだ（sandbox）なら止める", () => {
        const r = mod.canSwitch({ verified: true, dkimStatus: "SUCCESS", productionAccess: false });
        expect(r.ok).toBe(false);
        expect(r.reasons.join()).toContain("sandbox");
    });
    it("DKIM が確認中・失敗なら止める", () => {
        for (const s of ["PENDING", "FAILED", "TEMPORARY_FAILURE", undefined]) {
            expect(mod.canSwitch({ verified: true, dkimStatus: s, productionAccess: true }).ok, String(s)).toBe(false);
        }
        expect(mod.canSwitch({ verified: false, dkimStatus: "SUCCESS", productionAccess: true }).ok).toBe(false);
    });
});

describe("プールの更新の本文", () => {
    const pool = {
        Id: "ap-northeast-1_x", Name: "prod-journey-photo-client-spa", Arn: "arn:aws:cognito-idp:ap-northeast-1:123:userpool/x",
        LambdaConfig: { PostConfirmation: "arn:aws:lambda:ap-northeast-1:123:function:f" },
        AutoVerifiedAttributes: ["email"],
        EmailConfiguration: { EmailSendingAccount: "COGNITO_DEFAULT" },
        AliasAttributes: ["email"], CreationDate: "x", EstimatedNumberOfUsers: 3,
    };

    it("メールの送り方だけを SES（DEVELOPER）にし、差出人・返信先を入れる", () => {
        const p = mod.buildEmailUpdate(pool, "arn:aws:ses:ap-northeast-1:123:identity/journey-photo.com");
        expect(p.EmailConfiguration).toEqual({
            EmailSendingAccount: "DEVELOPER",
            SourceArn: "arn:aws:ses:ap-northeast-1:123:identity/journey-photo.com",
            From: '"journey.photo" <no-reply@journey-photo.com>',
            ReplyToEmailAddress: mod.REPLY_TO,
        });
        // 🔴 ほかの設定は残す（UpdateUserPool は渡さなかった項目を既定値に戻す）・読み取り専用は落とす
        expect(p.LambdaConfig).toEqual(pool.LambdaConfig);
        expect(p.AutoVerifiedAttributes).toEqual(["email"]);
        expect(p.UserPoolId).toBe("ap-northeast-1_x");
        for (const k of ["Id", "Name", "Arn", "AliasAttributes", "CreationDate", "EstimatedNumberOfUsers"]) expect(p, k).not.toHaveProperty(k);
    });
});

describe("値の突き合わせ", () => {
    it("返信先はサイトの問い合わせ先（deploy.yml の contactEmail）と同じ", () => {
        const deploy = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");
        const m = deploy.match(/contactEmail=([^\s"]+@[^\s"]+)/);
        expect(m?.[1]).toBe(mod.REPLY_TO);
    });

    it("送り元はサインインの方法の知らせ（federatedNotice.ts）と同じアドレス", () => {
        const notice = readFileSync(join(root, "api-user/src/federatedNotice.ts"), "utf8");
        expect(notice).toContain(`export const DEFAULT_FROM = "${mod.FROM_ADDRESS}";`);
    });

    it("本番での利用の申請は取引のメールだけ・サイトの URL", () => {
        expect(mod.PRODUCTION_REQUEST.MailType).toBe("TRANSACTIONAL");
        expect(mod.PRODUCTION_REQUEST.WebsiteURL).toBe("https://journey-photo.com");
        expect(mod.PRODUCTION_REQUEST.UseCaseDescription).toMatch(/No marketing/);
    });
});

describe("保守のワークフローの配線", () => {
    const wf = readFileSync(join(root, ".github/workflows/maintenance.yml"), "utf8");
    it("5つの作業を選べて、既定は読むだけ（apply のときだけ --apply）", () => {
        for (const t of ["ses-status", "ses-identity", "ses-production-access", "ses-switch-staging", "ses-switch-prod"]) {
            expect(wf, t).toMatch(new RegExp(`- ${t}\\b`));
            expect(wf, t).toMatch(new RegExp(`if: inputs\\.task == '${t}'`));
        }
        expect(wf).toMatch(/node scripts\/setup-ses-sender\.js \$\{\{ inputs\.apply && '--apply' \|\| '' \}\}/);
        expect(wf).toMatch(/node scripts\/ses-switch-pool\.js \$\{\{ inputs\.apply && '--apply' \|\| '' \}\}/);
    });
    it("切り替えはプール ID と環境を名指しする（本番と staging を取り違えない）", () => {
        const prod = wf.slice(wf.indexOf("if: inputs.task == 'ses-switch-prod'"));
        expect(prod.slice(0, 400)).toMatch(/STAGE: prod/);
        const stg = wf.slice(wf.indexOf("if: inputs.task == 'ses-switch-staging'"));
        expect(stg.slice(0, 400)).toMatch(/STAGE: staging/);
    });
});
