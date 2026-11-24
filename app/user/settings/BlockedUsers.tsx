"use client";

/**
 * ブロックした人の一覧と解除。
 *
 * **押せる場所が無かった。** `DELETE /users/{id}/block` と
 * `GET /user/blocks` はサーバー側に前からあるのに、呼ぶ画面が1つも
 * 無かった（grep で0件）。ストーリーの返信からブロックできるように
 * したぶん、**誤って押すと元に戻せない**状態を新しく作っていた
 * ——しかもブロックは相手とのフォローを両向きに切るので、実害がある。
 *
 * 置き場所は設定の下の画面「ブロックした人」（`/user/settings/blocked`・2026-11-04 に iOS と同じく
 * 設定の行 → 画面にした）。以前は設定の中に一覧ごと開き、1人も居なければ何も描かなかった。
 *
 * 2026-09-21 にプロフィール編集から設定へ移した。プロフィール編集は
 * 「他人に見える自分」を作る画面で、ブロックは**他人を見えなくする**
 * 設定＝別の話。owner のモックも「プライバシー」の側に置いている。
 */

import React, { useCallback, useEffect, useState } from "react";
import { userFetch, readApiError, sessionErrorMessage } from "../../../lib/utils/api";
import { usableUserRows, type UserRow } from "../../../lib/utils/userRows";
import UserAvatar from "../../components/UserAvatar";
import { LoadingState } from "../../components/StateViews";
import { INLINE_BTN, INLINE_BTN_STYLE } from "../../components/buttonStyles";

export default function BlockedUsers({ locale }: { locale: "ja" | "en" }) {
    const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
    const [users, setUsers] = useState<UserRow[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    /** 解除が効かなかった理由（押した場所の近くに1行出す） */
    const [actionError, setActionError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await userFetch("/user/blocks");
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json() as { users?: unknown; blockedIds?: unknown };
                if (cancelled) return;
                // **古い応答の形（ID だけ）でも出す。** API を先に出す運用なので
                // ふつうは起きないが、順序に依存させる理由が無い（2行で消せる）
                const raw = data.users ?? (Array.isArray(data.blockedIds)
                    ? (data.blockedIds as unknown[]).map((id) => ({ id })) : undefined);
                const list = usableUserRows(raw, "blocks");
                if (!list) { setState("failed"); return; }
                setUsers(list);
                setState("ready");
            } catch {
                if (!cancelled) setState("failed");
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const unblock = useCallback(async (id: string) => {
        if (busy) return;
        setBusy(id);
        setActionError(null);
        try {
            const res = await userFetch(`/users/${encodeURIComponent(id)}/block`, { method: "DELETE" });
            // **効いたときだけ画面から消す。** 失敗を成功に見せると
            // 「解除したのにまだ届かない」で二度目の落胆になる
            if (res.ok) { setUsers((prev) => prev.filter((u) => u.id !== id)); return; }
            // **失敗を無言にしない。** ボタンが「解除しています…」から
            // 戻って行が残るだけなので、効かなかったのか・まだなのか・
            // 押し方が悪いのかが分からなかった。**ここはブロック解除の
            // 唯一の口**で、`StoryViewer` と `UserProfileClient` が
            // 「解除は設定の『ブロックした人』から」と案内する到達先。
            // 同じファイルの取得失敗は文言で伝えているのに、ここだけ黙っていた
            setActionError(await readApiError(res, locale === "en"
                ? "Couldn't unblock. Please try again." : "解除できませんでした。もう一度お試しください"));
        } catch (e) {
            // 圏外とセッション切れを混ぜない（同じファイルの取得側と同じ形）
            setActionError(sessionErrorMessage(e) ?? (locale === "en"
                ? "Couldn't unblock. Please try again." : "解除できませんでした。もう一度お試しください"));
        } finally {
            setBusy(null);
        }
        // `locale` を入れる（文言を読むようになったので、古い値を掴まない）
    }, [busy, locale]);

    // **取得に失敗したら、そう言う。** 黙って消すと、ストーリーの返信欄が
    // 「解除は設定の『ブロックした人』からできます」と案内している先が
    // **何も無い行き止まり**になる（解除の口はここしかない）。
    // 2026-11-04: 下の画面（`/user/settings/blocked`）になったので、iOS の `BlockedUsersView` と同じく
    // 失敗は danger の1文・読み込み中は灰の骨格・0人は「ブロックしている人はいません」と言う
    // （設定の中に一覧ごと開いていた頃は「普段は空の節」なので黙っていた）
    if (state === "failed") {
        return (
            <p role="alert" className="m-0 px-1 text-[15px] leading-[22px] text-danger" data-testid="blocked-failed">
                {locale === "en"
                    ? "Couldn't load your blocked list. Reload the page to try again."
                    : "ブロックした人を読み込めませんでした。ページを開き直すともう一度試します。"}
            </p>
        );
    }
    if (state === "loading") return <LoadingState kind="rows" locale={locale} />;
    if (users.length === 0) {
        return (
            <p className="m-0 px-1 text-[15px] leading-[22px] text-text-3" data-testid="blocked-empty">
                {locale === "en" ? "No one is blocked" : "ブロックしている人はいません"}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* 解除が効かなかった理由。**一覧の上**に置く——押したボタンは
                行の中にあるが、行は消えないので近くに1行あれば足りる */}
            {actionError && (
                <p role="alert" className="m-0 px-1 text-sm text-danger">{actionError}</p>
            )}
            {/* 板 v2: 人の行は 64、下に白 8% の区切り線（iOS `JPHeight.tallRow`）。札にしない */}
            <ul className="m-0 p-0 list-none">
                {users.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 min-h-[64px] border-b border-line">
                        {/* **プロフィールへは飛ばさない**（iOS と同じ。プロフィールはブロック中を見ておらず、
                            「フォローする」が出て押すとサーバーに断られる） */}
                        <UserAvatar userId={u.deleted ? "" : u.id} className="w-11 h-11 flex-shrink-0" iconClassName="w-6 h-6" />
                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                            {/* **退会した人はここで出し分ける。** サーバーが返す `name` は日本語固定なので、
                                そのまま出すと英語表示の人にも「退会したユーザー」が出る。解除は押せるままにする
                                ——押せないと外せなくなる */}
                            <span className={`truncate text-[14px] font-semibold ${u.deleted ? "text-white/60" : "text-white"}`}>
                                {u.deleted
                                    ? (locale === "en" ? "Deleted user" : "退会したユーザー")
                                    : (u.name ?? (locale === "en" ? "User" : "旅人"))}
                            </span>
                            {!u.deleted && u.username && <span className="truncate text-xs text-text-3">@{u.username}</span>}
                        </span>
                        <button
                            type="button"
                            onClick={() => void unblock(u.id)}
                            disabled={busy === u.id}
                            // 線のボタン（白14%の縁・13 semibold・見た目 36・押せる高さ 44＝`INLINE_BTN`）
                            className={`${INLINE_BTN} flex-shrink-0 text-white ring-1 ring-inset ring-line-strong hover:bg-white/10`}
                            style={{ ...INLINE_BTN_STYLE, touchAction: "manipulation" }}
                        >
                            {busy === u.id
                                ? (locale === "en" ? "Unblocking…" : "解除しています…")
                                : (locale === "en" ? "Unblock" : "解除")}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
