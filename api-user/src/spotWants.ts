import { createHash, randomBytes } from "node:crypto";
import type { APIGatewayProxyHandlerV2, ScheduledHandler } from "aws-lambda";
import { BatchGetCommand, BatchWriteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, jsonError } from "./http";
import { requireEnv } from "./env";
import LEDGER from "./data/lightLedger.json";

/**
 * **みんなの「行きたい」を数える**（2026-11-11 owner「撮影スポットを払う」の②・設計は案の資料の第7章「詳しく」）。
 *
 * ## 何を数えるか
 *
 * 撮影スポットを右へ払った「行きたい」と、撮影スポットの頁の「行きたい」。見送るは数えない。
 * 数えるのは**撮影スポットごと・月ごとの数だけ**。誰が払ったかは出さない・持たない。
 *
 * ## 置き場（新しい表・GSI は作らない）
 *
 * 今ある photos 表（鍵は `id` だけ）に行を足す。どの行も GSI の欄（`userId`・`createdAt`・`publicFeed`・
 * `storyFeed`）を持たない＝索引には載らない（索引の書き込みが増えない）。
 *
 *   spotwant#<YYYY-MM>#<slug>    数（ADD n 1）。消さない（月ごとに小さな行が増えるだけ）
 *   wantby#<YYYY-MM>#<端末>       その月にその端末が数えた撮影スポットの集まり（同じ人・同じ撮影スポットは月1回）
 *   wantday#<YYYY-MM-DD>#<端末>   その日の数（1人1日 `DEVICE_DAILY_MAX` 件まで）
 *   wantip#<YYYY-MM-DD>#<混ぜた回線> その日の数（同じ回線 1日 `IP_DAILY_MAX` 件まで）
 *   wantsalt#<YYYY-MM-DD>         その日の塩（回線の番号を混ぜる・日替わり・でたらめ）
 *   spotwantsnap#<YYYY-MM>        毎日の集計の前回の数と、急に増えた撮影スポットの印（運営が見る）
 *
 * **photos 表の TTL は有効になっていない**（2026-11-11 に `describe-time-to-live` で DISABLED を確かめた）。
 * だから重なり止め・日の上限・塩の行は、毎日の集計（`aggregateSpotWants`）が古いものを消す。
 *
 * ## 「人」は端末ごとのでたらめな ID
 *
 * ログインしていてもいなくても、画面が端末に作ったでたらめな ID（名前・メールとつながらない）。
 * 2026-11-11 判断: 設計は「ログイン中は利用者の ID」だったが、端末の ID にそろえた——未ログインで払ってから
 * ログインした人が2回数えられない（同じ端末）・利用者の ID を数の行と結ばない（プライバシー）。
 * 1人が2台で払うと2つに数えるが、上限と月1回で効く量は小さい。
 *
 * ## IP は保存しない
 *
 * 回線の上限だけに使い、**日替わりのでたらめな塩と混ぜたハッシュ**を、その日の数の行の鍵にする。
 * 塩は翌々日に消す（`aggregateSpotWants`）——消したあとは、ハッシュから回線を引き戻せない。
 *
 * ## 荒らしと数の操作
 *
 *  1. 同じ端末・同じ撮影スポットは月1回（`wantby`）
 *  2. 1端末 1日 `DEVICE_DAILY_MAX` 件まで
 *  3. 同じ回線 1日 `IP_DAILY_MAX` 件まで
 *  3'. 同じ回線・同じ撮影スポットは 1日 `IP_SPOT_DAILY_MAX` 件まで（端末の ID を作り直して1つの撮影スポットを押し上げるのを止める）
 *  4. 画面はまとめて送る（5件ごと・閉じるとき）。1回で受けるのは `MAX_PER_REQUEST` 件まで・本文は `MAX_BODY_BYTES` まで
 *     （JSON を読む前に断る）。API Gateway でもこの口だけ流量を絞る（`serverless.yml` の `HttpApiStage` の `RouteSettings`）
 *  5. 数が `MIN_SHOWN` 未満の撮影スポットは数を出さない（`spot-wants.json` に載せない）
 *  6. 急に増えた撮影スポットは毎日の集計で印を付け、その月は上位から外す（`isSpike`・最低の数 `SPIKE_FLOOR` と前の月の数を見る）
 *  7. 撮影スポットの鍵は台帳の写し（`data/lightLedger.json`＝画面に出ている撮影スポット）にあるものだけ受ける。
 *     2026-11-11 判断: 写しが古いと公開中の撮影スポットを断る（確かめ役の実測: 写し 1,782 件・公開 3,677 件・払う札 400 のうち
 *     168 が写しに無かった）。**試験で落とす**方を選んだ——`scripts/__tests__/spotWantsLedger.test.ts` が「公開中の撮影スポットと
 *     払う札が全部写しにある」を見る。`npm test` は本番の反映（Deploy Site・Deploy API の確かめ）でも流れるので、古いまま出ない。
 *     デプロイの時に作る案は、api-user の反映の段にルートの依存の取り込み（Actions の分数）が増えるので採らなかった。
 *     撮影スポットを公開したら、同じ変更で `npx tsx scripts/gen-light-ledger.ts` を流す（光と天気の知らせの写しと同じファイル）
 *
 * 権限（IAM）は数の行の鍵の頭（`dynamodb:LeadingKeys`）に絞る——写真の行を、この口からは読み書きも削除もできない。
 *
 * ## 順位は日本の撮影スポットだけ（2026-11-11 判断）
 *
 * 「全国 r 位」は日本の撮影スポットの中の順位。海外の撮影スポットは数だけ配り、順位は付けない。
 * 日本かどうかは写しの時刻帯（`Asia/Tokyo`。台帳の国「日本」から決まる・`spotTimeZone`）で見る。
 */

export const DEVICE_DAILY_MAX = 50;
export const IP_DAILY_MAX = 300;
/** 同じ回線・同じ撮影スポットの1日の上限 */
export const IP_SPOT_DAILY_MAX = 20;
export const MAX_PER_REQUEST = 10;
/** 本文の上限（バイト）。10件の鍵と端末の ID で 1KB に届かない */
export const MAX_BODY_BYTES = 4096;
export const MIN_SHOWN = 10;
/** 急に増えたと見なす1日の増え方の下限（これ未満の増え方は印を付けない） */
export const SPIKE_MIN = 30;
/**
 * 急に増えたと見なす基準の最低の数。月初め（前日の数が0）に本物の人気の撮影スポットが1日で 30 を超えても
 * 印を付けない——基準は「前日までの数・前の月の数の半分・この数」のいちばん大きいもの
 */
export const SPIKE_FLOOR = 100;

type Ledger = { timeZones: string[]; spots: [string, string, string, number, number, number][] };
const L = LEDGER as unknown as Ledger;
const ROWS = L.spots;
const ALLOWED: ReadonlySet<string> = new Set(ROWS.map((r) => r[0]));
/** 日本の撮影スポット（順位を付ける） */
const JAPAN: ReadonlySet<string> = new Set(ROWS.filter((r) => L.timeZones[r[5]] === "Asia/Tokyo").map((r) => r[0]));
export const isJapanSpot = (slug: string) => JAPAN.has(slug);
/** 名前（配る形に入れる・頁が索引を読まずに名前を出せる）。英語の名前が無ければ "" */
const NAMES: ReadonlyMap<string, [string, string]> = new Map(ROWS.map((r) => [r[0], [r[1], r[2]]]));
export const allSlugs = (): string[] => [...ALLOWED];

/** 日本時間の暦（月・日）。数は日本の月で区切る */
export function jstParts(now: Date): { month: string; day: string } {
    const j = new Date(now.getTime() + 9 * 3600 * 1000).toISOString();
    return { month: j.slice(0, 7), day: j.slice(0, 10) };
}

export const countId = (month: string, slug: string) => `spotwant#${month}#${slug}`;
export const byId = (month: string, device: string) => `wantby#${month}#${device}`;
export const dayId = (day: string, device: string) => `wantday#${day}#${device}`;
export const ipId = (day: string, ipHash: string) => `wantip#${day}#${ipHash}`;
export const ipSpotId = (day: string, ipHash: string, slug: string) => `wantip#${day}#${ipHash}#${slug}`;
export const saltId = (day: string) => `wantsalt#${day}`;
export const snapId = (month: string) => `spotwantsnap#${month}`;

/** 端末の ID（画面が作るでたらめな文字列）。英数字・`-`・`_` の 16〜64 字だけ */
export function isDeviceId(v: unknown): v is string {
    return typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);
}

/** 本文を読む。台帳に無い・形の違う鍵は落とす（`SPOT-<slug>` でも `<slug>` でも受ける） */
export function parseWants(body: string | undefined | null): { device: string; slugs: string[] } | null {
    let raw: unknown;
    try {
        raw = JSON.parse(body ?? "");
    } catch {
        return null;
    }
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (!isDeviceId(o.device) || !Array.isArray(o.slugs)) return null;
    const slugs: string[] = [];
    for (const v of o.slugs.slice(0, MAX_PER_REQUEST)) {
        if (typeof v !== "string") continue;
        const slug = v.startsWith("SPOT-") ? v.slice(5) : v;
        if (ALLOWED.has(slug) && !slugs.includes(slug)) slugs.push(slug);
    }
    return { device: o.device, slugs };
}

const isConditionFailed = (e: unknown) => (e as { name?: string })?.name === "ConditionalCheckFailedException";

/** 上限つきで数を1つ進める。上限に達していたら false */
async function bump(id: string, max: number): Promise<boolean> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id },
            UpdateExpression: "ADD n :one",
            ConditionExpression: "attribute_not_exists(n) OR n < :max",
            ExpressionAttributeValues: { ":one": 1, ":max": max },
        }));
        return true;
    } catch (e) {
        if (isConditionFailed(e)) return false;
        throw e;
    }
}

/** その日の塩（無ければ作る・同時に作られたら先の方を使う） */
async function daySalt(day: string): Promise<string> {
    const got = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: saltId(day) } }));
    const have = (got.Item as { salt?: unknown } | undefined)?.salt;
    if (typeof have === "string" && have) return have;
    const salt = randomBytes(32).toString("hex");
    try {
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: { id: saltId(day), salt },
            ConditionExpression: "attribute_not_exists(id)",
        }));
        return salt;
    } catch (e) {
        if (!isConditionFailed(e)) throw e;
        const again = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: saltId(day) }, ConsistentRead: true }));
        return String((again.Item as { salt?: unknown } | undefined)?.salt ?? "");
    }
}

export function hashIp(ip: string, salt: string): string {
    return createHash("sha256").update(`${salt}:${ip}`).digest("base64url").slice(0, 22);
}

/** 同じ端末・同じ撮影スポットはその月1回。初めてなら true（印を付ける） */
async function firstThisMonth(month: string, device: string, slug: string): Promise<boolean> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: byId(month, device) },
            UpdateExpression: "ADD slugs :s",
            ConditionExpression: "attribute_not_exists(slugs) OR NOT contains(slugs, :slug)",
            ExpressionAttributeValues: { ":s": new Set([slug]), ":slug": slug },
        }));
        return true;
    } catch (e) {
        if (isConditionFailed(e)) return false;
        throw e;
    }
}

/**
 * `POST /spots/wants`（未認証で呼べる）。本文 `{ device, slugs: ["SPOT-<slug>", …] }`。
 * 数えた数を返す（上限・重なり・台帳に無い鍵は数えないだけで、失敗にはしない）。
 * 1件ごとに: 端末の日の上限 → 回線の日の上限 → 月1回 → 数を進める
 */
export const recordSpotWants: APIGatewayProxyHandlerV2 = async (event) => {
    const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    // 大きな本文は読む前に断る（JSON.parse に数 MB を渡さない）
    if (raw && Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return jsonError(413, "too large");
    const parsed = parseWants(raw);
    if (!parsed) return jsonError(400, "invalid request");
    const { month, day } = jstParts(new Date());
    const ip = event.requestContext?.http?.sourceIp ?? "";
    let counted = 0;
    try {
        // 回線の上限を先に（端末の ID をいくつ作っても、回線の上限を越えたら端末の行も増やさない）
        const ipHash = ip ? hashIp(ip, await daySalt(day)) : null;
        for (const slug of parsed.slugs) {
            if (ipHash) {
                if (!(await bump(ipId(day, ipHash), IP_DAILY_MAX))) break;
                if (!(await bump(ipSpotId(day, ipHash, slug), IP_SPOT_DAILY_MAX))) continue;
            }
            if (!(await bump(dayId(day, parsed.device), DEVICE_DAILY_MAX))) break;
            if (!(await firstThisMonth(month, parsed.device, slug))) continue;
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: countId(month, slug) },
                UpdateExpression: "ADD n :one",
                ExpressionAttributeValues: { ":one": 1 },
            }));
            counted += 1;
        }
    } catch (e) {
        console.error("spotWants: record failed", (e as Error)?.name);
        return jsonError(500, "could not record");
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ counted }) };
};

// ─────────────────────────────────────────────────────────────
// 毎日の集計（EventBridge・`aggregateSpotWants`）
// ─────────────────────────────────────────────────────────────

/**
 * 急に増えたか: 1日に `SPIKE_MIN` 以上増え、しかも基準より多く増えた。
 * 基準は「前日までの数・前の月の数の半分・`SPIKE_FLOOR`」のいちばん大きいもの（月初めに本物の人気を外さない）
 */
export function isSpike(prev: number, now: number, lastMonth = 0): boolean {
    const d = now - prev;
    return d >= SPIKE_MIN && d > Math.max(prev, lastMonth / 2, SPIKE_FLOOR);
}

export type SpotWantsFile = {
    month: string;
    updatedAt: string;
    /** 数が `MIN_SHOWN` 以上で、印の付いていない撮影スポット。多い順・同じ数はスラッグの順。`rank` は1から */
    /** `rank` は日本の撮影スポットだけ（海外は数だけ・2026-11-11 判断） */
    spots: { slug: string; name: string; nameEn?: string; n: number; rank?: number }[];
};

/** 数から配る形を作る（印の付いたものと `MIN_SHOWN` 未満は載せない） */
export function rankWants(counts: ReadonlyMap<string, number>, flagged: ReadonlySet<string>, month: string, now: Date): SpotWantsFile {
    const rows = [...counts]
        .filter(([slug, n]) => n >= MIN_SHOWN && !flagged.has(slug))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // 順位は日本の撮影スポットの中だけで数える（同じ数は同じ順位）
    let rank = 0;
    let seen = 0;
    let prevN = -1;
    const spots = rows.map(([slug, n]) => {
        const [name, nameEn] = NAMES.get(slug) ?? [slug, ""];
        const base = { slug, name, ...(nameEn ? { nameEn } : {}), n };
        if (!isJapanSpot(slug)) return base;
        seen += 1;
        if (n !== prevN) { rank = seen; prevN = n; }
        return { ...base, rank };
    });
    return { month, updatedAt: now.toISOString(), spots };
}

/** 消してよい行か（重なり止めは前の月より古いもの・日の行と塩は前日より古いもの） */
/** "2026-01" → "2025-12" */
export function previousMonth(month: string): string {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

export function isExpiredRow(id: string, month: string, day: string): boolean {
    const prevMonth = previousMonth(month);
    const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const part = id.split("#")[1] ?? "";
    if (id.startsWith("wantby#")) return part < prevMonth;
    if (id.startsWith("wantday#") || id.startsWith("wantip#") || id.startsWith("wantsalt#")) return part < yesterday;
    return false;
}

const s3 = new S3Client({});
export const SPOT_WANTS_KEY = "app/data/spot-wants.json";

async function readCounts(month: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const slugs = allSlugs();
    for (let i = 0; i < slugs.length; i += 100) {
        let keys: Record<string, unknown>[] = slugs.slice(i, i + 100).map((s) => ({ id: countId(month, s) }));
        for (let tries = 0; keys.length > 0 && tries < 5; tries++) {
            const res = await ddb.send(new BatchGetCommand({
                RequestItems: { [PHOTOS_TABLE]: { Keys: keys, ProjectionExpression: "id, n" } },
            }));
            for (const it of (res.Responses?.[PHOTOS_TABLE] ?? []) as { id: string; n?: number }[]) {
                const slug = it.id.split("#").slice(2).join("#");
                if (typeof it.n === "number" && it.n > 0) counts.set(slug, it.n);
            }
            keys = (res.UnprocessedKeys?.[PHOTOS_TABLE]?.Keys ?? []) as Record<string, unknown>[];
        }
    }
    return counts;
}

/** 古い重なり止め・日の上限・塩の行を消す（25 件ずつまとめて・消せなかった分はやり直す） */
async function cleanup(month: string, day: string): Promise<number> {
    let removed = 0;
    let start: Record<string, unknown> | undefined;
    const expired: string[] = [];
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: PHOTOS_TABLE,
            ProjectionExpression: "id",
            FilterExpression: "begins_with(id, :a) OR begins_with(id, :b) OR begins_with(id, :c) OR begins_with(id, :d)",
            ExpressionAttributeValues: { ":a": "wantby#", ":b": "wantday#", ":c": "wantip#", ":d": "wantsalt#" },
            ExclusiveStartKey: start,
        }));
        for (const it of (res.Items ?? []) as { id: string }[]) {
            if (isExpiredRow(it.id, month, day)) expired.push(it.id);
        }
        start = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (start);
    for (let i = 0; i < expired.length; i += 25) {
        let requests: Record<string, unknown>[] = expired.slice(i, i + 25).map((id) => ({ DeleteRequest: { Key: { id } } }));
        for (let tries = 0; requests.length > 0 && tries < 5; tries++) {
            const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [PHOTOS_TABLE]: requests } }));
            const left = (res.UnprocessedItems?.[PHOTOS_TABLE] ?? []) as Record<string, unknown>[];
            removed += requests.length - left.length;
            requests = left;
        }
    }
    return removed;
}

/**
 * 毎日1回: 今月の数を読み、急に増えたものに印を付け、上位と数を `spot-wants.json` にして Web の置き場へ。
 * 古い行の掃除は別の関数（`cleanupSpotWants`）——掃除が落ちても数の配りは止めない
 */
export const aggregateSpotWants: ScheduledHandler = async () => {
    const now = new Date();
    const { month } = jstParts(now);
    const counts = await readCounts(month);
    const snap = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: snapId(month) } }));
    const last = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: snapId(previousMonth(month)) } }));
    const prev = ((snap.Item as { counts?: Record<string, number> } | undefined)?.counts) ?? {};
    const lastMonth = ((last.Item as { counts?: Record<string, number> } | undefined)?.counts) ?? {};
    const flagged = new Set<string>(((snap.Item as { flagged?: string[] } | undefined)?.flagged) ?? []);
    for (const [slug, n] of counts) {
        if (!flagged.has(slug) && isSpike(prev[slug] ?? 0, n, lastMonth[slug] ?? 0)) {
            flagged.add(slug);
            // 運営が見る（CloudWatch Logs）。数と撮影スポットだけ・誰が払ったかは持っていない
            console.warn(`spotWants: spike ${slug} ${prev[slug] ?? 0} -> ${n} (${month})`);
        }
    }
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: snapId(month), counts: Object.fromEntries(counts), flagged: [...flagged], at: now.toISOString() },
    }));
    const file = rankWants(counts, flagged, month, now);
    await s3.send(new PutObjectCommand({
        // Web の置き場（`prod-journey-photo.com` など）。無ければ集計ごと落とす（黙って書かない）
        Bucket: requireEnv("SITE_BUCKET"),
        Key: SPOT_WANTS_KEY,
        Body: JSON.stringify(file),
        ContentType: "application/json; charset=utf-8",
        CacheControl: "public, max-age=3600",
    }));
    console.log(`spotWants: ${counts.size} counted, ${file.spots.length} shown, ${flagged.size} flagged`);
};

/**
 * 毎日1回: 古い重なり止め・日の上限・塩の行を消す。photos 表の TTL は無効で、有効にするのは DB の変更なので
 * しない（2026-11-11 判断）。数の配り（`aggregateSpotWants`）とは別の関数にして、片方が落ちても他方は動く
 */
export const cleanupSpotWants: ScheduledHandler = async () => {
    const { month, day } = jstParts(new Date());
    const removed = await cleanup(month, day);
    console.log(`spotWants: ${removed} old rows removed`);
};
