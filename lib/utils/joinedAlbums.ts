import { storageGet, storageSet } from "./storage";

/**
 * 招待リンクで参加したアルバムの、この端末の控え（iOS `JoinedAlbumsStore`）。
 *
 * サーバーの一覧（`GET /albums`）は**自分が作ったアルバムしか返さない**ので、参加した側は
 * 参加した瞬間にアルバムへの入口が消える。端末が覚えている分を「参加しているアルバム」に出す
 * （2026-11-04 判断・札 #478。サーバーの口は増やさない）。
 *
 * - 鍵は利用者ごと（別の人が同じ端末でログインしても混ざらない）
 * - 「抜ける」口はサーバーに無いので、消すのはこの端末の控えだけ
 * - 自分が作ったアルバムとは重ねない（`othersOf`）。自分のリンクを自分で開くとサーバーは
 *   200（`already: true`）を返すので、控えにも入る
 */
export type JoinedAlbum = { id: string; title: string; token: string };

const key = (userId: string) => `journey:joined-albums:${userId}`;

/** 控えを読む（壊れた値・形の違う行は捨てる） */
export function readJoinedAlbums(userId: string | null): JoinedAlbum[] {
    if (!userId) return [];
    const raw = storageGet<unknown>(key(userId));
    if (!Array.isArray(raw)) return [];
    const out: JoinedAlbum[] = [];
    for (const r of raw) {
        const e = r as Partial<JoinedAlbum> | null;
        if (e && typeof e.id === "string" && e.id && typeof e.token === "string" && e.token) {
            out.push({ id: e.id, token: e.token, title: typeof e.title === "string" ? e.title : "" });
        }
    }
    return out;
}

/** 覚える。**同じアルバムは1行**（新しい方で置き換えて先頭へ） */
export function rememberJoinedAlbum(userId: string | null, album: JoinedAlbum): boolean {
    if (!userId || !album.id || !album.token) return false;
    const rest = readJoinedAlbums(userId).filter((e) => e.id !== album.id);
    return storageSet(key(userId), [album, ...rest]);
}

/** この端末の控えから消す（サーバーからは抜けない） */
export function forgetJoinedAlbum(userId: string | null, albumId: string): boolean {
    if (!userId) return false;
    return storageSet(key(userId), readJoinedAlbums(userId).filter((e) => e.id !== albumId));
}

/** 自分が作ったアルバムと重ならない行だけ */
export function othersOf(entries: readonly JoinedAlbum[], mineIds: readonly string[]): JoinedAlbum[] {
    const mine = new Set(mineIds);
    return entries.filter((e) => !mine.has(e.id));
}

/**
 * 貼られたリンクか招待コードから、招待のトークンを取り出す（iOS `InviteLink.token(from:)`）。
 *
 * - `https://…/j?t=<トークン>` → トークン
 * - URL でなければ、打たれた文字列そのものをトークンとみなす
 * - **トークンを持たない URL は空**（URL 全体を送ると無意味な問い合わせが飛ぶ）
 */
export function inviteTokenFromText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "";
    // 「https://」などの形（スキームあり）だけを URL とみなす。`t=abc` のような素の文字列は招待コード
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        try {
            return new URL(trimmed).searchParams.get("t") ?? "";
        } catch {
            return "";
        }
    }
    // スキームの無い `journey-photo.com/j?t=…` も貼れるように、`?t=` があればそこから取る
    const q = trimmed.indexOf("?");
    if (q >= 0) return new URLSearchParams(trimmed.slice(q + 1)).get("t") ?? "";
    return trimmed;
}
