#!/usr/bin/env node
/**
 * 「Apple でサインイン」「Google でログイン」を使い始める準備が、どこまで済んだかを読むだけで出す
 * （札 journey.photo-ios#601・#715。手順は iOS の `docs/APPLE_SIGNIN.md`）。**何も変えない。**
 *
 * 出すもの（押す順）:
 *   1. 鍵が SSM にあるか（名前と版だけ。中身は読まない）
 *   2. アプリのクライアントの ExplicitAuthFlows（ALLOW_CUSTOM_AUTH があるか）
 *   3. Apple のスタックのトリガーの関数があるか・プールの LambdaConfig にトリガー3つが付いているか
 *   4. `/auth/apple/status`・`/auth/google/status` の答え
 *   5. users 表の TTL
 * それと、**プールとクライアントの設定の指紋**（項目ごとの SHA-256 の頭）。Deploy API Lambdas でトリガーを付ける
 * 前と後にこれを流し、LambdaConfig のほかに指紋の変わった項目が無いことを見る（`UpdateUserPool` は渡さなかった項目を
 * 既定に戻すことがあるため・手順書の 2）。
 *
 *   STAGE=staging COGNITO_USER_POOL_ID=... COGNITO_CLIENT_ID=... USERS_TABLE=... API_URL=... node scripts/signin-readiness.js
 */
const crypto = require("node:crypto");
const {
    CognitoIdentityProviderClient, DescribeUserPoolCommand, DescribeUserPoolClientCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { SSMClient, DescribeParametersCommand } = require("@aws-sdk/client-ssm");
const { LambdaClient, GetFunctionConfigurationCommand } = require("@aws-sdk/client-lambda");
const { DynamoDBClient, DescribeTimeToLiveCommand } = require("@aws-sdk/client-dynamodb");
const { requireEnv } = require("./lib/env");
const { assertStage, assertPoolName, assertUsersTable, keyParamForStage, triggerFunctionForStage } = require("./lib/signinStage");

const CUSTOM_TRIGGERS = ["DefineAuthChallenge", "CreateAuthChallenge", "VerifyAuthChallengeResponse"];
/** 指紋から外す項目（読むたびに変わるもの・秘密・狙って変えるもの） */
const POOL_SKIP = ["LastModifiedDate", "EstimatedNumberOfUsers", "LambdaConfig"];
const CLIENT_SKIP = ["LastModifiedDate", "ClientSecret", "ExplicitAuthFlows"];

/** 鍵の順に左右されない JSON（純関数） */
function stableJson(v) {
    if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
}

/** 項目ごとの指紋（純関数）。値は出さず、SHA-256 の頭 8 文字だけ */
function fingerprints(obj, skip) {
    const out = {};
    for (const k of Object.keys(obj ?? {}).sort()) {
        if (skip.includes(k)) continue;
        out[k] = crypto.createHash("sha256").update(stableJson(obj[k])).digest("hex").slice(0, 8);
    }
    return out;
}

/**
 * プールの LambdaConfig に CUSTOM_AUTH のトリガー3つが、決まった1つの関数で付いているか（純関数）。
 * @returns {"none" | "ok" | "partial" | "other"}
 */
function triggerState(lambdaConfig, functionArn) {
    const got = CUSTOM_TRIGGERS.map((t) => lambdaConfig?.[t] ?? "");
    if (got.every((a) => !a)) return "none";
    if (functionArn && got.every((a) => a === functionArn)) return "ok";
    if (got.some((a) => !a)) return "partial";
    return "other";
}

async function getStatus(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const body = (await res.text()).slice(0, 200);
        return `${res.status} ${body}`;
    } catch (e) {
        return `読めない（${e.name}）`;
    }
}

async function main() {
    const stage = assertStage(requireEnv("STAGE", "prod か staging"));
    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const clientId = requireEnv("COGNITO_CLIENT_ID");
    const table = assertUsersTable(stage, requireEnv("USERS_TABLE"));
    const apiUrl = requireEnv("API_URL").replace(/\/+$/, "");
    const region = process.env.AWS_REGION ?? "ap-northeast-1";
    const idp = new CognitoIdentityProviderClient({ region });

    const pool = (await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))).UserPool;
    assertPoolName(stage, poolId, pool?.Name);
    const client = (await idp.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: clientId }))).UserPoolClient;

    const keyName = keyParamForStage(stage);
    const params = (await new SSMClient({ region }).send(new DescribeParametersCommand({
        ParameterFilters: [{ Key: "Name", Option: "Equals", Values: [keyName] }],
    }))).Parameters ?? [];
    const key = params[0];

    const fnName = triggerFunctionForStage(stage);
    let fnArn = "";
    try {
        fnArn = (await new LambdaClient({ region }).send(new GetFunctionConfigurationCommand({ FunctionName: fnName }))).FunctionArn ?? "";
    } catch (e) {
        if (e.name !== "ResourceNotFoundException") throw e;
    }
    const trig = triggerState(pool.LambdaConfig, fnArn);
    const flows = client?.ExplicitAuthFlows ?? [];
    const ttl = (await new DynamoDBClient({ region }).send(new DescribeTimeToLiveCommand({ TableName: table }))).TimeToLiveDescription;
    const apple = await getStatus(`${apiUrl}/auth/apple/status`);
    const google = await getStatus(`${apiUrl}/auth/google/status`);

    const mark = (b) => (b ? "済" : "まだ");
    console.log(`[readiness] ${stage} pool=${poolId}（${pool.Name}） client=${clientId}（${client?.ClientName}）`);
    console.log(`1. 鍵（SSM ${keyName}）: ${mark(!!key)}${key ? `（${key.Type}・版 ${key.Version}）` : ""}`);
    console.log(`2. クライアントの ALLOW_CUSTOM_AUTH: ${mark(flows.includes("ALLOW_CUSTOM_AUTH"))}（${flows.join(", ")}）`);
    console.log(`3. トリガーの関数 ${fnName}: ${mark(!!fnArn)}・プールのトリガー3つ: ${{ none: "まだ", ok: "済", partial: "一部だけ（要確認）", other: "別の関数を指している（要確認）" }[trig]}`);
    console.log(`   LambdaConfig: ${stableJson(pool.LambdaConfig ?? {})}`);
    console.log(`4. GET /auth/apple/status: ${apple}`);
    console.log(`   GET /auth/google/status: ${google}`);
    console.log(`5. users 表の TTL: ${ttl?.TimeToLiveStatus ?? "DISABLED"}${ttl?.AttributeName ? `（欄 ${ttl.AttributeName}）` : ""}`);
    console.log("--- プールの設定の指紋（LambdaConfig・更新日時・人数は除く。トリガーを付ける前後で同じなのが正しい）");
    for (const [k, v] of Object.entries(fingerprints(pool, POOL_SKIP))) console.log(`pool.${k} ${v}`);
    console.log("--- クライアントの設定の指紋（ExplicitAuthFlows・更新日時・秘密は除く）");
    for (const [k, v] of Object.entries(fingerprints(client, CLIENT_SKIP))) console.log(`client.${k} ${v}`);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(`::error::${e.message}`);
        process.exit(1);
    });
}

module.exports = { CUSTOM_TRIGGERS, stableJson, fingerprints, triggerState };
