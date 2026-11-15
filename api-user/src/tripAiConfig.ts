/**
 * AI で旅行プランを作る（札 journey.photo-ios#621）の**変えやすい値を1か所に**まとめる。
 *
 * - 回数の上限（月ごと）: owner 2026-11-15「無料の人 月30回、Pro の人と管理者 月300回」。
 *   🔴 アプリの `TripAILimits`（journey.photo-ios `Sources/JourneyPhoto/Features/Trips/AI/TripAILimits.swift`）と同じ値にする。
 *   アプリはサーバーの返す `limit` を先に使い、自分の値は返事が無いときの表示だけに使う
 * - モデル: 2026-11-15 判断で Amazon Nova Lite（東京の on-demand。`amazon.nova-lite-v1:0`）。
 *   Claude Haiku 5.5 はこのアカウントでまだ使えない（AccessDeniedException「not available for this account」）。
 *   使えるようになったら `TRIP_AI_MODEL_ID` を `jp.anthropic.claude-haiku-5-5` に替えるだけでよい
 *   （呼び方は Converse で同じ。権限の `serverless.trip-ai.yml` の Resource も合わせて替える）。
 *   東京の外で処理させない: `apac.` の推論プロファイルはソウル・シンガポールなども含むので使わない
 */

export const TRIP_AI_LIMITS = {
    free: 30,
    pro: 300,
    admin: 300,
} as const;

export type TripAiTier = keyof typeof TRIP_AI_LIMITS;

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
