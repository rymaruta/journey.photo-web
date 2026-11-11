/**
 * **コメントの返信を、相手のコメントのすぐ下に1段下げて並べる**（2026-11-11・journey.photo-ios#541 の ②）。
 *
 * 一覧は新しい順（サーバーの並びの逆・`useComments`）。返信（`replyTo` を持つ1件）は、
 * 相手のコメントが一覧に在ればその下へ**古い順**で寄せる（会話として上から読めるように）。
 * 相手が一覧に無い（消された・200件の輪から落ちた）返信は、その場に1段下げずに残す。
 * 返信への返信も、相手が返信なら**同じ親の下**に並べる（段は1つだけ・iOS の `CommentThreads` と同じ）。
 */
export type ThreadedComment<T> = { comment: T; isReply: boolean };

type Threadable = { id: string; replyTo?: { id: string } | null };

export function threadComments<T extends Threadable>(items: readonly T[]): ThreadedComment<T>[] {
    const byId = new Map(items.map((c) => [c.id, c]));
    /** 返信の大元（1段目のコメント）。輪になった・相手が無いときは undefined */
    const rootOf = (c: T): string | undefined => {
        const seen = new Set<string>();
        let cur: T | undefined = c;
        while (cur?.replyTo?.id && !seen.has(cur.id)) {
            seen.add(cur.id);
            const parent = byId.get(cur.replyTo.id);
            if (!parent) return undefined;
            if (!parent.replyTo?.id) return parent.id;
            cur = parent;
        }
        return undefined;
    };
    const children = new Map<string, T[]>();
    const placed = new Set<string>();
    for (const c of items) {
        const root = rootOf(c);
        if (root === undefined) continue;
        const list = children.get(root) ?? [];
        list.push(c);
        children.set(root, list);
        placed.add(c.id);
    }
    const out: ThreadedComment<T>[] = [];
    for (const c of items) {
        if (placed.has(c.id)) continue;
        out.push({ comment: c, isReply: false });
        // 一覧は新しい順なので、返信は逆にして古い順に
        for (const r of [...(children.get(c.id) ?? [])].reverse()) out.push({ comment: r, isReply: true });
    }
    return out;
}
