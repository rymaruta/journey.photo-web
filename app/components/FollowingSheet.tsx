"use client";

/**
 * フォロー中／フォロワーの一覧（下から出るシート）。
 *
 * owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
 *
 * **1つの部品で両方出す。** 違うのは口と見出しだけで、倒し方
 * （読み込み中・失敗・0人を分ける／退会した人はリンクにしない／
 * 全部出せていないことを言う）は同じ。分けて書くと静かにずれる。
 *
 * 2026-11-04 判断（札 #478・iOS `FollowListView`）:
 * - 上に「フォロワー N ／ フォロー中 N」の下線の札（真鍮・マイページと同じ `tabStyles`）。
 *   開いた側（`kind`）が最初の札で、押して切り替えられる。**両方を一度に読む**（数を札に出すため）
 * - 行はアイコン・名前と @ユーザー名・フォローの札。札は人のページ・お知らせと同じ `FollowAction`
 *   （2つ目のフォローボタンを作らない）。自分の行・退会した人には出さない
 * - 読み込み中は灰の骨格、空は「まだいません」、一部だけのときは「全 N 人のうち M 人を表示しています」
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { XMarkIcon } from "@heroicons/react/24/outline";
import UserAvatar from "./UserAvatar";
import { FollowAction } from "./FollowButton";
import { ErrorState, LoadingState } from "./StateViews";
import { TAB_BASE, TAB_ON, TAB_OFF } from "./tabStyles";
import { useAuth } from "../auth/context";
import { ROUTES } from "../../lib/routes";
import { userFetch } from "../../lib/utils/api";
import { usableUserRows, type UserRow } from "../../lib/utils/userRows";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";

export type FollowListKind = "following" | "followers";

type Props = {
    userId: string;
    kind: FollowListKind;
    locale: "ja" | "en";
    onClose: () => void;
    openerRef?: React.RefObject<HTMLElement | null>;
};

const TITLE: Record<FollowListKind, { ja: string; en: string }> = {
    following: { ja: "フォロー中", en: "Following" },
    followers: { ja: "フォロワー", en: "Followers" },
};
/** 札の並び（iOS `FollowListView.Kind.order`: フォロワー → フォロー中・板の順） */
const TAB_ORDER: FollowListKind[] = ["followers", "following"];

type Loaded = { state: "loading" | "ready" | "failed"; rows: UserRow[]; total: number };
const INITIAL: Loaded = { state: "loading", rows: [], total: 0 };

export default function FollowingSheet({ userId, kind, locale, onClose, openerRef }: Props) {
    const en = locale === "en";
    const { userId: myId, isAuthenticated } = useAuth();
    /** 札で選んでいる方。開いたときは呼んだ側が決めた `kind` */
    const [current, setCurrent] = useState<FollowListKind>(kind);
    const [lists, setLists] = useState<Record<FollowListKind, Loaded>>({ following: INITIAL, followers: INITIAL });
    /** 読み直しの合図（「もう一度」を押すたびに増やす） */
    const [reload, setReload] = useState(0);
    const panelRef = useRef<HTMLDivElement>(null);
    // 外へ漏らさない・閉じたら押した場所へ戻す（このリポジトリの8か所と同じ道具）
    useFocusTrap(true, panelRef, openerRef);
    // **`document` で聞く。** React の合成イベントはフォーカスがパネルの
    // 中にあるときしか届かないので、`<p>` の文字をタップしてフォーカスが
    // body に落ちた時点で Escape が効かなくなる。既存の6か所と同じ道具
    // （変換中の Escape ＝「変換の取り消し」を除く判定も入っている）
    useEscapeKey(true, onClose);

    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    useEffect(() => {
        let cancelled = false;
        // **開いた側を先に取る**（札の数は両方そろってから出すが、見せる中身は先に届く）
        const order: FollowListKind[] = [kind, kind === "following" ? "followers" : "following"];
        setLists({ following: INITIAL, followers: INITIAL });
        for (const k of order) {
            void (async () => {
                try {
                    const res = await userFetch(`/users/${encodeURIComponent(userId)}/${k}`);
                    if (!res.ok) throw new Error(String(res.status));
                    // `listed`（一覧に入っている数）も返るが、画面は使わない
                    // ——出す判断は `total` と実際に描く行数で足りる
                    const data = await res.json() as { users?: unknown; total?: unknown };
                    // **配列でなければ「取れなかった」**。`[]` に潰すと
                    // 「0人」と「壊れた応答」が混ざる（この部品が掲げている
                    // 「読み込み中・失敗・0人を分ける」の逆）
                    const list = usableUserRows(data.users, k);
                    if (cancelled) return;
                    if (!list) { setLists((l) => ({ ...l, [k]: { state: "failed", rows: [], total: 0 } })); return; }
                    setLists((l) => ({ ...l, [k]: { state: "ready", rows: list, total: typeof data.total === "number" ? data.total : 0 } }));
                } catch {
                    if (!cancelled) setLists((l) => ({ ...l, [k]: { state: "failed", rows: [], total: 0 } }));
                }
            })();
        }
        return () => { cancelled = true; };
    }, [userId, kind, reload]);

    const { state, rows, total } = lists[current];
    const title = en ? TITLE[current].en : TITLE[current].ja;

    /** 矢印キーで札を移る（`role="tab"` の作法。停止点は選んでいる札だけ） */
    const onTabKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = TAB_ORDER[(TAB_ORDER.indexOf(current) + (e.key === "ArrowRight" ? 1 : -1) + TAB_ORDER.length) % TAB_ORDER.length];
        setCurrent(next);
        document.getElementById(`follow-tab-${next}`)?.focus();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
            onClick={onClose}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                // 下端に密着させない（iPhone のホームインジケータに最後の行が
                // かぶる）。既存のボトムシート2つと同じ形
                className="w-full sm:max-w-sm max-h-[70dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-surface-2 ring-1 ring-line pb-[calc(env(safe-area-inset-bottom,0px))] sm:pb-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-end justify-between pl-4 pr-2 border-b border-line">
                    {/* 下線の札（iOS `ProfileTabBar`）。選んでいる方は真鍮の字と下線、数は名前の右に等幅数字 */}
                    <div role="tablist" aria-label={en ? "Follow list" : "フォロー一覧"} className="flex items-stretch gap-[22px]">
                        {TAB_ORDER.map((k) => {
                            const active = k === current;
                            const l = lists[k];
                            return (
                                <button
                                    key={k}
                                    type="button"
                                    role="tab"
                                    id={`follow-tab-${k}`}
                                    aria-selected={active}
                                    aria-controls="follow-panel"
                                    tabIndex={active ? 0 : -1}
                                    onClick={() => setCurrent(k)}
                                    onKeyDown={onTabKeyDown}
                                    data-follow-tab={k}
                                    className={`${TAB_BASE} ${active ? TAB_ON : TAB_OFF}`}
                                    style={{ height: "44px", touchAction: "manipulation" }}
                                >
                                    {en ? TITLE[k].en : TITLE[k].ja}
                                    {l.state === "ready" && (
                                        <span className="ml-1.5 text-[12px] tabular-nums font-normal">{l.total}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={en ? "Close" : "閉じる"}
                        className="inline-flex items-center justify-center text-white/60 hover:text-white"
                        style={{ width: 44, height: 44 }}
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                <div role="tabpanel" id="follow-panel" aria-labelledby={`follow-tab-${current}`} className="overflow-y-auto px-4">
                    {/* **「まだ来ていない」を「0人」と言わない**（台帳 0d）。灰の骨格（0.3 秒より早ければ出さない） */}
                    {state === "loading" && <LoadingState kind="rows" locale={locale} />}
                    {state === "failed" && (
                        <ErrorState
                            message={en ? "Couldn't load the list." : "一覧を読み込めませんでした"}
                            onRetry={() => setReload((n) => n + 1)}
                            retryLabel={en ? "Retry" : "もう一度試す"}
                            locale={locale}
                        />
                    )}
                    {/* **「0人」と「まだ揃っていない」を分ける。**
                        数（`followstats#`）は正しいのに一覧が空、という状態が
                        ある——埋め戻しを流すまで／1件だけ書けなかったとき。
                        分けないと「5 フォロワー」と言いながら開くと
                        「まだフォロワーはいません」になる */}
                    {state === "ready" && rows.length === 0 && (
                        <p className="text-sm text-text-2 text-center py-8 m-0">
                            {total > 0
                                ? (en
                                    ? "This list isn't ready yet. The count above may be more up to date."
                                    // **「正しい値です」と言い切らない。** `followstats#` も
                                    // ずれることがある（`account.ts` が「誰にも直せない +1／
                                    // 引きすぎ」を認めている）。言えるのは「こちらの方が
                                    // 新しいことがある」まで
                                    : "一覧はまだ用意できていません。上の数の方が新しい場合があります。")
                                : (en ? "No one yet" : "まだいません")}
                        </p>
                    )}
                    {rows.map((u) => (u.deleted ? (
                        // **退会した人はリンクにしない**（開いても空のページ）。
                        // 退会が消すのは本人の `following#` だけなので、
                        // 他人の一覧には残り続ける。コメント欄・ストーリーの
                        // 返信と同じ扱い（アバターも出さない）。札も出さない
                        <div key={u.id} className="flex items-center gap-3 border-b border-line" style={{ minHeight: 64 }}>
                            <UserAvatar userId="" className="w-11 h-11 flex-shrink-0" iconClassName="w-5 h-5" />
                            <span className="text-sm text-text-3 truncate">
                                {en ? "Deleted user" : "退会したユーザー"}
                            </span>
                        </div>
                    ) : (
                        // 板 v2 の人の行: 高さ 64・アイコン 44・区切りは白 8%。押せる所は人の部分と札で別
                        <div key={u.id} className="flex items-center gap-3 border-b border-line" style={{ minHeight: 64 }}>
                            <Link
                                href={ROUTES.USER_PROFILE(u.id)}
                                onClick={onClose}
                                className="flex-1 min-w-0 flex items-center gap-3 py-2"
                            >
                                <UserAvatar userId={u.id} className="w-11 h-11 flex-shrink-0" iconClassName="w-5 h-5" />
                                <span className="min-w-0 flex flex-col">
                                    <span className="text-sm text-white/90 truncate">
                                        {u.name ?? (en ? "User" : "旅人")}
                                    </span>
                                    {/* @ユーザー名は一覧の応答が行ごとに持つ。無い人は名前だけ（iOS `PersonNameLines`） */}
                                    {u.username && (
                                        <span className="text-text-3 truncate" style={{ fontSize: "12px" }}>@{u.username}</span>
                                    )}
                                </span>
                            </Link>
                            {/* 自分の行には出さない（`isOwner`）。判定が付くまでは `FollowAction` が描かない */}
                            <FollowAction
                                targetUserId={u.id}
                                isOwner={u.id === myId}
                                isAuthenticated={isAuthenticated}
                                locale={locale}
                                variant="list"
                                ariaLabel={en ? `Follow ${u.name ?? "user"}` : `${u.name ?? "旅人"}をフォローする`}
                            />
                        </div>
                    )))}
                    {/* サーバーは50人までしか返さない（1回で2000回の GetItem は
                        撃てない）。**足りないことを黙らない**。
                        `total`（正しい数）と比べる——一覧が追いついていない
                        ぶんもここに出る */}
                    {state === "ready" && rows.length > 0 && total > rows.length && (
                        <p className="m-0 py-3 text-center text-text-3 tabular-nums" style={{ fontSize: "12px" }}>
                            {en
                                ? `Showing ${rows.length} of ${total}`
                                : `全 ${total} 人のうち ${rows.length} 人を表示しています`}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
