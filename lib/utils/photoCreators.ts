import type { Photo } from "@/lib/data/photos";

/** 写真を載せた人（プロフィールへのリンク用） */
export type PhotoCreator = { id: string; name: string };

/**
 * 一覧の写真を載せた人を、載せた枚数の多い順（同数なら先に出た順）に並べる。
 *
 * **2026-11-11 判断（journey.photo-ios#525）: 撮影スポットの頁から投稿者の
 * プロフィールへ、最初の HTML の `<a href>` で結ぶ。** それまでスポットの頁から
 * プロフィールへのリンクは0本（本番の `/spots/abukumado` を curl で確認）で、
 * 写真の頁を1段挟まないと届かなかった。クローラーが辿る道と、名前で探された
 * ときの頁の重みのため。
 *
 * 表示名の無い写真は数えない（「ユーザー」の名前でリンクを並べない）。
 */
export function photoCreators(photos: readonly Pick<Photo, "userId" | "displayName">[], limit = 8): PhotoCreator[] {
    const seen = new Map<string, { name: string; count: number; first: number }>();
    photos.forEach((p, i) => {
        const id = typeof p.userId === "string" ? p.userId : "";
        const name = typeof p.displayName === "string" ? p.displayName.trim() : "";
        if (!id || !name) return;
        const cur = seen.get(id);
        if (cur) cur.count++;
        else seen.set(id, { name, count: 1, first: i });
    });
    return [...seen.entries()]
        .sort(([, a], [, b]) => b.count - a.count || a.first - b.first)
        .slice(0, limit)
        .map(([id, v]) => ({ id, name: v.name }));
}
