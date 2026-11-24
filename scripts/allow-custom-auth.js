#!/usr/bin/env node
/**
 * Cognito のアプリのクライアントに `ALLOW_CUSTOM_AUTH` を足す（または外す）。札 journey.photo-ios#601・#715。
 *
 * 「Apple でサインイン」「Google でログイン」は、サーバーが出す使い捨ての券を CUSTOM_AUTH の答えに出して
 * Cognito に入る（`api-user/src/appleAuthTrigger.ts`）。クライアントが CUSTOM_AUTH を受けないと、券を出しても入れない。
 * クライアントは CloudFormation の外で作ったものなので、ここで1回だけ変える（手順は iOS の `docs/APPLE_SIGNIN.md` の 3）。
 *
 * 🔴 `UpdateUserPoolClient` は**渡さなかった項目を既定に戻す**（AWS の仕様）。だから `DescribeUserPoolClient` の中身を
 *    丸ごと送り返し、読み取り専用の項目だけ落とし、`ExplicitAuthFlows` に1つ足す（外す）だけにする。
 *    本番のクライアントには OAuth のコールバック・更新トークンの期限 3650 日・アカウントの有無を教えない設定などがあり、
 *    1つでも落ちるとログイン全体に響く。**変えたあと読み直して、ExplicitAuthFlows 以外が1項目も変わっていないこと
 *    まで確かめる**（変わっていれば差分の項目名を出して失敗）。
 *
 * 足す順: トリガー（Apple のスタック）が無い間に足しても、CUSTOM_AUTH を始めると Cognito が断るだけで、ほかのログインは
 *   変わらない。ボタンが出る（`/auth/apple/status` が available）前に足しておけば、出た瞬間から入れる。
 * 戻す順（手順書の 5）: **これを先に外してから**スタックを消す。
 *
 *   node scripts/allow-custom-auth.js            # 読むだけ（何をするか出す）
 *   node scripts/allow-custom-auth.js --apply    # 足す
 *   node scripts/allow-custom-auth.js --remove [--apply]  # 外す（戻すとき）
 */
const {
    CognitoIdentityProviderClient, DescribeUserPoolCommand, DescribeUserPoolClientCommand, UpdateUserPoolClientCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { requireEnv } = require("./lib/env");
const { assertStage, assertPoolName } = require("./lib/signinStage");

const FLOW = "ALLOW_CUSTOM_AUTH";

/** DescribeUserPoolClient が返すが UpdateUserPoolClient には渡せない項目（秘密を含む）。ここに書き込める項目を入れない */
const CLIENT_READ_ONLY = ["ClientSecret", "CreationDate", "LastModifiedDate"];

/** 前後で見比べるときに外す項目（読み直すたびに変わるものと、狙って変える ExplicitAuthFlows） */
const CLIENT_VOLATILE = ["LastModifiedDate", "ExplicitAuthFlows"];

/**
 * 何をするか（純関数）。🔴 今の ExplicitAuthFlows が空・無いときは止める: 空のクライアントは Cognito の既定の流れ
 * （SRP など）で動いていて、`[ALLOW_CUSTOM_AUTH]` だけを渡すとふだんのログインが止まる。
 *
 * @returns {{ action: "none" | "add" | "remove", flows: string[] }}
 */
function planFlows(client, { remove = false } = {}) {
    const now = client?.ExplicitAuthFlows ?? [];
    if (now.length === 0) {
        throw new Error("ExplicitAuthFlows が空です。既定の流れで動いているクライアントに1つだけ渡すと、ふだんのログインが止まります。手で確かめてください");
    }
    const has = now.includes(FLOW);
    if (remove) {
        if (!has) return { action: "none", flows: [...now].sort() };
        const flows = now.filter((f) => f !== FLOW).sort();
        if (flows.length === 0) throw new Error(`${FLOW} を外すと流れが1つも残りません`);
        return { action: "remove", flows };
    }
    if (has) return { action: "none", flows: [...now].sort() };
    return { action: "add", flows: [...now, FLOW].sort() };
}

/**
 * UpdateUserPoolClient に渡す本文（純関数）。DescribeUserPoolClient の `UserPoolClient` を丸ごと写し、
 * 読み取り専用の項目を落とし、ExplicitAuthFlows だけ差し替える。
 */
function buildClientUpdate(client, flows) {
    const p = { ...client };
    for (const k of CLIENT_READ_ONLY) delete p[k];
    p.ExplicitAuthFlows = [...flows];
    return p;
}

/** 前後で ExplicitAuthFlows 以外に変わった項目の名前（純関数）。空が正しい */
function changedClientKeys(before, after) {
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    const out = [];
    for (const k of keys) {
        if (CLIENT_VOLATILE.includes(k) || CLIENT_READ_ONLY.includes(k)) continue;
        if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) out.push(k);
    }
    return out.sort();
}

async function main() {
    const apply = process.argv.includes("--apply");
    const remove = process.argv.includes("--remove");
    const stage = assertStage(requireEnv("STAGE", "prod か staging"));
    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const clientId = requireEnv("COGNITO_CLIENT_ID");
    const idp = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

    const pool = (await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))).UserPool;
    assertPoolName(stage, poolId, pool?.Name);

    const read = async () => (await idp.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: clientId }))).UserPoolClient;
    const before = await read();
    if (!before) throw new Error(`クライアント ${clientId} を読めませんでした`);

    const plan = planFlows(before, { remove });
    console.log(`[custom-auth] ${stage} pool=${poolId}（${pool.Name}） client=${clientId}（${before.ClientName}）`);
    console.log(`[custom-auth] いまの ExplicitAuthFlows: ${(before.ExplicitAuthFlows ?? []).join(", ")}`);
    if (plan.action === "none") {
        console.log(`[custom-auth] 変えることはありません（${FLOW} は${remove ? "もう付いていない" : "もう付いている"}）`);
        return;
    }
    const params = buildClientUpdate(before, plan.flows);
    console.log(`[custom-auth] ${plan.action === "add" ? "足したあと" : "外したあと"}の ExplicitAuthFlows: ${plan.flows.join(", ")}`);
    // 値は出さない（URL などは秘密ではないが、項目が落ちていないかを見るには名前で足りる）
    console.log(`[custom-auth] そのまま送り返す項目: ${Object.keys(params).filter((k) => k !== "ExplicitAuthFlows").sort().join(", ")}`);
    if (!apply) {
        console.log("[custom-auth] 読むだけで終わります。変えるときは apply を true にして流してください");
        return;
    }

    await idp.send(new UpdateUserPoolClientCommand(params));
    const after = await read();
    const changed = changedClientKeys(before, after);
    const flowsAfter = [...(after?.ExplicitAuthFlows ?? [])].sort();
    if (JSON.stringify(flowsAfter) !== JSON.stringify(plan.flows)) {
        throw new Error(`読み直した ExplicitAuthFlows が期待と違います: ${flowsAfter.join(", ")}`);
    }
    if (changed.length > 0) {
        throw new Error(`ExplicitAuthFlows のほかに変わった項目があります: ${changed.join(", ")}。手順書の「戻すとき」で確かめてください`);
    }
    console.log(`[custom-auth] 変えました。読み直して、ExplicitAuthFlows のほかは1項目も変わっていないことを確かめました`);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(`::error::${e.message}`);
        process.exit(1);
    });
}

module.exports = { FLOW, CLIENT_READ_ONLY, planFlows, buildClientUpdate, changedClientKeys };
