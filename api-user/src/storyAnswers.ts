import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, displayNameOf, DEFAULT_NAME, deletedAmong, withUnreadAsDeleted, DELETED_USER_NAME } from "./notify";
import { truncate, sanitizeText } from "./sanitize";
import { isBlocked, hiddenUserIds } from "./blockCheck";
import { isFollowing } from "./followCheck";
import { canViewStoryAudience } from "./storyAudience";
import { isStoryExpired } from "./storyExpiry";
import { readLiveCaller, assertLiveCaller } from "./liveCaller";
import { storyVotesId } from "./storyVotes";
import { isStoryQuestion, STORY_ANSWER_LEN_MAX, type StoryText } from "./storyText";
import { isReportReason, REPORT_NOTE_MAX } from "./report";

/**
 * ストーリーの**質問スタンプ**への答え。札 #505・2026-11-09。
 *
 * ## 答えは投稿者だけが読める
 *
 * 答えは `GET /stories/{id}/answers`（**投稿者だけ**。他人は 403）でしか返らない。
 * `getStories` の応答にも、ストーリーの行にも**入れない**（入れると、一覧を引いた
 * 全員に届く——投票の `counts` のように見る人で出し分ける形も取らない）。
 * 一覧に付けるのは、投稿者にだけ**件数**（`answerCount`）。
 *
 * ## 置き場は**票の文書（`storyvotes#<storyId>`）の `answers` 列**（判断）
 *
 * 新しい文書の種類を作らない。理由は**消す経路**:
 * 他人の言葉は「24時間で消える」約束で、ストーリーの削除・期限切れの掃除・
 * アーカイブへの移動・退会・写真の削除の**6つの経路が、票の文書を既に消している**
 * （`sweepStoryVotes` を含む）。別の文書にすると6つ全部に足すことになり、
 * **1つ漏れると他人の文章と uid が永久に残る**（このテーブルに TTL は無い）。
 * 同じ文書の別の列なら、消す経路は増えず、取りこぼしも起きない。
 * 票の書き込み（`ADD votersA …`）は `answers` を触らず、こちらも票の列を触らない。
 *
 * ## 答えの門は返信・投票と同じ**5つ**
 *
 * ブロック（どちら向きでも 404）・フォロー・**見せる範囲**（親しい友達）・期限・
 * 自分の質問には答えない。さらに質問スタンプが在る投稿にだけ答えられる。
 * **画面側だけの防御を作らない。**
 *
 * ## 通報
 *
 * 答え1件ごとに、**投稿者が**通報できる（`reportStoryAnswer`）。ストーリーも答えも
 * 24時間で消えるので、**通報の行に答えの全文と答えた人の uid を写して残す**
 * （消えたあとに運営が読めないと通報が成り立たない）。
 */

/** 1つのストーリーが受ける答えの数。**超えたぶんは受けない**（古いものを黙って押し出さない） */
export const ANSWERS_MAX = 200;
/** 1人が1つのストーリーに送れる答えの数（返信の 10 より小さい——質問への一言） */
export const ANSWERS_MAX_PER_USER = 3;
/** `answers` 列に許すバイト数（票のセットと合わせて 400KB を超えない余裕） */
const ANSWERS_BUDGET_BYTES = 200 * 1024;
const APPEND_RETRIES = 3;

export type StoryAnswer = {
    id: string;
    uid: string;
    name: string;
    text: string;
    t: string;
    /** 答えた人が退会している（読むときにサーバーが立てる） */
    deleted?: boolean;
};

/** ストーリーの行が質問スタンプを持つか */
export function storyHasQuestion(texts: unknown): boolean {
    return Array.isArray(texts) && (texts as StoryText[]).some((t) => t && typeof t === "object" && isStoryQuestion(t));
}

/** 通報の行のキー。**1人1つの答えにつき1件** */
export const reportAnswerId = (storyId: string, answerId: string, reporterId: string) =>
    `report#${storyId}#answer#${answerId}#${reporterId}`;

type StoryRow = {
    story?: boolean; userId?: string; uploadedBy?: string;
    expiresAt?: string; texts?: unknown; audience?: unknown; allowReplies?: unknown;
    src?: string;
};

async function loadStory(storyId: string): Promise<StoryRow | null> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
    const item = res.Item as StoryRow | undefined;
    if (!item || item.story !== true) return null;
    return item;
}

async function readAnswers(storyId: string, consistent = false): Promise<StoryAnswer[]> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: storyVotesId(storyId) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    const a = res.Item?.answers;
    return Array.isArray(a) ? (a as StoryAnswer[]) : [];
}

/**
 * 投稿者にだけ付ける答えの件数（`getStories` が呼ぶ）。読めなければ null
 * （件数を付けない。答えそのものは `getStoryAnswers` で読める）。
 */
export async function storyAnswerCount(storyId: string, hidden: ReadonlySet<string>): Promise<number | null> {
    try {
        return (await readAnswers(storyId)).filter((a) => !hidden.has(a.uid)).length;
    } catch (e) {
        console.error(`storyAnswerCount: 読めませんでした（${storyId}）:`, e);
        return null;
    }
}

type Cancel = { Code?: string };
function cancellationReasons(e: unknown): Cancel[] {
    const err = e as { name?: string; CancellationReasons?: Cancel[] };
    return err.name === "TransactionCanceledException" && Array.isArray(err.CancellationReasons) ? err.CancellationReasons : [];
}

/** POST /stories/{id}/answers — 質問に答える（認証必要） */
export const answerStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!uid || !storyId) return jsonError(400, "不正なリクエスト");

    let body: { text?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    // 文字列のときだけ（`{"text":{"a":1}}` を `[object Object]` にしない）
    const text = typeof body.text === "string" ? truncate(body.text.trim(), STORY_ANSWER_LEN_MAX) : "";
    if (!text) return jsonError(400, "答えを入力してください");

    try {
        const story = await loadStory(storyId);
        if (!story) return jsonError(404, "ストーリーが見つかりません");
        const ownerId = story.userId ?? story.uploadedBy;
        if (ownerId === uid) return jsonError(400, "自分の質問には答えられません");
        if (isStoryExpired(story)) return jsonError(404, "ストーリーが見つかりません");
        // **返信・投票と同じ門。相手の関係は教えない（404）。**
        if (ownerId && await isBlocked(ownerId, uid)) return jsonError(404, "ストーリーが見つかりません");
        if (ownerId && !await isFollowing(ownerId, uid)) return jsonError(404, "ストーリーが見つかりません");
        if (!await canViewStoryAudience(story, uid)) return jsonError(404, "ストーリーが見つかりません");
        // 質問スタンプの無い投稿には答えられない（答えの行き先が無い）。投稿の中身の話で、
        // 相手の設定ではないので 400 で理由を言う
        if (!storyHasQuestion(story.texts)) return jsonError(400, "この投稿に質問はありません");

        // 退会した本人（期限内のトークン）に書かせない（`liveCaller.ts`）。
        // ここより上は読むだけ
        const caller = await readLiveCaller(uid, ["displayName"]);
        if ("gone" in caller) return caller.gone;

        const answer: StoryAnswer = {
            id: uuidv4(), uid, name: displayNameOf(caller.row) ?? DEFAULT_NAME, text, t: new Date().toISOString(),
        };

        let stored = false;
        for (let attempt = 0; attempt < APPEND_RETRIES && !stored; attempt++) {
            const existing = await readAnswers(storyId, attempt > 0);
            // 前回の追記が通っていた（応答だけ失われた再送）なら、もう足さない。上限より先に見る
            if (existing.some((a) => a.id === answer.id)) { stored = true; break; }
            if (existing.filter((a) => a.uid === uid).length >= ANSWERS_MAX_PER_USER) {
                return jsonError(429, `この質問への答えは${ANSWERS_MAX_PER_USER}件までです`);
            }
            if (existing.length >= ANSWERS_MAX) return jsonError(429, "この質問は答えの上限に達しました");
            if (Buffer.byteLength(JSON.stringify([...existing, answer]), "utf8") > ANSWERS_BUDGET_BYTES) {
                return jsonError(429, "この質問は答えの上限に達しました");
            }
            try {
                await ddb.send(new TransactWriteCommand({
                    TransactItems: [
                        // 行がまだ在り、棚へ移っていないこと（消えたあとに他人の文章の孤児を作らない。
                        // `voteStory` と同じ ConditionCheck）
                        { ConditionCheck: {
                            TableName: PHOTOS_TABLE, Key: { id: storyId },
                            ConditionExpression: "attribute_exists(id) AND attribute_not_exists(archivedAt)",
                        } },
                        // **読みと書きを長さの条件でつなぐ**（同時に投げても上限・1人の上限が破れない）
                        { Update: {
                            TableName: PHOTOS_TABLE, Key: { id: storyVotesId(storyId) },
                            UpdateExpression: "SET #a = list_append(if_not_exists(#a, :empty), :new), storyId = :sid, updatedAt = :now",
                            ConditionExpression: existing.length === 0
                                ? "attribute_not_exists(#a) OR size(#a) = :len"
                                : "size(#a) = :len",
                            ExpressionAttributeNames: { "#a": "answers" },
                            ExpressionAttributeValues: {
                                ":new": [answer], ":empty": [], ":sid": storyId, ":now": answer.t, ":len": existing.length,
                            },
                        } },
                    ],
                }));
                stored = true;
            } catch (e) {
                const reasons = cancellationReasons(e);
                if (reasons.length === 0) throw e;
                // 行が消えていた（削除と同時）
                if (reasons[0]?.Code === "ConditionalCheckFailed") return jsonError(404, "ストーリーが見つかりません");
                // 誰かが先に書いた。読み直してやり直す
            }
        }
        if (!stored) return jsonError(409, "混み合っています。もう一度お試しください");

        // 投稿者への通知。**既存の `storyreply` を使う**（判断: 古いアプリが知っている
        // 種類で、文面も「ストーリーに返信しました」で外れない。新しい種類を足すと
        // 古いアプリには何も出ない）。ブロックの再確認は `pushNotification` が持つ
        if (ownerId) {
            await pushNotification(ownerId, {
                type: "storyreply", photoId: storyId, photoSrc: String(story.src ?? ""),
                byName: answer.name, byId: uid, t: answer.t,
            });
        }
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            // **答えの中身は返さない**（`id` だけ。本人にも読み返させない——読めるのは投稿者だけ）
            body: JSON.stringify({ success: true, id: answer.id }),
        };
    } catch (e) {
        console.error("answerStory error:", e);
        return jsonError(500, "送信に失敗しました");
    }
};

/** GET /stories/{id}/answers — 届いた答え（**投稿者だけ**） */
export const getStoryAnswers: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const callerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!callerId || !storyId) return jsonError(400, "不正なリクエスト");
    try {
        const story = await loadStory(storyId);
        if (!story) return jsonError(404, "ストーリーが見つかりません");
        // **答えは投稿者のもの。** 他人には読ませない（`getStoryReplies` と同じ 403）
        if ((story.userId ?? story.uploadedBy) !== callerId) return jsonError(403, "権限がありません");
        // 期限が切れたら答えも読めない（掃除が文書を消すまでの間も出さない）
        if (isStoryExpired(story)) {
            return { statusCode: 200, headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" }, body: JSON.stringify({ items: [], count: 0 }) };
        }
        const all = await readAnswers(storyId);
        // ブロックした相手の答えは出さない（両向き。`getStoryReplies` と同じ。読めなければ出す側）
        const hidden = all.length === 0
            ? new Set<string>()
            : await hiddenUserIds(callerId).catch((e) => {
                console.error("getStoryAnswers: ブロック一覧を読めませんでした:", e);
                return new Set<string>();
            });
        const visible = hidden.size === 0 ? all : all.filter((a) => !hidden.has(a.uid));
        const items = [...visible].reverse();   // 末尾追記なので後ろが新しい
        // 退会した人の名前は出さない（読めなければ伏せる）
        const gone = items.length === 0 ? new Set<string>() : withUnreadAsDeleted(await deletedAmong(items.map((a) => a.uid)));
        const safe = gone.size === 0 ? items : items.map((a) => (gone.has(a.uid) ? { ...a, name: DELETED_USER_NAME, deleted: true } : a));
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ items: safe, count: visible.length }),
        };
    } catch (e) {
        console.error("getStoryAnswers error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * POST /stories/{id}/answers/{answerId}/report — 答え1件を通報する（**投稿者だけ**）。
 *
 * 読めるのが投稿者だけなので、通報できるのも投稿者だけ（他人は 404。実在を教えない）。
 * **答えの全文・答えた人の uid・問いを行に写す**——ストーリーも答えも24時間で消える
 * ので、写さないと運営が読む前に証拠が無くなる。受け付けたことだけ返す
 * （`report.ts` と同じ。自動で何かを消す仕組みは作らない）。
 */
export const reportStoryAnswer: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const storyId = event.pathParameters?.id;
    const answerId = event.pathParameters?.answerId;
    if (!me || !storyId || !answerId) return jsonError(400, "不正なリクエスト");
    // 行 ID の区切りを混ぜない（`report.ts` が写真 ID に置いているのと同じ線）
    if (storyId.includes("#") || answerId.includes("#")) return jsonError(404, "答えが見つかりません");

    let body: { reason?: unknown; note?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}");
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    if (!isReportReason(body.reason)) return jsonError(400, "理由を選んでください");
    // 退会した本人（期限内のトークン）に書かせない（`report.ts` と同じ）
    const gone = await assertLiveCaller(me);
    if (gone) return gone;

    try {
        const story = await loadStory(storyId);
        // 投稿者以外には「無い」（答えの実在を探らせない）
        if (!story || (story.userId ?? story.uploadedBy) !== me) return jsonError(404, "答えが見つかりません");
        const answer = (await readAnswers(storyId, true)).find((a) => a.id === answerId);
        if (!answer) return jsonError(404, "答えが見つかりません");

        const question = Array.isArray(story.texts)
            ? ((story.texts as StoryText[]).find((t) => t && typeof t === "object" && isStoryQuestion(t)) as { prompt?: string } | undefined)?.prompt
            : undefined;
        const note = sanitizeText(body.note, REPORT_NOTE_MAX);
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: {
                id: reportAnswerId(storyId, answerId, me),
                photoId: storyId,
                answerId,
                reporterId: me,
                // **通報された中身の持ち主は答えた人**（`report.ts` の `ownerId` と同じ意味）
                ownerId: answer.uid,
                reason: body.reason,
                ...(note ? { note } : {}),
                story: true,
                storyAnswer: true,
                answerText: answer.text,
                ...(question ? { question } : {}),
                createdAt: new Date().toISOString(),
            },
            // 条件なし。押し直しは上書き（1人1つの答えにつき1件に保たれる）
        }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("reportStoryAnswer failed:", (e as Error)?.name);
        return jsonError(500, "通報を受け付けられませんでした");
    }
};
