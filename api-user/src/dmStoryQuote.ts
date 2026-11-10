import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { isFollowing } from "./followCheck";
import { canViewStoryAudience } from "./storyAudience";
import { isStoryExpired } from "./storyExpiry";

/**
 * DM の会話に出す「ストーリーへの返信」の引用札（2026-11-10 判断・iOS の DM 画面の
 * 「サムネイル・タップで見る・終了しました」のため）。`GET /dm/{id}` が、`storyId` を持つ通にだけ付ける。
 *
 *     { id, state: "live", mediaType: "image", src, expiresAt }   見られる・写真
 *     { id, state: "live", mediaType: "video", expiresAt }        見られる・動画（絵は返さない）
 *     { id, state: "ended" }                                      見られない
 *
 * ## 絵を返す門は `getStories` と同じ
 *
 * 画像の URL は**ストーリーの一覧（`getStories`）が同じ人に返すもの**と同じ `src`（CloudFront の
 * 公開 URL。署名つき URL ではない）。**一覧がその人に返さない間は返さない**——門を1つでも
 * 緩めると、DM が「見せない相手にストーリーの中身を渡す2本目の口」になる:
 *
 *   - 期限切れ・棚へ移った（`archivedAt`）・行が無い（消した・退会で消えた）→ `ended`
 *   - 見る人が投稿者本人 → `live`
 *   - それ以外は、投稿者を**いまも**フォローしている（マーカー `isFollowing`）、かつ
 *     見せる範囲（親しい友達だけ・`canViewStoryAudience`）を通るときだけ `live`。
 *     **外れたら `ended`**（「まだ在るが、あなたには見せない」を区別して出さない——
 *     `getStories` が 404 と同じく、外された事実を教えない）
 *   - ブロックは呼ぶ側（`getConversation`）が会話ごと 404 にしている（両向き）
 *   - 投稿者が会話の2人のどちらでもない行は `ended`（`storyId` はサーバーが書く値だが、念のため）
 *   - **読めなかったら `ended`**（見せない側に倒す。フォローの門と同じ）
 *
 * **動画は絵を返さない**（ストーリーの行に止め絵・縮小版が無い。動画の URL をサムネイルの欄に
 * 入れると、画面が動画を丸ごと読みに行く）。**縮小版は無い**——写真も一覧と同じ原寸の `src`。
 * 時刻が過ぎたら画面の側で `ended` に倒せるよう `expiresAt` を添える（`since` の読み直しでは
 * 古い通を送り直さないため、札の状態はサーバーからは更新されない）。
 */

export type StoryQuote =
    | { id: string; state: "live"; mediaType: "image" | "video"; src?: string; expiresAt?: string }
    | { id: string; state: "ended" };

type StoryRow = {
    id?: unknown; story?: unknown; userId?: unknown; uploadedBy?: unknown; src?: unknown;
    mediaType?: unknown; expiresAt?: unknown; archivedAt?: unknown; audience?: unknown;
};

const ended = (id: string): StoryQuote => ({ id, state: "ended" });
/** 1回の会話の読みで引くストーリーの数の上限（返す通に出てくる別々のストーリーの数） */
export const QUOTE_LOOKUP_MAX = 20;
const errName = (e: unknown) => (e as { name?: string })?.name ?? "Error";

/**
 * `viewer` から見た引用札を、ストーリー ID ごとに返す。`participants` は会話の2人。
 * **投げない**（読めなければ全部 `ended`）。上限を越えた古いストーリーは Map に入れない（札なし）。
 */
export async function storyQuotesFor(
    viewer: string,
    participants: readonly [string, string],
    storyIds: readonly string[],
): Promise<Map<string, StoryQuote>> {
    const out = new Map<string, StoryQuote>();
    const uniq = [...new Set(storyIds.filter((s) => typeof s === "string" && s.length > 0))];
    if (uniq.length === 0) return out;
    for (const id of uniq) out.set(id, ended(id));

    // **1件ずつの GetItem**（並べて投げる）。photos の表に `BatchGetItem` の権限は無い
    // （serverless.yml の provider の役割。権限は足さない・2026-11-10 判断）。
    // 1回に引くのは新しい方から `QUOTE_LOOKUP_MAX` 件まで。越えた古い通は札を付けない（欄なし＝分からない）
    const targets = uniq.slice(-QUOTE_LOOKUP_MAX);
    for (const id of uniq.slice(0, uniq.length - targets.length)) out.delete(id);
    const rows = new Map<string, StoryRow>();
    try {
        await Promise.all(targets.map(async (id) => {
            const res = await ddb.send(new GetCommand({
                TableName: PHOTOS_TABLE,
                Key: { id },
                ProjectionExpression: "#id, #story, #uid, #up, #src, #mt, #exp, #arc, #aud",
                ExpressionAttributeNames: {
                    "#id": "id", "#story": "story", "#uid": "userId", "#up": "uploadedBy", "#src": "src",
                    "#mt": "mediaType", "#exp": "expiresAt", "#arc": "archivedAt", "#aud": "audience",
                },
            }));
            if (res.Item) rows.set(id, res.Item as StoryRow);
        }));
    } catch (e) {
        console.error("storyQuotesFor: ストーリーを読めませんでした:", errName(e));
        return out;
    }

    // フォローの門は投稿者ごとに1回（会話の相手1人しか居ないので、ふつうは1回で済む）
    const followCache = new Map<string, Promise<boolean>>();
    const follows = (owner: string) => {
        let p = followCache.get(owner);
        if (!p) {
            p = isFollowing(owner, viewer).catch((e) => {
                console.error("storyQuotesFor: フォローを確かめられませんでした:", errName(e));
                return false;
            });
            followCache.set(owner, p);
        }
        return p;
    };

    await Promise.all(targets.map(async (id) => {
        const row = rows.get(id);
        if (!row || row.story !== true) return;
        if (isStoryExpired(row) || row.archivedAt !== undefined) return;
        const owner = String(row.userId ?? row.uploadedBy ?? "");
        if (!owner || !participants.includes(owner)) return;
        if (owner !== viewer) {
            if (!await follows(owner)) return;
            if (!await canViewStoryAudience(row, viewer)) return;
        }
        const mediaType = row.mediaType === "video" ? "video" : "image";
        const src = mediaType === "image" && typeof row.src === "string" && row.src ? row.src : undefined;
        out.set(id, {
            id, state: "live", mediaType,
            ...(src ? { src } : {}),
            ...(typeof row.expiresAt === "string" && row.expiresAt ? { expiresAt: row.expiresAt } : {}),
        });
    }));
    return out;
}
