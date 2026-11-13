import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { deletedAmong, withUnreadAsDeleted } from "./notify";
import { isRestrictedRow } from "./sanitize";

/**
 * **写真をストーリーで紹介する**（2026-11-11 owner 承認・journey.photo-ios#541 の ①）。
 *
 * 写真の詳細の「共有」→「ストーリーに載せる」で、写真を札にした1枚（絵は端末で作る）を
 * ふつうのストーリーとして出し、行に**紹介した写真の id（`sharedPhotoId`）だけ**を足す。
 * 見る人は「写真を見る」で写真の詳細へ行ける。新しい表・GSI は作らない（承認の範囲）。
 *
 * ## 紹介できる写真（2026-11-12 判断・owner の原則）
 *
 *   - **自分の写真だけ。** 人の写真は 403「この写真はストーリーで紹介できません」で断る。
 *     owner（2026-11-12）:「保存して勝手に使われるのを防ぐため。基本的にその人のものなので、
 *     他人が自由に操作するのは絶対ダメ」——人の写真を自分のストーリーとして載せ直すことはこれに当たる。
 *     1.1.82 のアプリは人の写真でも「ストーリーに載せる」を出すので、サーバーで断る（古いアプリは
 *     この文をそのまま出す）。持ち主へ人を連れて行く道（リンクの共有・DM での引用）はこの口ではない
 *   - **全体に公開した写真だけ**（`audience` が無い）。自分の写真でも、フォロワー限定・
 *     親しい友達の写真は紹介できない。ストーリーを見る人（自分のフォロワー）と、写真を
 *     見てよい人（自分が写真に決めた範囲）は別の集合で、紹介が範囲の外へ写真を配る口になるため
 *   - 下書き（`published === false`）・ストーリーの行・画像の無い行は断る（「無い」と同じ 404。
 *     人の下書きの有無を 403 で教えない——人の写真で 403 になるのは、公開の写真のときだけ）
 *   - （2026-11-11 の版は人の写真を通していたので、ブロック・退会・「検索に出さない」を見ていた。
 *     持ち主は呼び手本人で、退会した本人は `readLiveCaller` が先に断るので、もう要らない）
 *
 * ## 出したあと（`getStories`）
 *
 * **持ち主でない人が紹介した行**（2026-11-11〜12 の版で作られたもの）は、紹介した本人以外には
 * 出さない（2026-11-12 判断。本番では 2026-11-12 に読んだ時点で0件——直しを出すまでの間に
 * 作られた分も、24時間を待たずに見る側から消える）。
 *
 * 紹介した写真が**あとで見られなくなったら**（持ち主が非公開・範囲を絞った・消した・退会した・
 * 見る人と持ち主のあいだにブロックができた）、そのストーリーは**紹介した本人以外には出さない**
 * ——ストーリーの絵そのものに写真が写っているので、札の行き先だけ消しても写真は配られ続ける。
 * 本人には残す（自分の投稿が黙って消えると分からない）が、`sharedPhotoId` は落とす
 * （押しても写真は開けない）。**写真を読めなかったら見られない側に倒す**（取り返せない側を選ばない）。
 *
 * ## 残さない
 *
 * 紹介のストーリーは**24時間で消えるだけ**——棚（`archive`）にも、ギャラリー（`keepStory`）にも
 * 残さない。残すと持ち主の公開範囲・削除が効かない人の写真の写しになる（`createStory` は
 * `archive` を書かず、`keepStory` は 409 で断る）。
 *
 * ## 古いアプリ
 *
 * 欄を知らない古いアプリ・Web は `sharedPhotoId` を読まないので、ふつうの写真のストーリーとして
 * 見える（札の絵は写っている）。送る側は欄を送らないので、今までの投稿は何も変わらない。
 */

/** 写真の id の形（`upload.ts` は uuid。`#` を含む行の id ＝コメントや通知の文書は通さない） */
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export type SharedPhotoParse = { ok: true; photoId?: string } | { ok: false };

/** 受け取った欄を読む。**無い（undefined / null / 空）は「紹介ではない」**。形の違う値は断る */
export function parseSharedPhotoId(v: unknown): SharedPhotoParse {
    if (v === undefined || v === null || v === "") return { ok: true };
    if (typeof v !== "string" || !PHOTO_ID_RE.test(v) || v.startsWith("story-")) return { ok: false };
    return { ok: true, photoId: v };
}

type PhotoRow = {
    src?: unknown; thumbSrc?: unknown; userId?: unknown; uploadedBy?: unknown;
    published?: unknown; story?: unknown; audience?: unknown; location?: unknown;
};

/** 写真の行が「全体に公開した、生きた写真」か（人との関係は見ない） */
export function isShareablePhotoRow(photo: PhotoRow | undefined): boolean {
    if (!photo || typeof photo.src !== "string" || !photo.src) return false;
    if (photo.published === false || photo.story === true) return false;
    if (isRestrictedRow(photo)) return false;
    return ownerOf(photo) !== undefined;
}

function ownerOf(photo: PhotoRow): string | undefined {
    const raw = photo.userId ?? photo.uploadedBy;
    return typeof raw === "string" && raw ? raw : undefined;
}

async function readPhoto(photoId: string): Promise<PhotoRow | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
    return res.Item as PhotoRow | undefined;
}

export type SharedPhoto = { photoId: string; ownerId: string; thumb: string; location?: string };

/** 人の写真を紹介しようとしたときの答え（403 の文・2026-11-12） */
export const NOT_OWN_PHOTO_MESSAGE = "この写真はストーリーで紹介できません";

/**
 * `callerId` がこの写真を紹介してよいか。よければ知らせに要るもの（持ち主・小さい絵・撮影地）を返す。
 * 無い・公開でない写真は undefined（呼び手は「写真が見つかりません」の 404）、
 * **人の公開写真は `"notOwner"`**（呼び手は 403 `NOT_OWN_PHOTO_MESSAGE`）。読めなかったときは投げる
 */
export async function checkSharedPhoto(photoId: string, callerId: string): Promise<SharedPhoto | "notOwner" | undefined> {
    const photo = await readPhoto(photoId);
    if (!photo || !isShareablePhotoRow(photo)) return undefined;
    const ownerId = ownerOf(photo)!;
    if (ownerId !== callerId) return "notOwner";
    return {
        photoId,
        ownerId,
        thumb: String(photo.thumbSrc ?? photo.src),
        ...(typeof photo.location === "string" && photo.location ? { location: photo.location } : {}),
    };
}

/** 紹介の行の書き手（ストーリーを出した人） */
function authorOf(row: Record<string, unknown>): string {
    return String(row.userId ?? row.uploadedBy ?? "");
}

/**
 * 紹介の行のうち、`viewerId` に**もう見せない**ものを答える（`has(row)`）。
 *
 *   - 紹介した写真が見られない（無い・公開でない・持ち主が退会・見る人とのあいだにブロック）
 *   - **紹介した人が写真の持ち主でない**（2026-11-12・人の写真の紹介は止めた。止める前に作られた行）
 *
 * 2つ目は行ごとに決まる（同じ写真を持ち主と人の両方が紹介していることがある）ので、写真の id の
 * 集合ではなく行で答える。`hidden` は見る人のブロックの集合（`hiddenUserIds`・両向き）。写真は
 * id ごとに1回だけ読む。読めなかった写真は「見せない」に入れる。`any` が false なら1行も落とさない
 */
export type SharedLoss = { readonly any: boolean; has(row: Record<string, unknown>): boolean };

export async function unviewableSharedPhotos(
    items: readonly Record<string, unknown>[], hidden: ReadonlySet<string>,
): Promise<SharedLoss> {
    const sharedOf = (row: Record<string, unknown>) =>
        typeof row.sharedPhotoId === "string" && row.sharedPhotoId.length > 0 ? row.sharedPhotoId : undefined;
    const ids = [...new Set(items.map(sharedOf).filter((v): v is string => v !== undefined))];
    const bad = new Set<string>();
    const owners = new Map<string, string>();
    if (ids.length === 0) return { any: false, has: () => false };
    await Promise.all(ids.map(async (id) => {
        try {
            const photo = await readPhoto(id);
            if (!photo || !isShareablePhotoRow(photo)) { bad.add(id); return; }
            const owner = ownerOf(photo)!;
            if (hidden.has(owner)) { bad.add(id); return; }
            owners.set(id, owner);
        } catch (e) {
            console.error(`unviewableSharedPhotos: 写真を読めませんでした（${id}）:`, e);
            bad.add(id);
        }
    }));
    if (owners.size > 0) {
        const gone = withUnreadAsDeleted(await deletedAmong([...owners.values()]));
        for (const [id, owner] of owners) if (gone.has(owner)) bad.add(id);
    }
    const has = (row: Record<string, unknown>): boolean => {
        const id = sharedOf(row);
        if (id === undefined) return false;
        if (bad.has(id)) return true;
        return owners.get(id) !== authorOf(row);
    };
    return { any: items.some(has), has };
}
