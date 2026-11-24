#!/usr/bin/env node
/**
 * **Cognito のプールの確認コードのメールを SES（journey-photo.com）から送るように切り替える**（2026-11-24）。
 * 段の全体と理由は `scripts/setup-ses-sender.js` の冒頭。これはその最後の段（プール ID と環境を名指しで受け取るので分けた）。
 *
 * 🔴 **ドメインの確認（DKIM が SUCCESS）と SES の本番での利用が両方済んでいなければ止める**——どちらかが欠けたまま
 * 切り替えると、登録の確認コードが届かなくなる。staging で受け取って確かめてから prod。
 *
 * 変えるのはメールの送り方（`EmailConfiguration`）だけ。書いたあと読み直し、ほかの項目が変わっていないことまで確かめる
 * （`UpdateUserPool` は渡さなかった項目を既定値に戻すため・`attach-post-confirmation.js` と同じやり方）。
 * 既定は読むだけ（`--apply` で書く）。
 */
const { SESv2Client } = require("@aws-sdk/client-sesv2");
const {
    CognitoIdentityProviderClient, DescribeUserPoolCommand, UpdateUserPoolCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { changedKeys, poolNameForStage } = require("./attach-post-confirmation");
const { canSwitch, buildEmailUpdate, readState, identityArn, reportError, FROM, REPLY_TO, REGION } = require("./setup-ses-sender");
const { requireEnv } = require("./lib/env");

async function main() {
    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const stage = requireEnv("STAGE");
    const apply = process.argv.includes("--apply");

    const { id, acct } = await readState(new SESv2Client({ region: REGION }));
    const idp = new CognitoIdentityProviderClient({ region: REGION });
    const { UserPool: pool } = await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
    if (pool.Name !== poolNameForStage(stage)) {
        throw new Error(`プール ${poolId} の名前が ${pool.Name}（${stage} なら ${poolNameForStage(stage)}）。組を確かめる`);
    }
    console.log(`プール ${pool.Name}: いまの送り方 ${pool.EmailConfiguration?.EmailSendingAccount ?? "COGNITO_DEFAULT"}`
        + (pool.EmailConfiguration?.From ? `・差出人 ${pool.EmailConfiguration.From}` : ""));

    const gate = canSwitch({ verified: id.verified, dkimStatus: id.dkimStatus, productionAccess: acct.productionAccess });
    if (!gate.ok) {
        for (const r of gate.reasons) console.log(`✋ 切り替えない: ${r}`);
        process.exitCode = 1;
        return;
    }

    const params = buildEmailUpdate(pool, identityArn(pool.Arn.split(":")[4]));
    console.log(`→ 送り方を DEVELOPER（SES）に・差出人 ${FROM}・返信先 ${REPLY_TO}${apply ? "" : "（下見・--apply で実行）"}`);
    if (!apply) return;
    await idp.send(new UpdateUserPoolCommand(params));
    const { UserPool: after } = await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
    const changed = changedKeys(pool, after);
    console.log(`変わった項目: ${changed.join(", ") || "なし"}`);
    if (changed.some((k) => k !== "EmailConfiguration")) {
        console.error("::error::メールの送り方の外の項目が変わった。すぐに確かめる");
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(reportError);
}
