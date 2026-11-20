/**
 * AI の口（`POST /user/trip-ai`。旅行プランの AI 札 journey.photo-ios#621 と、AI に頼む 札 #652）の**変えやすい値を1か所に**まとめる。
 *
 * - 回数の上限（日と月の両方。owner 承認 2026-11-20「たのむ」・Artifact「AI に頼む」8版）:
 *     旅行プラン: 無料 1日5回かつ月30回、Pro と管理者 1日20回かつ月300回（月の数は 2026-11-15 のまま。1日を足した）
 *     AI に頼む: 無料 1日3回かつ月10回、Pro と管理者 1日20回かつ月300回
 *   端末の AI の回もサーバーで数える（どの道で読んでも同じ上限）。上限を変える・外すのは owner が決める（CLAUDE.md「AI の機能には必ず回数の上限を付ける」）。
 *   🔴 アプリの `TripAILimits`（journey.photo-ios `Sources/JourneyPhoto/Features/Trips/AI/TripAILimits.swift`）と同じ値にする。
 *   アプリはサーバーの返す `limit` を先に使い、自分の値は返事が無いときの表示だけに使う
 * - 費用の止め（同じ承認）:
 *     1人: サーバーの AI の推定金額が月90円に達したら、その人のサーバーの AI をその月は休む
 *     全体: サーバーの AI（旅行プランと頼むの合計）の推定金額を月400円の手前で止める。1日ごとに割り（1日 約13円）、使い残しは翌日へ回す
 *   推定金額は「使ったトークン数 × 単価 × 為替 160円 × 2」で多めに見る。整数で足すため 1/1000 円で持つ
 * - モデル: 2026-11-15 判断で Amazon Nova Lite（東京の on-demand。`amazon.nova-lite-v1:0`）。
 *   Claude Haiku 5.5 はこのアカウントでまだ使えない（AccessDeniedException「not available for this account」）。
 *   使えるようになったら `TRIP_AI_MODEL_ID` を `jp.anthropic.claude-haiku-5-5` に替え、`MODEL_PRICES_USD` に単価を足す
 *   （呼び方は Converse で同じ。権限の `serverless.trip-ai.yml` の Resource も合わせて替える）。
 *   東京の外で処理させない: `apac.` の推論プロファイルはソウル・シンガポールなども含むので使わない
 */

export type TripAiTier = "free" | "pro" | "admin";
export type AiKind = "trip" | "ask";
export type AiLimit = { day: number; month: number };

export const AI_LIMITS: Record<AiKind, Record<TripAiTier, AiLimit>> = {
    trip: { free: { day: 5, month: 30 }, pro: { day: 20, month: 300 }, admin: { day: 20, month: 300 } },
    ask: { free: { day: 3, month: 10 }, pro: { day: 20, month: 300 }, admin: { day: 20, month: 300 } },
};

/** 旅行プランの月の上限（前からの返事 `usage.limit` の値） */
export const TRIP_AI_LIMITS: Record<TripAiTier, number> = {
    free: AI_LIMITS.trip.free.month,
    pro: AI_LIMITS.trip.pro.month,
    admin: AI_LIMITS.trip.admin.month,
};

/** 呼ぶモデル（東京の地域で直接呼ぶ ID） */
export const TRIP_AI_MODEL_ID = "amazon.nova-lite-v1:0";

/** 呼ぶ地域。処理も東京の中だけ（on-demand の直接の呼び出し） */
export const TRIP_AI_REGION = "ap-northeast-1";

/** 候補の数の上限（アプリが台帳と行きたい場所から選ぶ） */
export const TRIP_AI_MAX_CANDIDATES = 20;

/** 日数の上限 */
export const TRIP_AI_MAX_DAYS = 7;

/** 頼みの文の長さの上限（字） */
export const TRIP_AI_MAX_REQUEST = 200;

/** 出力の上限（トークン）。30件の試験で1回の出力は 約130（2026-11-15） */
export const TRIP_AI_MAX_OUTPUT_TOKENS = 600;

// ---------- AI に頼む（札 #652） ----------

/** 質問の文の長さの上限（字） */
export const ASK_MAX_TEXT = 200;
/** 直前の何往復まで文脈に入れるか（owner 承認「直前の2往復」） */
export const ASK_MAX_HISTORY = 2;
/** 前の往復の質問・答えの長さの上限（字） */
export const ASK_MAX_HISTORY_Q = 200;
export const ASK_MAX_HISTORY_A = 400;
/** 引いた行（観光スポット・使い方の頁）の数の上限 */
export const ASK_MAX_SOURCES = 8;
/** 答えの長さの上限（字） */
export const ASK_MAX_ANSWER = 600;
/** 出力の上限（トークン） */
export const ASK_MAX_OUTPUT_TOKENS = 500;

// ---------- 費用（推定金額） ----------

/**
 * 単価（ドル / 100万トークン）。Nova Lite の東京は 2026-11-15 の実測（30件で入力 28,106・出力 3,921 → 0.0032ドル）から
 * 逆に出した値（#621）。知らないモデルは高めの `UNKNOWN_MODEL_PRICE_USD` で数える
 */
export const MODEL_PRICES_USD: Record<string, { input: number; output: number }> = {
    "amazon.nova-lite-v1:0": { input: 0.072, output: 0.288 },
};
export const UNKNOWN_MODEL_PRICE_USD = { input: 1.0, output: 5.0 };
/** 為替（多めに 1ドル 160円）と、さらに掛ける余裕（2倍） */
export const USD_JPY = 160;
export const COST_SAFETY = 2;

/** 1人の月の止め（1/1000 円）。90円 */
export const USER_MONTH_COST_CAP = 90_000;
/** 全体の月の止め（1/1000 円）。400円。AWS の予算の知らせは月500円 */
export const GLOBAL_MONTH_COST_CAP = 400_000;

/**
 * 呼ぶ前に先に取っておく推定金額のトークン数（多めの見込み）。呼んだあとで実際のトークン数に直す。
 * 先に取るので、同時に呼ばれても止めを越えない
 */
export const RESERVE_TOKENS: Record<AiKind, { input: number; output: number }> = {
    trip: { input: 4000, output: TRIP_AI_MAX_OUTPUT_TOKENS },
    ask: { input: 6000, output: ASK_MAX_OUTPUT_TOKENS },
};

/** トークン数 → 推定金額（1/1000 円・切り上げ） */
export function estimateCost(inputTokens: number, outputTokens: number, modelId: string = TRIP_AI_MODEL_ID): number {
    const p = MODEL_PRICES_USD[modelId] ?? UNKNOWN_MODEL_PRICE_USD;
    const usd = (Math.max(0, inputTokens) * p.input + Math.max(0, outputTokens) * p.output) / 1_000_000;
    return Math.ceil(usd * USD_JPY * COST_SAFETY * 1000);
}

/** 呼ぶ前に取る推定金額（1/1000 円） */
export const reserveCost = (kind: AiKind): number => estimateCost(RESERVE_TOKENS[kind].input, RESERVE_TOKENS[kind].output);
