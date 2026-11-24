"use client";

import { useAuth } from "../../app/auth/context";

/**
 * 端末のお気に入り（localStorage `photo-gallery-favorites`）を**画面に出してよいか**。
 *
 * 2026-11-09 owner 承認: 未ログインのいいねは端末に溜めない。以前に端末へ残った古いお気に入り
 * （サーバーに届いていない・件数にも通知にも入っていない）を、カードのハート・ヘッダの「お気に入り」・
 * `/favorites` に出し続けると「押せた」と見えるので、**未ログインでは出さない**。
 * **判定中（`loading`）も出さない**——古いお気に入りで塗ったハートが、判定後に空になる一瞬を作らない。
 * ログイン済みは今まで通り（端末の控えとサーバーの和）。
 *
 * 認証の外（単体テストの孤立した描画）では `useAuth` が投げるので、そのときは従来どおり出す。
 * 本番は必ず `AuthProvider` の中。
 */
export function useLocalFavoritesShown(): boolean {
    let auth: ReturnType<typeof useAuth> | undefined;
    try { auth = useAuth(); } catch { auth = undefined; }   // eslint-disable-line react-hooks/rules-of-hooks -- useContext は必ず呼ばれる（順序は変わらない）
    if (!auth) return true;
    return !auth.loading && auth.isAuthenticated;
}
