#!/usr/bin/env node
/**
 * users 表の TTL（欄 `ttl`）を有効にする（札 journey.photo-ios#295・#601）。
 *
 * `ttl` を付けている行は3種類（2026-11-24 に grep で洗った）:
 *   - 退会の墓石（`deletedAt` の行・退会＋365日・`account.ts` の `tombstoneTtl()`）
 *   - 使った nonce（`nonce#<提供元>#<sha>`・1日・`federatedAccount.ts` の `NONCE_KEEP_SEC`）
 *   - 取り消せずに残した結び付け（`apple#…`・`google#…`・`federatedAccount.ts` の `unlinkAfterDelete`・`signinMethods.ts`）
 * TTL が無効の間、これらは消えずに残る（中身は SHA-256 と時刻だけ）。
 *
 * 🔴 **墓石が TTL で消えると、退会した人の名前の写しが公開の口に戻る**（`docs/tombstone-ttl.md` の 1）。
 *    だから期限の近い墓石（30 日以内）が1つでもあれば apply を断る。先に `scrub-deleted-names` を
 *    読むだけ → apply → 読むだけ（0 件）まで通す。
 *
 * 既定は読むだけ: いまの TTL の状態と、`ttl` を持つ行の種類ごとの数・すでに期限が過ぎた数（有効にすると
 * 48 時間ほどで消える）・いちばん早い墓石の期限を出す。
 *
 *   STAGE=staging USERS_TABLE=staging-photo-gallery-users node scripts/enable-users-ttl.js [--apply]
 *
 * 費用: TTL の削除は無料（書き込みの量に数えない）。走査は読むだけの量（表は小さい）。
 */
const { DynamoDBClient, DescribeTimeToLiveCommand, UpdateTimeToLiveCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { requireEnv } = require("./lib/env");
const { assertStage, assertUsersTable } = require("./lib/signinStage");

const ATTR = "ttl";
/** 期限がこの日数より近い墓石があれば、名前の写しを伏せるまで有効にしない */
const TOMBSTONE_GUARD_DAYS = 30;

/** 行の種類（純関数） */
function classifyRow(row) {
    const id = String(row.userId ?? "");
    if (typeof row.deletedAt === "string") return "tombstone";
    if (id.startsWith("nonce#")) return "nonce";
    if (id.startsWith("apple#") || id.startsWith("google#")) return "federated";
    return "other";
}

/**
 * `ttl` を持つ行をまとめる（純関数）。rows は `{ userId, deletedAt?, ttl }`（ttl は秒の数）。
 */
function summarize(rows, nowSec) {
    const kinds = { tombstone: 0, nonce: 0, federated: 0, other: 0 };
    let expired = 0;
    let earliestTombstone = null;
    for (const r of rows) {
        const kind = classifyRow(r);
        kinds[kind] += 1;
        if (r.ttl <= nowSec) expired += 1;
        if (kind === "tombstone" && (earliestTombstone === null || r.ttl < earliestTombstone)) earliestTombstone = r.ttl;
    }
    const guardUntil = nowSec + TOMBSTONE_GUARD_DAYS * 24 * 60 * 60;
    const tombstonesSoon = rows.filter((r) => classifyRow(r) === "tombstone" && r.ttl <= guardUntil).length;
    return { total: rows.length, kinds, expired, earliestTombstone, tombstonesSoon };
}

/**
 * 何をするか（純関数）。`desc` は DescribeTimeToLive の `TimeToLiveDescription`。
 * @returns {"none" | "enable"}
 */
function planTtl(desc) {
    const status = desc?.TimeToLiveStatus ?? "DISABLED";
    if (status === "ENABLED") {
        if (desc.AttributeName !== ATTR) throw new Error(`TTL は別の欄（${desc.AttributeName}）で有効になっています。手で確かめてください`);
        return "none";
    }
    if (status === "ENABLING" || status === "DISABLING") throw new Error(`TTL は切り替えの途中です（${status}）。1時間ほど待ってから流してください`);
    return "enable";
}

async function scanTtlRows(ddb, table) {
    const rows = [];
    let start;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: table,
            ProjectionExpression: "userId, deletedAt, #ttl",
            FilterExpression: "attribute_exists(#ttl)",
            ExpressionAttributeNames: { "#ttl": ATTR },
            ExclusiveStartKey: start,
        }));
        for (const it of res.Items ?? []) {
            const ttl = Number(it[ATTR]?.N);
            if (!Number.isFinite(ttl)) continue;   // 数でない ttl は TTL が見ない
            rows.push({ userId: it.userId?.S, deletedAt: it.deletedAt?.S, ttl });
        }
        start = res.LastEvaluatedKey;
    } while (start);
    return rows;
}

const day = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

async function main() {
    const apply = process.argv.includes("--apply");
    const stage = assertStage(requireEnv("STAGE", "prod か staging"));
    const table = assertUsersTable(stage, requireEnv("USERS_TABLE"));
    const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

    const desc = (await ddb.send(new DescribeTimeToLiveCommand({ TableName: table }))).TimeToLiveDescription;
    const plan = planTtl(desc);
    console.log(`[ttl] ${table} いまの TTL: ${desc?.TimeToLiveStatus ?? "DISABLED"}${desc?.AttributeName ? `（欄 ${desc.AttributeName}）` : ""}`);

    const s = summarize(await scanTtlRows(ddb, table), Math.floor(Date.now() / 1000));
    console.log(`[ttl] ttl を持つ行 ${s.total} 件（墓石 ${s.kinds.tombstone}・使った nonce ${s.kinds.nonce}・残した結び付け ${s.kinds.federated}・ほか ${s.kinds.other}）`);
    console.log(`[ttl] すでに期限が過ぎた行 ${s.expired} 件（有効にすると 48 時間ほどで消える）`);
    console.log(`[ttl] いちばん早い墓石の期限: ${s.earliestTombstone === null ? "（墓石なし）" : day(s.earliestTombstone)}・${TOMBSTONE_GUARD_DAYS} 日以内に期限が来る墓石 ${s.tombstonesSoon} 件`);

    if (plan === "none") {
        console.log("[ttl] もう有効です。変えることはありません");
        return;
    }
    if (s.tombstonesSoon > 0) {
        throw new Error(`${TOMBSTONE_GUARD_DAYS} 日以内に期限が来る墓石が ${s.tombstonesSoon} 件あります。先に scrub-deleted-names を流してください（docs/tombstone-ttl.md）`);
    }
    if (!apply) {
        console.log("[ttl] 読むだけで終わります。有効にするときは apply を true にして流してください");
        return;
    }
    await ddb.send(new UpdateTimeToLiveCommand({ TableName: table, TimeToLiveSpecification: { Enabled: true, AttributeName: ATTR } }));
    const after = (await ddb.send(new DescribeTimeToLiveCommand({ TableName: table }))).TimeToLiveDescription;
    console.log(`[ttl] 有効にしました（いまの状態 ${after?.TimeToLiveStatus}。ENABLED になるまで最大1時間）`);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(`::error::${e.message}`);
        process.exit(1);
    });
}

module.exports = { ATTR, TOMBSTONE_GUARD_DAYS, classifyRow, summarize, planTtl };
