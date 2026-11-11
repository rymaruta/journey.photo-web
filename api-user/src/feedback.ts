import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, randomUUID } from "node:crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { assertLiveCaller } from "./liveCaller";
import { cleanMultilineText } from "./textClean";
import { extForType } from "./uploadPolicy";
import { isUserId } from "./userId";

/**
 * **意見箱（札 #546・2026-11-11 owner 承認「フォームまかせる」「形式は自由記述」）。**
 *
 * 利用者の声を1件ずつ受け取る口。**ログインした人**（`POST /user/feedback`）と
 * **していない人**（`POST /feedback`・IP ごとの上限）の両方から受ける。中身は**自由に書く本文1つ**が主で、
 * 👍／👎 や種類の選択は持たない（owner 2026-11-11「形式は自由記述」）。任意で写真1枚・「返事が欲しい」。
 *
 * ## 保存の形（新しい表・GSI・TTL は作らない。既存の写真テーブルに行の種類を2つ足す）
 *
 *   feedback#<id>            1件の意見。`id` は端末が作る UUID（圏外の下書きを送り直しても1件にする冪等の鍵）
 *       feedback: true       行の種類の印
 *       text                 本文（`cleanMultilineText`・上限 `FEEDBACK_TEXT_MAX`）
 *       screen               どの画面から（英数字の短い名前。例 `settings`・`story-create`・`web-footer`）
 *       appVersion           アプリの版（例 `1.1.20 (3)`。Web は空）
 *       os                   OS の版だけ（例 `iOS 18.1`。機種名・端末の識別子は持たない）
 *       platform             `ios` | `web`
 *       wantsReply           返事が欲しいか（**ログインした人だけ**。していない人は宛先が無いので常に false）
 *       uid                  送った人（ログインした人だけ。返事をアプリの知らせで返すため）
 *       photoKey / photoType 添えた写真（`private/feedback/<id>`。S3 の非公開の置き場）
 *       day / createdAt      受けた日（JST）・時刻
 *
 *   feedbackday#<JST の日付>  その日の索引と歯止め（1日1行）
 *       ids                  その日に受けた意見の id の列（読み出しはこの行から引く＝表全体を Scan しない）
 *       total                その日の件数（全体の上限 `FEEDBACK_DAILY_TOTAL`）
 *       by_u_<uid>           ログインした人ごとの件数（`FEEDBACK_DAILY_PER_USER`）
 *       by_ip_<ハッシュ>       ログインしていない人の IP ごとの件数（`FEEDBACK_DAILY_PER_IP`）
 *
 * 🔴 **写真の行と見分けがつく欄名にする。** このテーブルは公開一覧の Scan（`api/src/ddb-photos.ts`・
 * `scripts/sync-photos-from-ddb.js`）が `src` の有無で写真を見分け、索引は `userId`・`publicFeed`・`storyFeed`
 * で載る。意見の行は**どれも持たない**（送った人は `uid`・写真は `photoKey`）——公開の一覧・索引に載らない。
 *
 * ## 個人の情報（必要以上に持たない）
 *
 *   - 位置は持たない。写真は原本のまま S3 の非公開の置き場へ入るだけで、配らない（CloudFront の
 *     `/private/*` は署名必須。`signedUrl.ts` は写真の行の鍵しか署名しない）
 *   - **IP は保存しない。** 歯止めの欄名に使うのは「日付＋IP」の SHA-256 の先頭16字だけで、日が変わると
 *     別の値になる（同じ人を日をまたいで追えない）。意見の行には入れない
 *   - 本文はサーバーのログに出さない（失敗は `e.name` だけ）
 *   - 退会しても意見の行は残る（`uid` は消えたアカウントを指すだけ）。読み出しの側で個人の情報を除いて扱う
 *
 * ## 読み出し（2026-11-11 判断: 管理者の口は作らず、aws CLI で読む形）
 *
 * 秘書室（Claude）が毎日読む。**口を足すと未認証の攻撃面と IAM が増える**ので作らない。
 * `PHOTOS_TABLE=… node scripts/read-feedback.js <日付>` が `feedbackday#<日付>` を1回 GetItem → `feedback#<id>` を BatchGet する
 * （写真は `aws s3 cp s3://<バケット>/private/feedback/<id> .`）。手で引くなら:
 *
 *     aws dynamodb get-item --table-name <写真テーブル> --key '{"id":{"S":"feedbackday#2026-11-11"}}'
 */

export const FEEDBACK_TEXT_MAX = 1000;
/** その日の全体の件数（荒らしで表と S3 を膨らませない最後の歯止め） */
export const FEEDBACK_DAILY_TOTAL = 500;
export const FEEDBACK_DAILY_PER_USER = 20;
export const FEEDBACK_DAILY_PER_IP = 10;
/** 添える写真の上限（端末は長辺を縮めて JPEG にしてから送る。原本の大きさは要らない） */
export const FEEDBACK_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const FEEDBACK_PHOTO_PREFIX = "private/feedback/";
const SCREEN_MAX = 40;
const SHORT_MAX = 32;

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

export const feedbackKey = (id: string) => `feedback#${id}`;
export const feedbackDayKey = (day: string) => `feedbackday#${day}`;

/** JST の日付（日の区切りは日本の0時。`dm.ts` の `dayOf` と同じ物差し） */
export const feedbackDayOf = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 歯止めの欄名に使う IP のハッシュ（**日付を混ぜる**＝日をまたいで同じ人を追えない。IP そのものは保存しない） */
export function ipBucket(ip: string, day: string): string {
    return createHash("sha256").update(`${day}|${ip}`).digest("hex").slice(0, 16);
}

const isCcf = (e: unknown) => (e as { name?: string })?.name === "ConditionalCheckFailedException";
const errName = (e: unknown) => (e as { name?: string })?.name ?? "Error";

/** 画面の名前・版・OS の版。**英数字と少しの記号だけ**を短く通す（自由な文字を欄に入れさせない） */
export function cleanToken(v: unknown, max: number): string {
    if (typeof v !== "string") return "";
    return v.replace(/[^A-Za-z0-9 ._()\-]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** `parseFeedback` の結果が読めた本文か（400 の応答ではないか） */
export const isFeedbackInput = (v: FeedbackInput | APIGatewayProxyStructuredResultV2): v is FeedbackInput =>
    typeof (v as FeedbackInput).id === "string" && typeof (v as FeedbackInput).text === "string";

export type FeedbackInput = {
    id: string;
    text: string;
    screen: string;
    appVersion: string;
    os: string;
    platform: "ios" | "web";
    wantsReply: boolean;
    photo?: { contentType: string; size: number };
};

/** 本文を読んで整える。おかしければ 400 の応答を返す */
export function parseFeedback(raw: unknown): FeedbackInput | APIGatewayProxyStructuredResultV2 {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return jsonError(400, "不正なリクエスト");
    const b = raw as Record<string, unknown>;
    const text = cleanMultilineText(b.text, FEEDBACK_TEXT_MAX);
    if (!text) return jsonError(400, "ひとことを書いてください", "feedback_empty");
    let id: string;
    if (b.id === undefined) {
        id = randomUUID();
    } else if (typeof b.id === "string" && isUserId(b.id)) {
        id = b.id.toLowerCase();
    } else {
        return jsonError(400, "不正なリクエスト");
    }
    let photo: FeedbackInput["photo"];
    if (b.photo !== undefined && b.photo !== null) {
        const p = b.photo as Record<string, unknown>;
        const size = p?.size;
        if (!extForType(p?.contentType, false)) {
            return jsonError(400, "対応していない形式です（JPEG・PNG・WebP・AVIF・HEIC・GIF）", "feedback_photo_type");
        }
        if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return jsonError(400, "不正なリクエスト");
        if (size > FEEDBACK_PHOTO_MAX_BYTES) {
            return jsonError(400, "写真が大きすぎます（最大10MB）", "feedback_photo_size");
        }
        photo = { contentType: String(p.contentType).split(";")[0].trim().toLowerCase(), size };
    }
    return {
        id,
        text,
        screen: cleanToken(b.screen, SCREEN_MAX),
        appVersion: cleanToken(b.appVersion, SHORT_MAX),
        os: cleanToken(b.os, SHORT_MAX),
        platform: b.platform === "ios" ? "ios" : "web",
        wantsReply: b.wantsReply === true,
        photo,
    };
}

/** 写真の置き場への署名つき PUT（`upload.ts` と同じ作り: 種別と長さを署名に入れて縛る） */
async function presignPhoto(key: string, photo: { contentType: string; size: number }): Promise<string> {
    return getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: process.env.UPLOAD_BUCKET!,
            Key: key,
            ContentType: photo.contentType,
            ContentLength: photo.size,
        }),
        // 署名対象に content-type と content-length を戻す理由は `upload.ts` の同じ指定
        { expiresIn: 900, signableHeaders: new Set(["content-type", "content-length"]) },
    );
}

type Who = { uid: string } | { ipHash: string };

/** その日の歯止めを原子的に1つ進め、索引に id を足す。上限なら false（何も進まない） */
async function reserve(id: string, who: Who, day: string): Promise<boolean> {
    const isUser = "uid" in who;
    const whoAttr = isUser ? `by_u_${who.uid}` : `by_ip_${who.ipHash}`;
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: feedbackDayKey(day) },
            UpdateExpression: "SET #d = :day, ids = list_append(if_not_exists(ids, :empty), :idl) ADD total :one, #w :one",
            ConditionExpression: "(attribute_not_exists(total) OR total < :maxTotal) AND (attribute_not_exists(#w) OR #w < :maxWho)",
            ExpressionAttributeNames: { "#d": "day", "#w": whoAttr },
            ExpressionAttributeValues: {
                ":day": day, ":empty": [], ":idl": [id], ":one": 1,
                ":maxTotal": FEEDBACK_DAILY_TOTAL,
                ":maxWho": isUser ? FEEDBACK_DAILY_PER_USER : FEEDBACK_DAILY_PER_IP,
            },
        }));
        return true;
    } catch (e) {
        if (isCcf(e)) return false;
        throw e;
    }
}

const ok = (id: string, uploadUrl?: string, contentType?: string): APIGatewayProxyStructuredResultV2 => ({
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(uploadUrl ? { ok: true, id, upload: { url: uploadUrl, contentType } } : { ok: true, id }),
});

/**
 * 受け取りの本体（ログインの有無で `who` だけが違う）。
 *
 * **同じ id の送り直しは1件のまま**（圏外の下書きの再送・応答を取りこぼした押し直し）。もう在れば数えずに
 * 200 を返し、写真が付いていれば写真の PUT の署名だけを出し直す（前の署名が切れていても写真を送り直せる）。
 */
export async function receiveFeedback(input: FeedbackInput, who: Who, now = Date.now()): Promise<APIGatewayProxyStructuredResultV2> {
    const key = feedbackKey(input.id);
    const existing = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE, Key: { id: key }, ProjectionExpression: "id, uid, photoKey, photoType",
    }));
    const prev = existing.Item as { uid?: string; photoKey?: string; photoType?: string } | undefined;
    if (prev) {
        // 別の人の id を当てても何も出さない（id は端末が作る UUID で、当てるのは現実的でないが念のため）
        const sameSender = "uid" in who ? prev.uid === who.uid : prev.uid === undefined;
        if (!sameSender) return jsonError(409, "送り直せませんでした", "feedback_conflict");
        if (prev.photoKey && prev.photoType && input.photo && input.photo.contentType === prev.photoType) {
            return ok(input.id, await presignPhoto(prev.photoKey, input.photo), input.photo.contentType);
        }
        return ok(input.id);
    }

    const day = feedbackDayOf(now);
    if (!(await reserve(input.id, who, day))) {
        return jsonError(429, "今日はこれ以上送れません。明日また送ってください", "feedback_limit");
    }

    const photoKey = input.photo ? `${FEEDBACK_PHOTO_PREFIX}${input.id}` : undefined;
    const uid = "uid" in who ? who.uid : undefined;
    try {
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: {
                id: key,
                feedback: true,
                text: input.text,
                screen: input.screen || undefined,
                appVersion: input.appVersion || undefined,
                os: input.os || undefined,
                platform: input.platform,
                // 宛先の無い人（ログインしていない）には返事を約束しない
                wantsReply: uid ? input.wantsReply : false,
                uid,
                photoKey,
                photoType: input.photo?.contentType,
                day,
                createdAt: new Date(now).toISOString(),
            },
            ConditionExpression: "attribute_not_exists(id)",
        }));
    } catch (e) {
        // 同じ id が同時に2本来た（押し直し）。先の1件が保存されているので成功として返す
        if (!isCcf(e)) throw e;
    }
    if (photoKey && input.photo) {
        return ok(input.id, await presignPhoto(photoKey, input.photo), input.photo.contentType);
    }
    return ok(input.id);
}

const readJson = (body: string | null | undefined): unknown => {
    try {
        return JSON.parse(body ?? "{}") as unknown;
    } catch {
        return null;
    }
};

async function guarded(run: () => Promise<APIGatewayProxyStructuredResultV2>, label: string): Promise<APIGatewayProxyStructuredResultV2> {
    try {
        return await run();
    } catch (e) {
        // 本文は出さない（名前だけ）
        console.error(`${label}: 受け取れませんでした:`, errName(e));
        return jsonError(500, "送れませんでした。しばらくしてからもう一度お試しください");
    }
}

/** `POST /user/feedback`（ログインした人） */
export const sendFeedback: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");
    const gone = await assertLiveCaller(uid);
    if (gone) return gone;
    const input = parseFeedback(readJson(event.body));
    if (!isFeedbackInput(input)) return input;
    return guarded(() => receiveFeedback(input, { uid }), "sendFeedback");
};

/** `POST /feedback`（ログインしていない人。IP ごとの上限） */
export const sendFeedbackPublic: APIGatewayProxyHandlerV2 = async (event) => {
    const ip = event.requestContext?.http?.sourceIp ?? "";
    if (!ip) return jsonError(400, "不正なリクエスト");
    const input = parseFeedback(readJson(event.body));
    if (!isFeedbackInput(input)) return input;
    const now = Date.now();
    return guarded(() => receiveFeedback(input, { ipHash: ipBucket(ip, feedbackDayOf(now)) }, now), "sendFeedbackPublic");
};
