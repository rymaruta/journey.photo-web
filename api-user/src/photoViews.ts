import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { BatchGetCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { isPhotoId, isRestrictedRow } from "./sanitize";

/**
 * **写真の見られた回数**（札 journey.photo-ios#707・owner 承認 2026-11-23「推奨でお願い」・案の頁「写真の見られた回数」）。
 *
 * ## 何を数えるか
 *
 * 写真の詳細（アプリ）と写真の頁（Web）が1秒以上見えた回数の**累計だけ**。アプリと Web の内訳を持つ。
 * 推移・どこから来たか・誰が見たかは持たない。無料と Pro で分けない。出した日から数える（過去の分は無い）。
 * 同じ端末で同じ写真を30分以内に重ねて送らない・本人が見たときは送らない・圏外では送らない、は画面の側が守る。
 *
 * ## 置き場（新しい表・GSI は作らない）
 *
 * photos 表に写真ごとの小さな行を足す（行を足すのは owner 承認済み）:
 *
 *   views#<写真ID>    app（数・ADD）、web（数・ADD）、since（初めて数えた日・日本時間の YYYY-MM-DD）
 *
 * GSI の欄（`userId`・`createdAt`・`publicFeed`・`storyFeed`）を持たない＝索引には載らない。
 * **写真の行そのものは書き換えない**（大きい行を書くと書き込みの単位が増え、静的な頁の作り直しの元にもなる）。
 * 写真を消したら `views#` も消す（`deleteMyPhoto`・退会・管理者の削除）。
 *
 * ## 数える写真
 *
 * 公開の写真で、ストーリーでないものだけ（`src` がある・`published !== false`・`story !== true`・公開範囲を絞っていない）。
 * それ以外の写真・無い写真には**何も書かずに 204**（無いのか数えないのかを外へ見せない）。
 *
 * ## 荒らし・機械
 *
 *  - User-Agent が空、または bot・crawler・spider など機械の名前を含むものは数えない（204 で黙って捨てる）
 *  - 本文は `MAX_BODY_BYTES` まで（JSON を読む前に断る）
 *  - API Gateway でこの口だけ流量を絞る（`serverless.yml` の `HttpApiStage` の `RouteSettings`）
 *  - わざと数を増やす人は完全には止められないが、数は持ち主にしか見えないので得が小さい（案の頁「詳しく」）
 *
 * ## 見せる相手
 *
 * 数を返すのは**持ち主だけ**（`GET /user/photos/{id}/views`・`GET /user/photos/views?ids=`）。
 * 持ち主でない・無い・ストーリーは同じ 404（どれかを見分けさせない）。公開の写真の行には入らないので、静的な頁や一覧の口から漏れない。
 */

export const VIA = ["app", "web"] as const;
export type Via = (typeof VIA)[number];

/** 本文の上限（バイト）。`{"via":"web"}` は 13 バイト */
export const MAX_BODY_BYTES = 256;
/** まとめて読む口が1回に受ける写真の数（BatchGet の 100 件に合わせる・マイページは 100 件ずつ送る） */
export const MAX_IDS = 100;

export const viewsId = (photoId: string) => `views#${photoId}`;

/**
 * 機械の User-Agent か。空も機械として扱う（ブラウザもアプリの URLSession も必ず付ける）。
 * アプリは `JourneyPhoto/<build> CFNetwork/... Darwin/...`、Web はふつうのブラウザの名前
 */
const BOT_UA = /bot|crawl|spider|slurp|scrap|preview|fetch|monitor|headless|lighthouse|pagespeed|facebookexternalhit|embedly|curl|wget|python|httpclient|okhttp|go-http|java\/|axios|node-fetch|undici|postman|insomnia/i;
export function isBotUserAgent(ua: unknown): boolean {
    if (typeof ua !== "string" || ua.trim() === "") return true;
    return BOT_UA.test(ua);
}

/** 本文から `via` を読む。形が違えば null */
export function parseVia(body: string | undefined | null, isBase64 = false): Via | null {
    if (!body) return null;
    const text = isBase64 ? Buffer.from(body, "base64").toString("utf8") : body;
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    const via = (raw as { via?: unknown } | null)?.via;
    return (VIA as readonly unknown[]).includes(via) ? (via as Via) : null;
}

/** 数えてよい写真の行か（公開・ストーリーでない・絞っていない） */
export function isCountable(row: Record<string, unknown> | undefined): boolean {
    if (!row || !row.src) return false;
    if (row.published === false || row.story === true) return false;
    return !isRestrictedRow(row);
}

/** 日本時間の暦の日（YYYY-MM-DD） */
export function jstDay(now: Date): string {
    return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const header = (headers: Record<string, string | undefined> | undefined, name: string) =>
    headers?.[name] ?? headers?.[name.toLowerCase()];

const noContent = { statusCode: 204, headers: JSON_HEADERS, body: "" };

/**
 * `POST /photos/{id}/view`（ログインしていなくても送れる）。体は `{"via":"app"|"web"}`。
 * 数えた・数えなかったにかかわらず 204（数えなかった理由を外へ見せない）。形の違う要求だけ 400／413
 */
export const recordPhotoView: APIGatewayProxyHandlerV2 = async (event) => {
    const id = event.pathParameters?.id;
    if (!isPhotoId(id)) return jsonError(400, "写真の ID が正しくありません");
    // 読む前に大きさで断る（Base64 は 4/3 に膨らむので、その分も見る）
    const raw = event.body ?? "";
    const limit = event.isBase64Encoded ? Math.ceil(MAX_BODY_BYTES * 4 / 3) + 4 : MAX_BODY_BYTES;
    if (Buffer.byteLength(raw, "utf8") > limit) return jsonError(413, "本文が大きすぎます");
    const via = parseVia(raw, event.isBase64Encoded === true);
    if (!via) return jsonError(400, "via は app か web です");
    if (isBotUserAgent(header(event.headers, "User-Agent") ?? event.requestContext?.http?.userAgent)) return noContent;

    try {
        const photo = await ddb.send(new GetCommand({
            TableName: PHOTOS_TABLE,
            Key: { id },
            ProjectionExpression: "src, published, story, audience",
        }));
        if (!isCountable(photo.Item as Record<string, unknown> | undefined)) return noContent;
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: viewsId(id) },
            UpdateExpression: "ADD #via :one SET since = if_not_exists(since, :day)",
            ExpressionAttributeNames: { "#via": via },
            ExpressionAttributeValues: { ":one": 1, ":day": jstDay(new Date()) },
        }));
        return noContent;
    } catch (e) {
        console.error(`recordPhotoView(${id}):`, e);
        return jsonError(500, "数えられませんでした");
    }
};

export type ViewCounts = { app: number; web: number; total: number; since: string | null };

/** `views#` の行を画面へ返す形に（無ければ全部 0・since は null） */
export function countsOf(row: Record<string, unknown> | undefined): ViewCounts {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const app = n(row?.app);
    const web = n(row?.web);
    const since = typeof row?.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.since) ? row.since : null;
    return { app, web, total: app + web, since };
}

/** 持ち主の写真か（ストーリーは数えないので持ち主にも見せない） */
function ownedBy(row: Record<string, unknown> | undefined, userId: string): boolean {
    if (!row || row.story === true) return false;
    const owner = row.userId ?? row.uploadedBy;
    return typeof owner === "string" && owner !== "" && owner === userId;
}

const notFound = () => jsonError(404, "写真が見つかりません");

/** `GET /user/photos/{id}/views`（持ち主だけ）。答えは `ViewCounts` */
export const getPhotoViews: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!isPhotoId(id)) return notFound();
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    try {
        const photo = await ddb.send(new GetCommand({
            TableName: PHOTOS_TABLE,
            Key: { id },
            ProjectionExpression: "userId, uploadedBy, story",
        }));
        if (!ownedBy(photo.Item as Record<string, unknown> | undefined, userId)) return notFound();
        const views = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: viewsId(id) } }));
        return { statusCode: 200, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" }, body: JSON.stringify(countsOf(views.Item)) };
    } catch (e) {
        console.error(`getPhotoViews(${id}):`, e);
        return jsonError(500, "読み込めませんでした");
    }
};

/** BatchGet を読み残し（UnprocessedKeys）が無くなるまで。読めなかったら投げる */
async function batchGet(keys: string[], projection?: string): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    let pending: Record<string, unknown>[] = keys.map((id) => ({ id }));
    for (let attempt = 0; pending.length > 0; attempt++) {
        if (attempt >= 4) throw new Error(`batchGet: 読み残し ${pending.length} 件`);
        const res = await ddb.send(new BatchGetCommand({
            RequestItems: {
                [PHOTOS_TABLE]: projection
                    ? { Keys: pending, ProjectionExpression: projection, ExpressionAttributeNames: { "#id": "id" } }
                    : { Keys: pending },
            },
        }));
        for (const item of res.Responses?.[PHOTOS_TABLE] ?? []) out.set(String(item.id), item);
        pending = (res.UnprocessedKeys?.[PHOTOS_TABLE]?.Keys ?? []) as Record<string, unknown>[];
    }
    return out;
}

/** `ids` の問い（カンマ区切り）を読む。形の違う ID は落とす・重なりは1つ・`MAX_IDS` を超えたら null */
export function parseIds(raw: string | undefined): string[] | null {
    const ids = [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(isPhotoId))];
    return ids.length > MAX_IDS ? null : ids;
}

/**
 * `GET /user/photos/views?ids=a,b,c`（持ち主だけ・マイページの「写真が見られた回数」）。
 * 答えは `{ views: { <写真ID>: { app, web } } }`。**持ち主の写真だけ**入れる（他人の写真・無い写真は黙って落とす）。
 * 足し算は画面がする（書き込みを増やさない・1人の合計の行を持たない）
 */
export const getMyPhotoViews: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const ids = parseIds(event.queryStringParameters?.ids);
    if (!ids) return jsonError(400, `写真は1回に${MAX_IDS}枚までです`);
    if (ids.length === 0) return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ views: {} }) };
    try {
        const photos = await batchGet(ids, "#id, userId, uploadedBy, story");
        const mine = ids.filter((id) => ownedBy(photos.get(id), userId));
        const rows = mine.length ? await batchGet(mine.map(viewsId)) : new Map();
        const views: Record<string, { app: number; web: number }> = {};
        for (const id of mine) {
            const c = countsOf(rows.get(viewsId(id)));
            views[id] = { app: c.app, web: c.web };
        }
        return { statusCode: 200, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" }, body: JSON.stringify({ views }) };
    } catch (e) {
        console.error("getMyPhotoViews:", e);
        return jsonError(500, "読み込めませんでした");
    }
};
