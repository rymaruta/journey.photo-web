import {
    ScanCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import type { Photo } from "./types";
import { requireEnv } from "./env";
import { PUBLIC_INDEX, PUBLIC_FEED_KEY } from "./publicFeed";

const TABLE = requireEnv("PHOTOS_TABLE");
const USER_INDEX = "userId-createdAt-index";

/**
 * 公開一覧（`GET /photos`・ログインなしで呼べる）。**公開一覧の索引を Query で読む**（2026-11-25・AWS の見直し 2）。
 *
 * もとは呼ばれるたびに**表の全部を Scan** していた。表にはいいね・フォローの印、コメント、通知、
 * ストーリーまで同居しているので、読む量（費用と時間）は写真の数ではなく表の行の数で増え、
 * ログインなしで何度でも呼べた。
 *
 * 今は `publicFeed-createdAt-index` の仕切り `"1"`（公開中の写真だけ）を、`createdAt` の新しい順に読む。
 * 索引は本番・staging ともに在る（`GET /feed` が同じ索引を読んで動いている）。2026-11-25 に本番で、
 * Scan の `GET /photos` と索引の `GET /feed` が**同じ 60 件を同じ順**で返すことを確かめてから切り替えた。
 * 射影は ALL なので、行の中身は Scan と同じ。
 *
 * **絞り込みは Scan と同じ式をそのまま残す。** 索引の印（`publicFeed`）は行の写しなので、
 * 非公開・ストーリー・公開範囲と書き違えた行が残っても、ここで落とす（広くはならない）。
 * 並びも Scan のときと同じく、最後に `createdAt` の新しい順で並べ直す（同じ日時の行の順を変えない）。
 * `createdAt` を持たない写真は索引に載らない（埋め戻しの作業 `add-public-feed-index.js` が 0 件を確かめる）
 */
export async function listPhotos(): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: TABLE,
            IndexName: PUBLIC_INDEX,
            KeyConditionExpression: "publicFeed = :k",
            // 新しい順（並べ直しの前から同じ順で来る）
            ScanIndexForward: false,
            ExclusiveStartKey: lastKey,
            // 未公開写真を除外し、写真以外の管理レコードも除外する。
            // このテーブルには写真のほかに like#/go# マーカーや golist#/notifs# 文書が
            // 同居しており、それらには published が無いため published 条件だけでは素通りする。
            // 写真は必ず src を持つので attribute_exists(src) で写真だけに絞る。
            //
            // ストーリーも除く。ストーリーは src と userId を持ち published:false で
            // 保存されるので、何かの拍子に published:true になると
            // （実際に PUT /photos/{id} から書けた）そのまま公開一覧に出て、
            // photos.json に載り、静的ページとサイトマップの項目までできた。
            // 24時間後の掃除は実体しか消さないので、壊れたページが残る。
            // ハンドラ側でも弾いているが、ここでも保証する。
            // **公開範囲を絞った写真も出さない**（`audience` を持つ行）。
            // 2026-09-22 に PM が個別取得の穴を報告したが、**一覧はもっと軽い**
            // ——id すら要らずに全部返っていた。索引の側（`publicFeed`）では
            // 仕切ってあるが、印は行の写しなので、ここでも落とす。
            // **管理用の `listAllPhotosForAdmin` は別**（下書きと同じく見える側）
            FilterExpression: "(attribute_not_exists(published) OR published = :pub) AND attribute_exists(src) AND attribute_not_exists(story) AND attribute_not_exists(audience)",
            ExpressionAttributeValues: { ":k": PUBLIC_FEED_KEY, ":pub": true },
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * 下書き（published:false）も含めた全写真。管理画面専用。
 *
 * 公開APIは下書きを隠すため、管理画面が公開APIだけを見ていると
 * 「非公開にした瞬間に管理画面からも消えて、二度と戻せない」状態になっていた
 * （他人の写真を非公開にすると AWS コンソール以外に復旧手段が無かった）。
 * ストーリーは管理対象ではないので除く。
 */
export async function listAllPhotosForAdmin(): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            ExclusiveStartKey: lastKey,
            // published は見ない（下書きも欲しい）。写真以外のレコードだけ除く。
            FilterExpression: "attribute_exists(src) AND attribute_not_exists(story)",
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function getPhotoById(id: string): Promise<Photo | null> {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
    return (res.Item as Photo | undefined) ?? null;
}

export async function putPhoto(photo: Photo): Promise<void> {
    // 新規作成専用。条件を付けないと、同じIDの既存レコードを丸ごと置き換える。
    // このテーブルには通知（notifs#...）やコメント（comments#...）も同居しているので、
    // ID を指定できるだけで他人の通知を全部消せてしまう（元に戻せない）。
    // 更新は updatePhotoFields を使うこと。
    await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: photo,
        ConditionExpression: "attribute_not_exists(id)",
    }));
}

export async function updatePhotoFields(id: string, updates: Record<string, unknown>): Promise<Photo | null> {
    // undefined は「その項目を空にする」指定。SET に混ぜてはいけない。
    //
    // DocumentClient は removeUndefinedValues: true なので、
    // ExpressionAttributeValues から :location ごと落ちる。式には
    // `SET #location = :location` が残るため DynamoDB は ValidationException を
    // 返し、ハンドラは 500 になる——つまり /admin/edit で撮影地や説明を
    // 空にして保存すると、必ず「更新に失敗しました」になっていた。
    // ユーザーAPI側（api-user/src/photoUpdate.ts）は REMOVE を組み立てている。
    const sets: string[] = [];
    const removes: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
        names[`#${k}`] = k;
        if (v === undefined || v === null) {
            removes.push(`#${k}`);
        } else {
            sets.push(`#${k} = :${k}`);
            values[`:${k}`] = v;
        }
    }
    if (sets.length === 0 && removes.length === 0) return getPhotoById(id);
    let expr = sets.length ? `SET ${sets.join(", ")}` : "";
    if (removes.length) expr += `${expr ? " " : ""}REMOVE ${removes.join(", ")}`;
    const res = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ConditionExpression: "attribute_exists(id)",
        ReturnValues: "ALL_NEW",
    }));
    return (res.Attributes as Photo | undefined) ?? null;
}

/**
 * 写真そのものと、その写真にぶら下がる文書を消す。
 *
 * 以前は写真の item だけを消していた。コメントは写真ごとに
 * `comments#<photoId>` という別文書に溜まっており、そちらが残るので、
 * **写真を消してもコメント本文・投稿者名・投稿者IDが残る**。
 * 「不適切なコメントが付いたので写真を消してほしい」に応えられていない。
 *
 * **`comments#` は写真の行より先に消す。** 逆にすると、コメントの削除が
 * 一時的に失敗した回に**写真の行だけが消えて、コメント文書が永久に残る**
 * ——`comments#` は `src` も `userId` も持たないので GSI にも一覧にも出ず、
 * 退会の掃除（`userId` の GSI を回る）にも拾われない。押し直しても
 * `getPhotoById` が 404 を返すので**やり直す入口も消える**。
 * 消せなければ**投げて、行を残す**（押し直せば続きから消える）。
 *
 * **これは新しい判断ではない。** 利用者側の `deleteMyPhoto`
 * （`api-user/src/photoUpdate.ts`）と退会（`account.ts`）は、
 * どちらも**同じ順序・同じ倒し方**で、理由をコメントに書いてある
 * （「comments# は行より先に消す（逆だと再実行で拾う手がかりが無くなる）」）。
 * **管理者の削除だけがその逆を書いていた。**
 *
 * ⚠️ 以前ここに「一覧APIは公開で、写真の存在確認もしていない」と書いていたが
 * **もう事実ではない**——`api-user/src/comments.ts` の `getComments` は
 * 写真の実在・公開・ストーリーを見て 404 を返す。残ったコメントが
 * 誰かに読まれることは無く、実害は「消えない個人データがテーブルに残る」。
 *
 * いいねマーカー（like#<photoId>#<uid>）は per-photo に引く手段が無く、
 * 全件 Scan が要るので今回は対象外。中身を持たないので実害は軽い。
 */
export async function deletePhotoById(id: string): Promise<void> {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: `comments#${id}` } }));
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
}

export async function listPhotosByUser(userId: string): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :uid",
            // listPhotos と同じ条件。ストーリーもここから出さない
            FilterExpression: "(attribute_not_exists(published) OR published = :pub) AND attribute_exists(src) AND attribute_not_exists(story) AND attribute_not_exists(audience)",
            ExpressionAttributeValues: { ":uid": userId, ":pub": true },
            ExclusiveStartKey: lastKey,
        }));
            // **公開範囲を絞った写真も出さない。** `?userId=` は誰でも叩ける
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * ストーリーの「写真にした」印を外す（2026-11-11・`api-user/src/storyKeptDelete.ts` の `unmarkKept` と**対**）。
 * **この写真を指しているときだけ**（条件が外れたら何もしない＝行が無い・別の写真を指す）。
 * 管理者が写した写真（`fromStory`）を消したとき、ストーリーに死んだ id を残さない
 */
export async function unmarkKeptStory(storyId: string, photoId: string): Promise<void> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { id: storyId },
            UpdateExpression: "REMOVE keptAs, keptCopy",
            ConditionExpression: "keptAs = :p",
            ExpressionAttributeValues: { ":p": photoId },
        }));
    } catch (e) {
        if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
    }
}
