/**
 * プロフィールの QR を「更新」できるようにする（札 journey.photo-ios#545・2026-11-12 owner 承認
 * 「DB の変更してもいいけどね」）。LINE のように、本人が更新すると前の QR とリンクがすぐ使えなくなる。
 *
 * ## 形
 *
 * - QR の中身は `https://journey-photo.com/qr?t=<合図>`。合図は共同アルバムの招待と同じ作り
 *   （24バイトの乱数・base64url の32字・`invite.ts` の `newInviteToken`）。推測できない長さが守りの根拠。
 *   2026-11-12 判断: 設計の案は `/q?t=` だったが、`/q` は「今日の一問」（`app/q`）が使っている。
 *   同じ頁に2つの役を持たせず、`/qr` に置いた
 * - 行は photos 表に2種類（GSI は足さない）:
 *     `qr#<合図>`      { owner: 利用者, issuedAt }  … 合図 → 人（ログイン不要の口が引く）
 *     `qrof#<利用者>`  { token: 今の合図, issuedAt } … 人 → 今の合図（本人の口・退会の掃除が引く）
 *   🔴 **`userId`・`createdAt`・`storyFeed`・`publicFeed` を持たせない。** 表の索引
 *   （`userId-createdAt-index`・`storyFeed-expiresAt-index`・`publicFeed-createdAt-index`）に載ると、
 *   フォローできる相手かの判定・ストーリー一覧・公開の一覧に紛れ込む（`invite.ts` の `albumKey` の注記と同じ）
 * - 期限は持たない（LINE と同じく、本人が更新するまで使える）。自動で切れると、保存・共有・印刷した QR が
 *   知らないうちに使えなくなる（資料「画面デザインの案」第10章の比べ）
 *
 * ## 置き場
 *
 * 口は user API のスタックではなく**別のスタック**（`serverless.profile-qr.yml`）に置く。
 * user API は部品が 488/500 で、足すと CloudFormation の上限を超える（2026-11-12 に撮影スポットを払う ② が
 * 503 個で本番の反映を落とした）。退会の掃除（`account.ts`）だけは user API の中で、行の鍵をここから使う。
 */

import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { assertLiveCaller } from "./liveCaller";
import { isValidInviteToken, newInviteToken } from "./invite";

/** 合図 → 人の行の鍵 */
export const qrKey = (token: string) => `qr#${token}`;
/** 人 → 今の合図の行の鍵 */
export const qrOfKey = (userId: string) => `qrof#${userId}`;

/** 合図を作る（招待と同じ 24 バイト・base64url） */
export const newQrToken = (): string => newInviteToken();

/** 合図として受け付けてよい形か。**表を引く前に見る**（ログイン不要の口で無駄な読み取りを起こさせない） */
export const isValidQrToken = (raw: unknown): raw is string => isValidInviteToken(raw);

/**
 * 使えない合図の言葉。「期限切れ」「取り消し」「無い」を分けない——どれも相手に新しい QR を
 * 出してもらう以外に手が無いので、言葉は1つ（資料 第10章「古い QR を読んだとき」）
 */
export const QR_UNUSABLE_MESSAGE = "この QR コードは使えません";

type QrOfRow = { id: string; token?: unknown; issuedAt?: unknown };

const ok = (body: unknown) => ({ statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) });

async function readCurrent(userId: string): Promise<{ token: string; issuedAt: string } | null> {
    // 強い読み: 更新の直後に古い合図を返さない
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: qrOfKey(userId) }, ConsistentRead: true }));
    const row = res.Item as QrOfRow | undefined;
    if (!row || !isValidQrToken(row.token)) return null;
    return { token: row.token, issuedAt: typeof row.issuedAt === "string" ? row.issuedAt : "" };
}

function isCancelled(e: unknown): boolean {
    return (e as { name?: string } | null)?.name === "TransactionCanceledException";
}

/**
 * 新しい合図を書く。`previous` があれば、その `qr#` を消し、`qrof#` が `previous` のままであることを条件に替える
 * （2回押し・2台から同時に押したときに、片方の合図の行が誰からも指されずに残らないように）。
 * 3行を1回のまとめ書き。条件が崩れたら TransactionCanceledException を投げる
 */
async function writeNew(userId: string, previous: string | null): Promise<{ token: string; issuedAt: string }> {
    const token = newQrToken();
    const issuedAt = new Date().toISOString();
    const items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]> = [
        {
            Put: {
                TableName: PHOTOS_TABLE,
                Item: { id: qrKey(token), owner: userId, issuedAt },
                ConditionExpression: "attribute_not_exists(id)",
            },
        },
        previous
            ? {
                Put: {
                    TableName: PHOTOS_TABLE,
                    Item: { id: qrOfKey(userId), token, issuedAt },
                    ConditionExpression: "#t = :prev",
                    ExpressionAttributeNames: { "#t": "token" },
                    ExpressionAttributeValues: { ":prev": previous },
                },
            }
            : {
                Put: {
                    TableName: PHOTOS_TABLE,
                    Item: { id: qrOfKey(userId), token, issuedAt },
                    ConditionExpression: "attribute_not_exists(id)",
                },
            },
    ];
    if (previous) items.push({ Delete: { TableName: PHOTOS_TABLE, Key: { id: qrKey(previous) } } });
    await ddb.send(new TransactWriteCommand({ TransactItems: items }));
    return { token, issuedAt };
}

/**
 * `GET /user/qr`（ログイン）。今の合図を返す。まだ無ければ作る（初めての QR はそのまま使える・何も設定しない）。
 * 作るのは書き込みなので、退会した本人のトークンは通さない（`liveCaller.ts`）
 */
export const getMyQr: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const gone = await assertLiveCaller(userId);
    if (gone) return gone;

    const current = await readCurrent(userId);
    if (current) return ok(current);
    try {
        return ok(await writeNew(userId, null));
    } catch (e) {
        if (!isCancelled(e)) throw e;
        // 同時に開いた別の画面が先に作った。それを返す
        const raced = await readCurrent(userId);
        if (raced) return ok(raced);
        return jsonError(409, "QR コードを作れませんでした。もう一度お試しください");
    }
};

/**
 * `POST /user/qr/rotate`（ログイン）。新しい合図にして、前の QR とリンクをすぐ使えなくする
 */
export const rotateMyQr: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const gone = await assertLiveCaller(userId);
    if (gone) return gone;

    const current = await readCurrent(userId);
    try {
        return ok(await writeNew(userId, current?.token ?? null));
    } catch (e) {
        if (!isCancelled(e)) throw e;
        // 別の画面がちょうど更新した。前の合図はもう消えているので、押し直せば新しくなる
        return jsonError(409, "QR コードを更新できませんでした。もう一度お試しください");
    }
};

/**
 * `GET /qr/{token}`（ログイン不要・読み取り専用の役割）。使える合図なら人の ID を返し、使えなければ 404。
 * 引くのは `qr#<合図>` の GetItem 1回だけ（索引も他の行も読まない）
 */
export const resolveQr: APIGatewayProxyHandlerV2 = async (event) => {
    const token = event.pathParameters?.token;
    if (!isValidQrToken(token)) return jsonError(404, QR_UNUSABLE_MESSAGE);
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: qrKey(token) } }));
    const owner = (res.Item as { owner?: unknown } | undefined)?.owner;
    if (typeof owner !== "string" || owner.length === 0) return jsonError(404, QR_UNUSABLE_MESSAGE);
    return ok({ userId: owner });
};
