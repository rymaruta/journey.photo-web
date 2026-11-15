/**
 * AI で旅行プランを作る口（札 journey.photo-ios#621・owner 承認 2026-11-15「いいよ、進めて」）。
 *
 *     POST /user/trip-ai   （ログインの口。別のスタック `serverless.trip-ai.yml`）
 *
 * ## 何をするか
 *
 * - アプリが台帳と行きたい場所から選んだ**候補（20件まで）**と、利用者が打った頼みの文を受け取り、
 *   AI に**候補の番号から選んで日に割り、理由を1文書かせる**。AI に場所を作らせない。
 *   知らない番号・重なった番号・範囲の外の日は**ここで落とす**（アプリも同じ確かめをする）
 * - 回数は月ごとにサーバーで数えて守る（上限は `tripAiConfig.ts`）
 * - 打った文はサーバーに残さない（記録に出すのは回数とトークン数だけ）
 *
 * ## 体の形（`action` で分ける。口は1つ）
 *
 *     { "action": "status" }                                   → 今月の回数
 *     { "action": "count" }                                    → 端末の AI で作った回を数える（無料の人だけ数える）
 *     { "action": "plan", "request": "...", "days"?: 2,
 *       "candidates": [{ "name", "area"?, "category"?, "seasons"?: [...], "times"?: [...] }],
 *       "current"?: [{ "n", "day" }] }                         → AI で組む（候補の番号は 1 から）
 *
 *     返事の `usage`: { tier, used, limit, remaining, resetsOn, countsDevice }
 *     plan の返事:   { plan: { title, days, stops: [{ n, day }], reason, dropped }, usage }
 *
 * ## 何を数えるか（2026-11-15 判断。案 https://claude.ai/artifact/2EH3WZ8v3s5dUokTvsNFoG の推奨に従う）
 *
 * - **サーバーの AI（Bedrock）で作った回は、だれでも数える**（費用がかかるのはここだけ）
 * - **端末の AI で作った回は、無料の人だけ数える。** 案の推奨は「回数は Bedrock の人だけ数える」
 *   「お試しは端末の AI でも Bedrock でも数える」。お試しが「無料の人は月30回」に替わったので、
 *   無料の人の回数は Pro の案内のための枠として端末でも数え、Pro と管理者の端末の回は数えない（0円なので）
 * - 読み取れなかった回・AI が答えなかった回は数えない（先に1つ取り、失敗したら戻す）
 * - 管理者（Cognito の admin。`isAdmin`。アプリの `auth.isAdmin` と同じ `cognito:groups` を見る）は Pro と同じ上限
 *
 * ## 行の形（photos 表。表と GSI は増やさない・owner 承認の3）
 *
 *     `aiuse#<利用者>#<YYYY-MM>`  { count, updatedAt }   … 月は日本時間
 *
 * 🔴 `userId`・`createdAt`・`storyFeed`・`publicFeed`・`expiresAt` を持たせない（索引に載ると一覧に紛れる。`profileQr.ts` と同じ）。
 * 退会の掃除（`account.ts`）が、この1年分の行を消す。
 */

import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, isAdmin, jsonError } from "./http";
import { readLiveCaller } from "./liveCaller";
import { isPro } from "./badgeKeys";
import {
    TRIP_AI_LIMITS, TRIP_AI_MAX_CANDIDATES, TRIP_AI_MAX_DAYS, TRIP_AI_MAX_OUTPUT_TOKENS, TRIP_AI_MAX_REQUEST,
    TRIP_AI_MODEL_ID, TRIP_AI_REGION, type TripAiTier,
} from "./tripAiConfig";
import { aiUseKey, jstMonth, resetsOn } from "./tripAiKeys";

const bedrock = new BedrockRuntimeClient({ region: TRIP_AI_REGION });

// ---------- 回数 ----------

export type Usage = { tier: TripAiTier; used: number; limit: number; remaining: number; resetsOn: string; countsDevice: boolean };

function usageOf(tier: TripAiTier, used: number, now: number): Usage {
    const limit = TRIP_AI_LIMITS[tier];
    return { tier, used, limit, remaining: Math.max(0, limit - used), resetsOn: resetsOn(now), countsDevice: tier === "free" };
}

async function readUsed(uid: string, now: number): Promise<number> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: aiUseKey(uid, jstMonth(now)) }, ConsistentRead: true }));
    const c = (res.Item as { count?: unknown } | undefined)?.count;
    return typeof c === "number" && Number.isFinite(c) ? c : 0;
}

/** 上限の手前なら1つ取り、取った後の数を返す。上限なら null */
async function reserve(uid: string, limit: number, now: number): Promise<number | null> {
    try {
        const res = await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: aiUseKey(uid, jstMonth(now)) },
            UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :one, #u = :now",
            ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
            ExpressionAttributeNames: { "#c": "count", "#u": "updatedAt" },
            ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":limit": limit, ":now": new Date(now).toISOString() },
            ReturnValues: "UPDATED_NEW",
        }));
        const c = (res.Attributes as { count?: unknown } | undefined)?.count;
        return typeof c === "number" ? c : 1;
    } catch (e) {
        if ((e as { name?: string } | null)?.name === "ConditionalCheckFailedException") return null;
        throw e;
    }
}

/** 取った1つを戻す（AI が答えなかった・読み取れなかった回）。戻せなくても答えは変えない */
async function release(uid: string, now: number): Promise<void> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: aiUseKey(uid, jstMonth(now)) },
            UpdateExpression: "SET #c = #c - :one",
            ConditionExpression: "#c > :zero",
            ExpressionAttributeNames: { "#c": "count" },
            ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
        }));
    } catch (e) {
        console.error("tripAi: 回数を戻せませんでした", (e as Error)?.name);
    }
}

// ---------- 入力 ----------

const KIND_RE = /^[a-z]{2,16}$/;

export type Candidate = { name: string; area: string; category: string; seasons: string[]; times: string[] };

function cleanText(v: unknown, max: number): string {
    if (typeof v !== "string") return "";
    // 制御文字と改行を除く（AI への指示の行を作らせない）
    return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanKinds(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && KIND_RE.test(k)).slice(0, 8) : [];
}

export function parseCandidates(v: unknown): Candidate[] | null {
    if (!Array.isArray(v) || v.length === 0 || v.length > TRIP_AI_MAX_CANDIDATES) return null;
    const out: Candidate[] = [];
    for (const raw of v) {
        if (!raw || typeof raw !== "object") return null;
        const r = raw as Record<string, unknown>;
        const name = cleanText(r.name, 60);
        if (!name) return null;
        out.push({ name, area: cleanText(r.area, 40), category: cleanText(r.category, 20), seasons: cleanKinds(r.seasons), times: cleanKinds(r.times) });
    }
    return out;
}

function parseDays(v: unknown): number | null {
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= TRIP_AI_MAX_DAYS ? v : null;
}

// ---------- AI ----------

export const SYSTEM_PROMPT = `あなたは日本の旅行プランを組む係です。利用者の頼みと、番号つきの観光スポットの候補を受け取ります。
決まり:
- 場所は候補の番号からだけ選ぶ。候補に無い場所を作らない。同じ番号を2回使わない。
- 日数が指定されていればそれに従う。指定が無ければ頼みから読む（日帰り=1、1泊2日=2、2泊=3。書かれていなければ1）。
- 1日に2〜5か所。「ゆっくり」なら1日3か所まで。「半日」なら2〜3か所。
- 同じ日の場所は近いものでまとめる。日の中は、朝に向く所を先、夕方と夜に向く所を後にする。
- 時刻は書かない。
- 頼みの好み（夜景、朝、夕方、雨の日、温泉、季節など）に合う候補を優先する。雨の日は屋内（美術館、博物館、水族館など）を選ぶ。
- 今の日程が渡されたら、頼みに合わせて直す。
- 理由は日本語で1文、40字まで。候補の外の地名を書かない。
答えは JSON だけを返す: {"days": 日数, "title": "短い題（12字まで）", "stops": [{"n": 候補の番号, "day": 何日目}], "reason": "並べた理由1文"}`;

export function candidateLines(cands: Candidate[]): string {
    return cands.map((c, i) => {
        const tags = [
            c.seasons.length ? `季節:${c.seasons.join("/")}` : "",
            c.times.length ? `時間帯:${c.times.join("/")}` : "",
        ].filter(Boolean).join(" ");
        const where = [c.area, c.category].filter(Boolean).join("、");
        return `${i + 1}. ${c.name}${where ? `（${where}）` : ""}${tags ? ` ${tags}` : ""}`;
    }).join("\n");
}

export function userMessage(request: string, cands: Candidate[], days: number | null, current: { n: number; day: number }[]): string {
    const lines = [`頼み: ${request}`];
    if (days) lines.push(`日数: ${days}`);
    if (current.length) lines.push(`今の日程: ${current.map((s) => `${s.day}日目:${s.n}`).join(" ")}`);
    lines.push("候補:", candidateLines(cands));
    return lines.join("\n");
}

const PREFS = ["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬", "埼玉", "千葉", "東京", "神奈川",
    "新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
    "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"];

export type Plan = { title: string; days: number; stops: { n: number; day: number }[]; reason: string; dropped: number };

/**
 * AI の答えを確かめて形にする。**候補の外の番号・重なり・範囲の外の日は落とす**（落とした数は `dropped`）。
 * 理由の文に候補の外の県の名前があれば、理由ごと出さない（案「詳しく: AI に場所を作らせない」）。
 * 使える行き先が1つも無ければ null（読み取れなかった扱い）
 */
export function sanitizePlan(raw: unknown, cands: Candidate[], fixedDays: number | null): Plan | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const days = fixedDays ?? parseDays(r.days) ?? 1;
    const seen = new Set<number>();
    const stops: { n: number; day: number }[] = [];
    let dropped = 0;
    for (const s of Array.isArray(r.stops) ? r.stops : []) {
        const n = (s as { n?: unknown })?.n;
        const day = (s as { day?: unknown })?.day;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > cands.length || seen.has(n)) { dropped++; continue; }
        const d = typeof day === "number" && Number.isInteger(day) ? Math.min(Math.max(day, 1), days) : 1;
        seen.add(n);
        stops.push({ n, day: d });
    }
    if (stops.length === 0) return null;
    let reason = cleanText(r.reason, 60);
    const areas = cands.map((c) => `${c.area}${c.name}`).join(" ");
    if (PREFS.some((p) => reason.includes(p) && !areas.includes(p))) reason = "";
    return { title: cleanText(r.title, 20), days, stops, reason, dropped };
}

/** AI の文から最初の JSON の塊を読む */
export function extractJson(text: string): unknown {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

async function callModel(message: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const res = await bedrock.send(new ConverseCommand({
        modelId: TRIP_AI_MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: "user", content: [{ text: message }] }],
        inferenceConfig: { maxTokens: TRIP_AI_MAX_OUTPUT_TOKENS, temperature: 0.2 },
    }));
    const text = (res.output?.message?.content ?? []).map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("");
    return { text, inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 };
}

// ---------- 口 ----------

const NO_STORE = { ...JSON_HEADERS, "Cache-Control": "no-store" };
const ok = (body: unknown) => ({ statusCode: 200, headers: NO_STORE, body: JSON.stringify(body) });
/** 上限に来た（429）。アプリはこれを見て AI なしの組み方と Pro の案内に替える */
const limitReached = (tier: TripAiTier, now: number) => ({
    statusCode: 429,
    headers: NO_STORE,
    body: JSON.stringify({ error: "今月の AI の回数を使い切りました", code: "limit", usage: usageOf(tier, TRIP_AI_LIMITS[tier], now) }),
});

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const live = await readLiveCaller(userId, ["supporter"]);
    if ("gone" in live) return live.gone;

    let body: Record<string, unknown>;
    try {
        body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
        if (!body || typeof body !== "object") throw new Error("not object");
    } catch {
        return jsonError(400, "形が正しくありません", "bad_request");
    }

    const now = Date.now();
    const tier: TripAiTier = isAdmin(event) ? "admin" : isPro(live.row, now) ? "pro" : "free";
    const limit = TRIP_AI_LIMITS[tier];

    try {
        switch (body.action) {
            case "status":
                return ok({ usage: usageOf(tier, await readUsed(userId, now), now) });

            case "count": {
                // 端末の AI で作った回。Pro と管理者は数えない（0円）
                if (tier !== "free") return ok({ usage: usageOf(tier, await readUsed(userId, now), now) });
                const used = await reserve(userId, limit, now);
                if (used === null) return limitReached(tier, now);
                return ok({ usage: usageOf(tier, used, now) });
            }

            case "plan": {
                const request = cleanText(body.request, TRIP_AI_MAX_REQUEST);
                const cands = parseCandidates(body.candidates);
                if (!request || !cands) return jsonError(400, "頼みと候補が要ります", "bad_request");
                const days = body.days === undefined || body.days === null ? null : parseDays(body.days);
                if (body.days !== undefined && body.days !== null && days === null) return jsonError(400, "日数が正しくありません", "bad_request");
                const current = (Array.isArray(body.current) ? body.current : [])
                    .filter((s): s is { n: number; day: number } => Number.isInteger((s as { n?: unknown })?.n) && Number.isInteger((s as { day?: unknown })?.day))
                    .filter((s) => s.n >= 1 && s.n <= cands.length)
                    .slice(0, TRIP_AI_MAX_CANDIDATES);

                const used = await reserve(userId, limit, now);
                if (used === null) return limitReached(tier, now);
                let out: Awaited<ReturnType<typeof callModel>>;
                try {
                    out = await callModel(userMessage(request, cands, days, current));
                } catch (e) {
                    await release(userId, now);
                    console.error("tripAi: AI が答えませんでした", (e as Error)?.name);
                    return jsonError(502, "いまは AI を使えません", "ai_unavailable");
                }
                const plan = sanitizePlan(extractJson(out.text), cands, days);
                // 記録は数だけ（打った文・答えの中身は残さない）
                console.log(JSON.stringify({ tripAi: "plan", tier, model: TRIP_AI_MODEL_ID, in: out.inputTokens, out: out.outputTokens, ok: !!plan, dropped: plan?.dropped ?? null }));
                if (!plan) {
                    await release(userId, now);
                    return { statusCode: 422, headers: NO_STORE, body:JSON.stringify({ error: "頼みを読み取れませんでした", code: "unreadable", usage: usageOf(tier, used - 1, now) }) };
                }
                return ok({ plan, usage: usageOf(tier, used, now) });
            }

            default:
                return jsonError(400, "形が正しくありません", "bad_request");
        }
    } catch (e) {
        console.error("tripAi: 失敗しました", (e as Error)?.name);
        return jsonError(500, "うまくいきませんでした。もう一度お試しください");
    }
};
