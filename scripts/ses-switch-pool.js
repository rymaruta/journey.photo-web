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
 * 既定は読むだけ（`--apply` で書く）。`REVERT=true` で既定の送り方（COGNITO_DEFAULT）へ戻す（SES が止められたときの逃げ道）。
 */
const { SESv2Client } = require("@aws-sdk/client-sesv2");
const {
    CognitoIdentityProviderClient, DescribeUserPoolCommand, UpdateUserPoolCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { changedKeys, poolNameForStage, ALWAYS_VOLATILE } = require("./attach-post-confirmation");
const { canSwitch, buildEmailUpdate, buildEmailRevert, readState, identityArn, reportError, FROM, REPLY_TO, REGION } = require("./setup-ses-sender");
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

    // 元に戻す（REVERT=true）: 既定の送り方へ。門は無い（戻すのはいつでも安全側）
    const revert = process.env.REVERT === "true";
    let params;
    let want;
    if (revert) {
        params = buildEmailRevert(pool);
        want = "COGNITO_DEFAULT";
        console.log(`→ 送り方を COGNITO_DEFAULT（既定）に戻す${apply ? "" : "（下見・--apply で実行）"}`);
    } else {
        const gate = canSwitch({ verified: id.verified, dkimStatus: id.dkimStatus, productionAccess: acct.productionAccess });
        if (!gate.ok) {
            for (const r of gate.reasons) console.log(`✋ 切り替えない: ${r}`);
            process.exitCode = 1;
            return;
        }
        params = buildEmailUpdate(pool, identityArn(pool.Arn.split(":")[4]));
        want = "DEVELOPER";
        console.log(`→ 送り方を DEVELOPER（SES）に・差出人 ${FROM}・返信先 ${REPLY_TO}${apply ? "" : "（下見・--apply で実行）"}`);
    }
    if (!apply) return;
    await idp.send(new UpdateUserPoolCommand(params));
    const { UserPool: after } = await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
    // 🔴 トリガー（LambdaConfig）も見る。外れると新しく登録した人が投稿できなくなる（attach の道具と違い、ここは狙って変えない）
    const changed = changedKeys(pool, after, ALWAYS_VOLATILE);
    console.log(`変わった項目: ${changed.join(", ") || "なし"}・いまの送り方 ${after.EmailConfiguration?.EmailSendingAccount ?? "COGNITO_DEFAULT"}`);
    if (changed.some((k) => k !== "EmailConfiguration")) {
        console.error("::error::メールの送り方の外の項目が変わった。すぐに確かめる");
        process.exitCode = 1;
    }
    if ((after.EmailConfiguration?.EmailSendingAccount ?? "COGNITO_DEFAULT") !== want) {
        console.error(`::error::送り方が ${want} になっていない`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(reportError);
}
