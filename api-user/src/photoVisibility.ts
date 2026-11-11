import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { canViewPhoto } from "./restrictedFeed";
import { isBlocked } from "./blockCheck";
import { isRestrictedRow } from "./sanitize";

/**
 * 写真の行（判定に要る欄と、呼ぶ側が使う欄）。`readVisiblePhoto` が返す
 */
export type VisiblePhotoRow = {
    id?: unknown; src?: unknown; thumbSrc?: unknown; published?: unknown; story?: unknown;
    userId?: unknown; uploadedBy?: unknown; audience?: unknown; title?: unknown; location?: unknown;
};

/**
 * その写真が**今このサイトに出ていて、この人に見せてよいか**を確かめ、見せてよければ行を返す。
 *
 * 判定は保存（`saves.ts`）から移した1か所（2026-11-11 判断・DM で写真を送る口と同じ門にするため。写しを作らない）:
 *
 *   - `src` が無い（内部の文書）・`published === false`（下書き・非公開）・ストーリーは見せない
 *     （`published` が無い古い行は公開扱い・`likes.ts` の `readLikeCount` と同じ）
 *   - 公開範囲を絞った写真は `canViewPhoto`（一覧 `/feed/restricted` と同じ・ブロックも見る）
 *   - 🔴 公開の写真も、持ち主にブロックされた人には見せない（2026-10-03・`canViewPhoto` は公開の写真では
 *     ブロックを見ずに通すので、ここで見る）。所有者は `userId ?? uploadedBy`
 *
 * 投げる（読めなかったら呼ぶ側が決める）。
 */
export async function readVisiblePhoto(photoId: string, viewerId: string): Promise<VisiblePhotoRow | null> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        ProjectionExpression: "#id, src, thumbSrc, published, story, userId, uploadedBy, audience, title, #loc",
        ExpressionAttributeNames: { "#id": "id", "#loc": "location" },
    }));
    const item = res.Item as VisiblePhotoRow | undefined;
    if (!item?.src || item.published === false || item.story === true) return null;
    if (isRestrictedRow(item)) return await canViewPhoto(item, viewerId) ? item : null;
    const ownerRaw = item.userId ?? item.uploadedBy;
    const owner = typeof ownerRaw === "string" ? ownerRaw : undefined;
    if (owner && owner !== viewerId && await isBlocked(owner, viewerId)) return null;
    return item;
}

/** 写真の ID として受ける形（`saves.ts`・`likes.ts` と同じ: 1〜128 字・行の種類の区切り `#` を含まない） */
export const isPhotoId = (x: unknown): x is string =>
    typeof x === "string" && x.length > 0 && x.length <= 128 && !x.includes("#");
