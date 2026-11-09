import { readUserList } from "./userList";
import { closeFriendsId, isUserId } from "./closeFriends";

/**
 * ストーリーの**見せる範囲（`audience`）**。2026-11-09・owner 承認（札 #505）。
 *
 *     everyone      既定。**行に書かない**（これまでの行と1バイトも変わらない）
 *     closeFriends  投稿者の「親しい友達」だけ
 *
 * ## 「全員」は今も「フォロワーだけ」
 *
 * `storyVisibility.ts` の節のとおり、ストーリーは**常にフォロワーだけ**が見る。
 * `audience` はその**上に重ねて狭める**もの——親しい友達でも**フォローしていなければ
 * 見えない**（フォローの門は消さない。`closeFriends` を足すだけで門が1つ増える形）。
 * 親しい友達の名簿は「誰でも入れられる」（フォロワーに限らない）ので、
 * 名簿に居ても追っていない人には出ない、が正しい。
 *
 * ## 門は6つ、全部がこの1本を通る
 *
 *   `getStories` / `viewStory` / `postStoryReply` / `voteStory` /
 *   `answerStory`（質問の答え）/ ハイライト（`getHighlight`・`getUserHighlights`）
 *
 * 値の読み方は `storyAudienceOf` の1か所、判定は `canViewStoryAudience` /
 * `closeFriendOwnersAmong` の2つだけ。**門ごとに規則を書かない**
 * （`__tests__/storyAudience.test.ts` が6つ全部を見張る）。
 *
 * ## 読めなければ見せない
 *
 * 名簿を読めなかったときは**見せない**（倒し方を間違えると、投稿者が
 * 見せないと決めた相手に中身が出る。取り返せない側を選ばない）。
 * 知らない `audience` の値（将来足す値・壊れた値）も**狭い側**（親しい友達）に読む。
 */

export type StoryAudience = "everyone" | "closeFriends";

/** 受け取った値の検査。**知らない値は断る**（黙って「全員」に化けさせない） */
export function parseStoryAudience(raw: unknown): { ok: true; audience: StoryAudience } | { ok: false } {
    if (raw === undefined || raw === null) return { ok: true, audience: "everyone" };
    if (raw === "everyone" || raw === "closeFriends") return { ok: true, audience: raw };
    return { ok: false };
}

/**
 * 行の `audience` を読む。**無い・`"everyone"` だけが全員向け**で、
 * それ以外（知らない値）は親しい友達として扱う（狭い側に倒す）。
 */
export function storyAudienceOf(row: { audience?: unknown } | undefined): StoryAudience {
    const a = row?.audience;
    return a === undefined || a === null || a === "everyone" ? "everyone" : "closeFriends";
}

/** その行は親しい友達だけに見せるものか */
export const isCloseFriendsStory = (row: { audience?: unknown } | undefined): boolean =>
    storyAudienceOf(row) === "closeFriends";

/** 投稿者の名簿に `viewerId` が居るか。**読めなければ false**（見せない側に倒す） */
async function isCloseFriendOf(ownerId: string, viewerId: string): Promise<boolean> {
    try {
        const list = await readUserList(closeFriendsId(ownerId), isUserId, `closefriends#${ownerId}`);
        return list.includes(viewerId);
    } catch (e) {
        console.error(`isCloseFriendOf: 親しい友達を確かめられませんでした（${ownerId}）:`, e);
        return false;
    }
}

/**
 * `viewerId` がこのストーリーを**見せる範囲の面で**見てよいか
 * （フォロー・ブロック・期限は呼び出し側の門が見る。ここは `audience` だけ）。
 *
 * 本人は常に true。全員向けは名簿を読まない（往復が増えない）。
 */
export async function canViewStoryAudience(
    row: { audience?: unknown; userId?: unknown; uploadedBy?: unknown },
    viewerId: string,
): Promise<boolean> {
    const ownerId = String(row.userId ?? row.uploadedBy ?? "");
    if (ownerId === viewerId) return true;
    if (!isCloseFriendsStory(row)) return true;
    return isCloseFriendOf(ownerId, viewerId);
}

/**
 * 一覧用。`owners` のうち、`viewerId` を**親しい友達に入れている人**の集合
 * （投稿者ごとに名簿を1回だけ読む）。読めなかった人は入れない。
 */
export async function closeFriendOwnersAmong(viewerId: string, owners: Iterable<string>): Promise<Set<string>> {
    const found = new Set<string>();
    await Promise.all([...new Set(owners)].map(async (owner) => {
        if (await isCloseFriendOf(owner, viewerId)) found.add(owner);
    }));
    return found;
}
