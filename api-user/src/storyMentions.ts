import { isBlocked } from "./blockCheck";
import { isFollowing } from "./followCheck";
import { deletedAmong, lookupDisplayName, withUnreadAsDeleted, DELETED_USER_NAME } from "./notify";
import { canViewStoryAudience, type StoryAudience } from "./storyAudience";
import { isStoryMention, type StoryText } from "./storyText";

/**
 * ストーリーのメンション（@ユーザー）を、投稿のときに**サーバーが解く**。
 * 札 #505・2026-11-09。
 *
 * `sanitizeStoryTexts` は形だけ見る（同期・純粋で、クライアントに写しがある）。
 * 関係（フォロー・ブロック・名簿）と名前は読み取りが要るので、ここで見る。
 *
 * ## 残す人 = **そのストーリーを見られる人だけ**（2026-11-09 判断）
 *
 * 次の全部を満たす人だけ残し、**そうでないものは落とす**（札も通知も出さない）:
 *
 *   - 投稿者本人ではない
 *   - 投稿者をフォローしている（ストーリーの門と同じ。`isFollowing` のマーカー）
 *   - **どちら向きにもブロックが無い**（`getStories` の `hiddenUserIds` と同じ両向き。
 *     ブロックした相手・された相手を写真の上でタグ付けして通知を撃てない）
 *   - 「親しい友達だけ」の投稿なら、名簿に居る（`canViewStoryAudience`）
 *   - 退会していない
 *
 * 見られない人を残さない理由: 通知を押しても 404 になる（押した人には
 * 何が起きたか分からない）うえ、**親しい友達だけの投稿に、名簿に居ない人の
 * 名前を載せて通知が飛ぶ**と、その投稿が在ること自体が漏れる。
 * 「誰でもメンションできる」（Instagram）にしたいときは、owner が決める
 * ——その場合も `canViewStoryAudience` と退会・ブロックの3つは外せない。
 *
 * **判定を読めなかった人は落とす**（`canViewStoryAudience` と同じ向き）。
 * 名前は**サーバーが引く**（申告を信用しない）。
 */
export async function resolveStoryMentions(
    ownerId: string,
    audience: StoryAudience,
    texts: StoryText[] | undefined,
): Promise<{ texts: StoryText[] | undefined; recipients: string[] }> {
    if (!texts || !texts.some(isStoryMention)) return { texts, recipients: [] };

    const candidates = [...new Set(texts.filter(isStoryMention).map((m) => m.userId))].filter((id) => id !== ownerId);
    const allowed = new Set<string>();
    await Promise.all(candidates.map(async (id) => {
        try {
            if (!await isFollowing(ownerId, id)) return;
            const [blockedByOwner, blockedByThem] = await Promise.all([isBlocked(ownerId, id), isBlocked(id, ownerId)]);
            if (blockedByOwner || blockedByThem) return;
            if (!await canViewStoryAudience({ audience: audience === "closeFriends" ? "closeFriends" : undefined, userId: ownerId }, id)) return;
            allowed.add(id);
        } catch (e) {
            console.error(`resolveStoryMentions: 確かめられませんでした（${id}）:`, e);
        }
    }));

    // 退会した人・読めなかった人は落とす（名前を写して持つ口なので伏せる側に倒す）
    const gone = allowed.size === 0 ? new Set<string>() : withUnreadAsDeleted(await deletedAmong(allowed));
    const ok = new Set([...allowed].filter((id) => !gone.has(id)));

    const names = new Map<string, string>();
    await Promise.all([...ok].map(async (id) => { names.set(id, await lookupDisplayName(id)); }));

    const kept = texts.flatMap((t): StoryText[] => {
        if (!isStoryMention(t)) return [t];
        if (!ok.has(t.userId)) return [];
        // **名前は引いたものだけ**（申告は `sanitizeStoryTexts` が既に落としている）
        return [{ ...t, name: names.get(t.userId) ?? "" }];
    });
    return { texts: kept.length > 0 ? kept : undefined, recipients: [...ok] };
}

/**
 * **読むとき、退会した人のメンションの名前を伏せる**（札 #505 レビュー）。
 * 名前は投稿のときに写して持つので、退会（`account.ts`）では消えない。ストーリーは
 * 24時間（アーカイブ・ハイライトは期限なし）残るため、読む側で墓石を見て
 * 「退会したユーザー」に置き換える（コメントの `deletedAmong` と同じ向き。
 * **読めなかった人も伏せる**）。`userId` は残す（札は残り、名前だけ消える）。
 * 行を引数の中で書き換える（Dynamo から読んだ複製を渡すこと）。
 */
export async function maskDeletedMentions(rows: Record<string, unknown>[]): Promise<void> {
    const ids = new Set<string>();
    for (const r of rows) {
        if (!Array.isArray(r.texts)) continue;
        for (const t of r.texts as StoryText[]) if (t && typeof t === "object" && isStoryMention(t)) ids.add(t.userId);
    }
    if (ids.size === 0) return;
    const gone = withUnreadAsDeleted(await deletedAmong(ids));
    if (gone.size === 0) return;
    for (const r of rows) {
        if (!Array.isArray(r.texts)) continue;
        r.texts = (r.texts as StoryText[]).map((t) =>
            t && typeof t === "object" && isStoryMention(t) && gone.has(t.userId) ? { ...t, name: DELETED_USER_NAME } : t);
    }
}
