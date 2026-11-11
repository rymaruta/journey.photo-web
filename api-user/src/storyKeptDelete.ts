import { GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { s3DeleteMany } from "./s3Delete";
import { sweepStoryVotes } from "./storyVotes";
import { isStoryExpired } from "./storyExpiry";
import { storyOwnMediaKeys, sharesKeptMedia } from "./storyKeptMedia";

/**
 * 写真を消すときに、**そこから作った元のストーリー**をどうするか（`DELETE /photos/{id}?withStory=`）。
 *
 * 2026-11-11 判断（owner「ストーリーとそこから作った写真の関係を明確にして」）:
 * 画面は消す確認で「ストーリーも一緒に消す」「写真だけ消す」を選ばせる（既定の選び方は無し）。
 * ストーリーの側から「写真も一緒に消す」を選んだときも、**この口に `withStory=1` で来る**——
 * 写真を消すには再ビルドの依頼まで要り、その書き込みの鍵はこの関数にしか配っていない
 * （`stories.ts` に配ると6つの口全部に渡る・IAM-2）。だから「一緒に消す」は写真の口に1本にした。
 *
 *   withStory=1   一緒に消す
 *   withStory=0   写真だけ消す（ストーリーは残す）
 *   指定なし      **古いアプリ**。今までの動きのまま: 画像を共有している（`keptFrom`）なら一緒に消える、
 *                 写した（`fromStory`）なら写真だけ。古いアプリの確認は「写真を削除」の1つだけで、
 *                 共有している画像を写真だけ消すとストーリーが割れる作りだったので、黙って変えない
 *                 （2026-11-11 判断: 古いアプリ相手には今の動きを変えない）
 */
export type WithStory = "together" | "photoOnly" | "legacy";

export function parseWithStory(raw: unknown): WithStory {
    if (raw === "1" || raw === "true") return "together";
    if (raw === "0" || raw === "false") return "photoOnly";
    return "legacy";
}

/** ストーリーの行を読む（ストーリーでなければ undefined） */
export async function readStoryRow(storyId: string): Promise<Record<string, unknown> | undefined> {
    const r = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
    const item = r.Item as Record<string, unknown> | undefined;
    return item && item.story === true ? item : undefined;
}

/**
 * 「写真だけ消す」で、**共有している画像をストーリーに渡せるか**。
 * 渡せるのは、ストーリーがまだ生きていて、この写真を指している（`keptAs`）ときだけ。
 * 期限が切れた行（掃除の手前）には渡さない——掃除が古い読み取りで画像を残すと置き去りになる
 */
export function canHandOver(story: Record<string, unknown> | undefined, photoId: string): story is Record<string, unknown> {
    return !!story && story.keptAs === photoId && !isStoryExpired(story);
}

/**
 * ストーリーの「写真にした」印を外す（写真だけ消したとき）。**この写真を指しているときだけ**。
 * 外すと、ストーリーの画像は掃除・削除で普通に消える（`storyMediaKeys`）。もう一度写真にもできる。
 * 返り値: true＝外した／false＝行が無い・別の写真を指している（条件が外れた）
 */
export async function unmarkKept(storyId: string, photoId: string): Promise<boolean> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: storyId },
            UpdateExpression: "REMOVE keptAs, keptCopy",
            ConditionExpression: "keptAs = :p",
            ExpressionAttributeValues: { ":p": photoId },
        }));
        return true;
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
        throw e;
    }
}

/**
 * 元のストーリーを丸ごと消す（「一緒に消す」）。画像 → 返信 → 票 → 行 の順（`deleteStory` と同じ）。
 * **画像を消せなければ行を残して false**（行は画像の鍵の唯一の手がかり）。
 * 共有の画像（`keptAs` が別の写真を指して共有中）は消さない——その写真が持ち主
 */
export async function deleteStoryTogether(story: Record<string, unknown>, logPrefix: string): Promise<boolean> {
    const storyId = String(story.id ?? "");
    if (!storyId) return true;
    const keys = sharesKeptMedia(story) ? [] : storyOwnMediaKeys(story);
    if (await s3DeleteMany(keys, logPrefix) > 0) return false;
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: `storyreplies#${storyId}` } }));
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: `storyvotes#${storyId}` } }));
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
    await sweepStoryVotes(storyId);
    return true;
}
