/**
 * AI の回数と費用の止め（札 journey.photo-ios#652・owner 承認 2026-11-20「たのむ」）。
 * 旅行プランの AI（#621）と AI に頼むの両方を、ここ1か所で数える（`tripAi.ts` の口から使う）。
 *
 * ## 行（photos 表。表と GSI は増やさない・owner 承認）
 *
 *     `aiuse#<利用者>#<YYYY-MM>`
 *         count          … 旅行プランの今月の回数（#621 からの名前のまま）
 *         tripDay<DD>    … 旅行プランのその日の回数（DD は日本時間の日。月の行なので月が替われば消える）
 *         ask            … AI に頼むの今月の回数
 *         askDay<DD>     … AI に頼むのその日の回数
 *         costMilliYen   … その人のサーバーの AI の今月の推定金額（1/1000 円）
 *         tripHeld<DD> / askHeld<DD> … その日に `reserve`（via: server）で先に取って、まだ AI を呼んでいない回の数。
 *                        日をまたいだら使えない（期限切れは数を戻さずに捨てる。1日の上限を2日分使う道を閉じる・2026-11-20 確かめ役の指摘）
 *         updatedAt
 *     `aiuse#all#<YYYY-MM>`     { costMilliYen, updatedAt }          … 全体の今月の推定金額（止めに使う）
 *     `aiuse#all#<YYYY-MM-DD>`  { costMilliYen, calls, updatedAt }   … 全体のその日の記録
 *
 * 🔴 `userId`・`createdAt`・`storyFeed`・`publicFeed`・`expiresAt` を持たせない（索引に載ると一覧に紛れる。`profileQr.ts` と同じ）。
 *
 * ## 取り方
 *
 * - 1回取るときは、月と日の数を**1つの条件つきの書き込み**で足す（同時に呼ばれても上限を越えない）
 * - サーバーの AI の回は、呼ぶ前に推定金額を多めに先に取り（`reserveCost`）、呼んだあとで実際のトークン数に直す（`settle`）。
 *   1人の止め（月90円）はその人の行の条件で、全体の止め（月400円を日ごとに割った累計）は全体の行の条件で守る
 * - 全体の止めは「今月の合計 ≦ 400円 × 今日の日 ÷ その月の日数」。使い残しは翌日へ回る（月の初めに先着で使い切られない）
 */

import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import {
    AI_LIMITS, GLOBAL_MONTH_COST_CAP, TRIP_AI_LIMITS, USER_MONTH_COST_CAP, reserveCost,
    type AiKind, type TripAiTier,
} from "./tripAiConfig";
import { aiUseAllDayKey, aiUseAllMonthKey, aiUseKey, jstDate, jstDayOfMonth, jstMonth, resetsOn } from "./tripAiKeys";

export type Via = "device" | "server";
export type LimitReason = "day" | "month" | "userCost" | "global";

export type QuotaView = {
    tier: TripAiTier;
    kind: AiKind;
    day: { used: number; limit: number; remaining: number };
    month: { used: number; limit: number; remaining: number; resetsOn: string };
    /** いまサーバーの AI で1回読めるか（Pro と管理者で、1人と全体の止めに余りがある） */
    serverAllowed: boolean;
};

/** 前からの返事の形（旅行プラン。iOS 1.1.9x の `TripAIService.Usage`） */
export type Usage = { tier: TripAiTier; used: number; limit: number; remaining: number; resetsOn: string; countsDevice: boolean };

type Row = Record<string, unknown>;

const dd = (now: number) => String(jstDayOfMonth(now).day).padStart(2, "0");
const monthField = (kind: AiKind) => (kind === "trip" ? "count" : "ask");
const dayField = (kind: AiKind, now: number) => `${kind}Day${dd(now)}`;
const heldField = (kind: AiKind, now: number) => `${kind}Held${dd(now)}`;
const COST = "costMilliYen";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isCcf = (e: unknown) => (e as { name?: string } | null)?.name === "ConditionalCheckFailedException";

/** サーバーの AI を使えるのは Pro と管理者だけ（owner 承認 2026-11-20） */
export const serverTier = (tier: TripAiTier) => tier !== "free";

/** 全体の今日までに使ってよい累計（1/1000 円）。400円 × 日 ÷ 月の日数 */
export function globalAllowance(now: number): number {
    const { day, days } = jstDayOfMonth(now);
    return Math.floor((GLOBAL_MONTH_COST_CAP * day) / days);
}

async function readRow(id: string): Promise<Row> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id }, ConsistentRead: true }));
    return (res.Item as Row | undefined) ?? {};
}

export function viewOf(tier: TripAiTier, kind: AiKind, row: Row, globalCost: number, now: number): QuotaView {
    const lim = AI_LIMITS[kind][tier];
    const m = num(row[monthField(kind)]);
    const d = num(row[dayField(kind, now)]);
    const est = reserveCost(kind);
    return {
        tier,
        kind,
        day: { used: d, limit: lim.day, remaining: Math.max(0, lim.day - d) },
        month: { used: m, limit: lim.month, remaining: Math.max(0, lim.month - m), resetsOn: resetsOn(now) },
        serverAllowed: serverTier(tier)
            && num(row[COST]) + est <= USER_MONTH_COST_CAP
            && globalCost + est <= globalAllowance(now),
    };
}

/**
 * 旅行プランの前からの形（`usage`）。`countsDevice` は前の版のアプリのために、無料の人だけ true のまま
 * （前の版は Pro で true だと端末の回のあとに `count` を呼び、圏外で落ちると組んだ結果を捨てる。TripAIRunner.swift。
 * 新しいアプリは `reserve` で数える。2026-11-20 確かめ役の指摘）
 */
export function usageOf(tier: TripAiTier, used: number, now: number): Usage {
    const limit = TRIP_AI_LIMITS[tier];
    return { tier, used, limit, remaining: Math.max(0, limit - used), resetsOn: resetsOn(now), countsDevice: tier === "free" };
}

/** 今の回数（両方の種類）と、全体の今月の推定金額 */
export async function readQuota(uid: string, tier: TripAiTier, now: number): Promise<{ row: Row; globalCost: number; trip: QuotaView; ask: QuotaView }> {
    const [row, all] = await Promise.all([readRow(aiUseKey(uid, jstMonth(now))), readRow(aiUseAllMonthKey(jstMonth(now)))]);
    const globalCost = num(all[COST]);
    return { row, globalCost, trip: viewOf(tier, "trip", row, globalCost, now), ask: viewOf(tier, "ask", row, globalCost, now) };
}

/** 取れなかった理由（行を読み直して決める。月 → 日 → 1人の費用の順） */
function reasonOf(tier: TripAiTier, kind: AiKind, row: Row, via: Via, now: number): LimitReason {
    const lim = AI_LIMITS[kind][tier];
    if (num(row[monthField(kind)]) >= lim.month) return "month";
    if (num(row[dayField(kind, now)]) >= lim.day) return "day";
    if (via === "server") return "userCost";
    return "month";
}

export type Reserved = { ok: true; row: Row; cost: number } | { ok: false; reason: LimitReason; row: Row };

/**
 * 1回取る。月と日の数を足し、サーバーの AI の回は推定金額も先に取る（1人と全体）。
 * `hold` は「先に取っておき、あとで ask・plan が使う」印（`reserve` の口から via: server のとき）
 */
export async function reserveUse(uid: string, tier: TripAiTier, kind: AiKind, via: Via, now: number, hold = false): Promise<Reserved> {
    const lim = AI_LIMITS[kind][tier];
    const server = via === "server";
    const cost = server ? reserveCost(kind) : 0;
    const names: Record<string, string> = { "#m": monthField(kind), "#d": dayField(kind, now), "#u": "updatedAt" };
    const values: Record<string, unknown> = { ":zero": 0, ":one": 1, ":mlim": lim.month, ":dlim": lim.day, ":now": new Date(now).toISOString() };
    const sets = ["#m = if_not_exists(#m, :zero) + :one", "#d = if_not_exists(#d, :zero) + :one", "#u = :now"];
    const conds = ["(attribute_not_exists(#m) OR #m < :mlim)", "(attribute_not_exists(#d) OR #d < :dlim)"];
    if (server) {
        names["#c"] = COST;
        values[":cost"] = cost;
        values[":croom"] = USER_MONTH_COST_CAP - cost;
        sets.push("#c = if_not_exists(#c, :zero) + :cost");
        conds.push("(attribute_not_exists(#c) OR #c <= :croom)");
        if (hold) {
            names["#h"] = heldField(kind, now);
            sets.push("#h = if_not_exists(#h, :zero) + :one");
        }
    }
    const key = { id: aiUseKey(uid, jstMonth(now)) };
    let row: Row;
    try {
        const res = await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE, Key: key,
            UpdateExpression: `SET ${sets.join(", ")}`,
            ConditionExpression: conds.join(" AND "),
            ExpressionAttributeNames: names, ExpressionAttributeValues: values,
            ReturnValues: "ALL_NEW",
        }));
        row = (res.Attributes as Row | undefined) ?? {};
    } catch (e) {
        if (!isCcf(e)) throw e;
        const now2 = await readRow(key.id);
        return { ok: false, reason: reasonOf(tier, kind, now2, via, now), row: now2 };
    }
    if (!server) return { ok: true, row, cost: 0 };

    // 全体の止め。取れなければ、いま足した1人の分を戻す
    const room = globalAllowance(now) - cost;
    let globalOk = room >= 0;
    if (globalOk) {
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE, Key: { id: aiUseAllMonthKey(jstMonth(now)) },
                UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :cost, #u = :now",
                ConditionExpression: "attribute_not_exists(#c) OR #c <= :room",
                ExpressionAttributeNames: { "#c": COST, "#u": "updatedAt" },
                ExpressionAttributeValues: { ":zero": 0, ":cost": cost, ":room": room, ":now": new Date(now).toISOString() },
            }));
        } catch (e) {
            if (!isCcf(e)) {
                await releaseUser(uid, kind, now, cost, hold);
                throw e;
            }
            globalOk = false;
        }
    }
    if (!globalOk) {
        await releaseUser(uid, kind, now, cost, hold);
        return { ok: false, reason: "global", row };
    }
    return { ok: true, row, cost };
}

/**
 * `reserve`（via: server）で先に取っておいた1回を使う。あれば true（回数と推定金額はもう取ってある）。
 * 無ければ false で、呼ぶ側が `reserveUse` で自分で取る
 */
export async function takeHeld(uid: string, kind: AiKind, now: number): Promise<boolean> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE, Key: { id: aiUseKey(uid, jstMonth(now)) },
            UpdateExpression: "SET #h = #h - :one",
            ConditionExpression: "#h > :zero",
            ExpressionAttributeNames: { "#h": heldField(kind, now) },
            ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
        }));
        return true;
    } catch (e) {
        if (isCcf(e)) return false;
        throw e;
    }
}

/** 1人の行の取った1回を戻す（回数と、先に取った推定金額） */
async function releaseUser(uid: string, kind: AiKind, now: number, cost: number, held: boolean): Promise<void> {
    const names: Record<string, string> = { "#m": monthField(kind), "#d": dayField(kind, now) };
    const values: Record<string, unknown> = { ":zero": 0, ":one": 1 };
    const sets = ["#m = #m - :one", "#d = #d - :one"];
    if (cost > 0) {
        names["#c"] = COST;
        values[":cost"] = cost;
        sets.push("#c = #c - :cost");
    }
    if (held) {
        names["#h"] = heldField(kind, now);
        sets.push("#h = #h - :one");
    }
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE, Key: { id: aiUseKey(uid, jstMonth(now)) },
            UpdateExpression: `SET ${sets.join(", ")}`,
            ConditionExpression: "#m > :zero AND #d > :zero",
            ExpressionAttributeNames: names, ExpressionAttributeValues: values,
        }));
    } catch (e) {
        console.error("aiQuota: 回数を戻せませんでした", (e as Error)?.name);
    }
}

/**
 * 取った1回を戻す。**AI を呼ぶ前に断った回と、AI が答えなかった回（502）だけ**。
 * AI を呼んだ回は、断っても読み取れなくても戻さない（戻すと断られる頼みの繰り返しで日と月の上限が効かず、
 * 全体の1日分を1人で使い切れる。2026-11-20 確かめ役の指摘）。戻せなくても答えは変えない
 */
export async function releaseUse(uid: string, kind: AiKind, now: number, reservedCost: number): Promise<void> {
    await releaseUser(uid, kind, now, reservedCost, false);
    if (reservedCost > 0) await adjustGlobal(-reservedCost, 0, now, false);
}

/**
 * 呼んだあと、先に取った推定金額を実際の額に直す（1人と全体）。全体の日の記録も足す。
 * 実際の額が先取りを越えたときは、まず止めの条件つきで足す。条件に合わなければ（止めを越える）、それでも実際の額は残す
 * ——数を小さく見せると止めが遅れるので。越えた行は次の回の `reserveUse` の条件で止まる
 */
export async function settleUse(uid: string, now: number, reservedCost: number, actual: number): Promise<void> {
    const delta = actual - reservedCost;
    if (delta !== 0) {
        await addCost({ id: aiUseKey(uid, jstMonth(now)) }, delta, delta > 0 ? USER_MONTH_COST_CAP : null, now, "1人");
    }
    await adjustGlobal(delta, actual, now, true);
}

/** 金額を足す。`cap` があれば「足したあとも cap 以下」の条件で足し、越えるなら条件なしで足して記録に残す。cap の中で足せたら true */
async function addCost(key: { id: string }, delta: number, cap: number | null, now: number, label: string): Promise<boolean> {
    const base = {
        TableName: PHOTOS_TABLE, Key: key,
        UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :d, #u = :now",
        ExpressionAttributeNames: { "#c": COST, "#u": "updatedAt" },
    };
    const values = { ":zero": 0, ":d": delta, ":now": new Date(now).toISOString() };
    try {
        if (cap !== null) {
            try {
                await ddb.send(new UpdateCommand({
                    ...base, ConditionExpression: "attribute_not_exists(#c) OR #c <= :room",
                    ExpressionAttributeValues: { ...values, ":room": cap - delta },
                }));
                return true;
            } catch (e) {
                if (!isCcf(e)) throw e;
                console.warn(`aiQuota: ${label}の止めを越えました（次の回から止まります）`);
            }
        }
        await ddb.send(new UpdateCommand({ ...base, ExpressionAttributeValues: values }));
        return cap === null;
    } catch (e) {
        console.error(`aiQuota: ${label}の金額を直せませんでした`, (e as Error)?.name);
        return false;
    }
}

async function adjustGlobal(delta: number, actual: number, now: number, called: boolean): Promise<void> {
    if (delta !== 0) {
        await addCost({ id: aiUseAllMonthKey(jstMonth(now)) }, delta, delta > 0 ? GLOBAL_MONTH_COST_CAP : null, now, "全体");
    }
    if (!called) return;
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE, Key: { id: aiUseAllDayKey(jstDate(now)) },
            UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :a, #n = if_not_exists(#n, :zero) + :one, #u = :now",
            ExpressionAttributeNames: { "#c": COST, "#n": "calls", "#u": "updatedAt" },
            ExpressionAttributeValues: { ":zero": 0, ":a": actual, ":one": 1, ":now": new Date(now).toISOString() },
        }));
    } catch (e) {
        console.error("aiQuota: 全体の日の記録を足せませんでした", (e as Error)?.name);
    }
}
