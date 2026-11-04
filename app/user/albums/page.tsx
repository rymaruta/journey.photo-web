"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useLocale } from "../../i18n/context";
import { useAuth } from "../../auth/context";
import ListPageHeader from "../../components/ListPageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import {
    forgetJoinedAlbum, inviteTokenFromText, othersOf, readJoinedAlbums, type JoinedAlbum,
} from "../../../lib/utils/joinedAlbums";
import { useToast } from "../../../lib/hooks/useToast";
import { useMemberGate } from "../../../lib/hooks/useMemberGate";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../../lib/hooks/useEscapeKey";
import MemberOnlyNotice from "../../components/MemberOnlyNotice";
import { userFetch, readApiError, sessionErrorMessage } from "../../../lib/utils/api";
import { ROUTES } from "../../../lib/routes";

/**
 * 共同アルバム（案C）の管理。作る・招待リンクを配る・取り消す。
 *
 * **招待リンクはアルバムに1本。** 発行し直すと前のリンクは取り消される
 * （サーバー側でそうしている）。ここではその事実を画面にも書く——
 * 「もう一度発行したら前のが切れる」ことが分からないと、配ったリンクが
 * 黙って死ぬ。
 */

type Album = {
    id: string;
    title: string;
    memberCount: number;
    inviteToken?: string;
    inviteExpiresAt?: string;
};

/** 招待リンクの絶対URL。**この形（`/j?t=`）はサーバーと画面で対** */
const inviteUrl = (token: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/j?t=${encodeURIComponent(token)}`;

export default function AlbumsPage() {
    const { locale } = useLocale();
    const { showToast } = useToast();
    const router = useRouter();
    const { userId } = useAuth();
    const [albums, setAlbums] = useState<Album[] | null>(null);
    /** 招待リンクから参加する欄（iOS `AlbumsView.joinCard`）。貼ったリンクか招待コード */
    const [inviteText, setInviteText] = useState("");
    const [inviteError, setInviteError] = useState(false);
    /** 参加しているアルバムの、この端末の控え（`lib/utils/joinedAlbums.ts`） */
    const [joinedAll, setJoinedAll] = useState<JoinedAlbum[]>([]);
    useEffect(() => { setJoinedAll(readJoinedAlbums(userId)); }, [userId]);
    const [loadError, setLoadError] = useState("");
    const [title, setTitle] = useState("");
    const [busy, setBusy] = useState(false);
    /** 名前を変えている最中のアルバム（id → 入力中の名前） */
    const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);

    /**
     * 打ちかけがあるか。**送り返す前に見る。**
     *
     * この画面にも打って入れる欄が2つある——新規アルバムの名前と、
     * 改名の欄。どちらもボタンでしか送らないので、別タブでログアウト
     * すると `router.replace` が画面ごと作り直して**打った名前が消える**。
     * `/user/profile` で同じものを直した回に、ここを取りこぼしていた
     * （「横断で探した」と書いておきながら3件目を見落としていた）。
     *
     * 改名は「開いただけ」を打ちかけに数えない——開くときに元の名前を
     * そのまま入れるので、変わっていなければ守るものが無い。
     */
    const hasUnsavedWork = title.trim() !== ""
        || (!!editing && editing.title.trim()
            !== (albums?.find((a) => a.id === editing.id)?.title ?? "").trim());

    const gate = useMemberGate(hasUnsavedWork);

    /**
     * **留めたぶん、保存できないことを伝える。** 送り返さないだけで黙って
     * いると、「作る」を押しても失敗し続ける画面に取り残される。
     * 一度だけ出す（`/user/edit` `/user/upload` `/user/profile` と同じ形）
     */
    // **札そのものは縛れていない。** 消しても落ちるテストが無い
    // （レビューが変異で実証）。ただし**等価だと断定もしていない**——
    // deps（`gate` / `hasUnsavedWork` / `locale` / `showToast`）は全部
    // 値が安定していて（`showToast` は `useCallback([])`）、
    // 打ちかけが false に戻る回は `useMemberGate` が送り返すので、
    // **この画面で2回出る経路を作れなかった**。他3画面と揃える意味で残す。
    // 直前に「等価だから縛らない」と書いて外した判断が誤りだった
    // （`type="url"` は ASCII の空白しか落とさない）ので、
    // **断定は書かない**
    const toldSignedOut = useRef(false);
    useEffect(() => {
        // ログインし直したら札を下ろす（二度目を無言にしない）
        if (gate === "ok") { toldSignedOut.current = false; return; }
        // **ログインしているが権限が無い人に、ログインの話をしない。**
        //
        // `gate !== "ok"` で書いていたので `no-group` と `loading` にも
        // 出ていた。`no-group` の人は**ログインしている**うえ、
        // `useMemberGate` 自身が「グループを入れ直す経路はアプリのどこにも
        // 無い。再ログインでも直らない」と書いている——`MemberOnlyNotice`
        // の上に**絶対に効かない対処法**を重ねることになる。
        // しかも札は `ok` でしか下りないので、1回誤射すると**本物の
        // ログイン切れが無言**になる。
        //
        // `/user/edit:486` が同じ1行を持ち、それを守るテストのコメントに
        // 「この campaign で3回出ている」と書いてある。**4回目をやった。**
        if (gate !== "anonymous" || !hasUnsavedWork || toldSignedOut.current) return;
        toldSignedOut.current = true;
        showToast(locale === "en"
            ? "You are signed out. This can't be saved yet — sign in again in another tab, then try again."
            : "ログインが切れました。この内容は保存できません。別のタブでログインし直してから、もう一度お試しください", "error");
    }, [gate, hasUnsavedWork, locale, showToast]);
    /** 消す前に一度聞く。**押し間違いで消させない**（削除は元に戻せない） */
    const [confirming, setConfirming] = useState<Album | null>(null);
    // **削除の確認は、他のダイアログと同じくフォーカスを閉じ込める。** ここだけ
    // useFocusTrap を使っておらず、開いても中へ入らず、Tab で裏へ抜け、Esc でも
    // 閉じず、閉じたあと元のボタンへ戻らなかった（#49）
    const confirmRef = useRef<HTMLDivElement | null>(null);
    useFocusTrap(!!confirming, confirmRef);
    useEscapeKey(!!confirming && !busy, () => setConfirming(null));

    const load = useCallback(async () => {
        // **失敗を「0件」に潰さない。**
        //
        // `setAlbums([])` していたので、赤いエラーと「まだアルバムが
        // ありません。」が**同時に出て**いた——持っているアルバムが
        // 消えたように読める。同じリポジトリの `FollowingSheet` が
        // 「`[]` に潰すと『0人』と『壊れた応答』が混ざる」と書いていて、
        // `NotificationsBell` も `drafts` も同じ判断をしている。
        // ここだけ逆をやっていた。`null` のままにすれば
        // 「読み込み中…」でも「0件」でもなく、失敗の1行だけが出る
        try {
            const res = await userFetch("/albums");
            if (!res.ok) {
                setLoadError(await readApiError(res, "アルバムを読み込めませんでした"));
                return;
            }
            const data = await res.json() as { albums?: Album[] };
            setAlbums(Array.isArray(data.albums) ? data.albums : []);
            setLoadError("");
        } catch (e) {
            // 圏外とセッション切れを混ぜない
            setLoadError(sessionErrorMessage(e) ?? "アルバムを読み込めませんでした");
        }
    }, []);

    useEffect(() => { if (gate === "ok") void load(); }, [gate, load]);

    /**
     * 貼ったリンクか招待コードを開く。**押した瞬間に参加させない**——`/j?t=` が中身を見せてから聞く
     * （iOS `openInvite()` と同じ）。トークンが取れなければ、その場で言う
     */
    const openInvite = () => {
        const token = inviteTokenFromText(inviteText);
        if (!token) { setInviteError(true); return; }
        setInviteError(false);
        setInviteText("");
        router.push(`/j?t=${encodeURIComponent(token)}`);
    };

    const create = useCallback(async () => {
        const name = title.trim();
        if (!name || busy) return;
        setBusy(true);
        try {
            const res = await userFetch("/albums", { method: "POST", body: JSON.stringify({ title: name }) });
            if (!res.ok) {
                showToast(await readApiError(res, "アルバムを作れませんでした"), "error");
                return;
            }
            setTitle("");
            await load();
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "アルバムを作れませんでした", "error");
        } finally {
            setBusy(false);
        }
    }, [title, busy, load, showToast]);

    const issue = useCallback(async (albumId: string) => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(albumId)}/invite`, { method: "POST" });
            if (!res.ok) {
                showToast(await readApiError(res, "招待リンクを作れませんでした"), "error");
                return;
            }
            await load();
            showToast("招待リンクを作りました。前のリンクは使えなくなります", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "招待リンクを作れませんでした", "error");
        } finally {
            setBusy(false);
        }
    }, [busy, load, showToast]);

    const revoke = useCallback(async (albumId: string) => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(albumId)}/invite`, { method: "DELETE" });
            if (!res.ok) {
                showToast(await readApiError(res, "取り消せませんでした"), "error");
                return;
            }
            await load();
            showToast("招待リンクを取り消しました", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "取り消せませんでした", "error");
        } finally {
            setBusy(false);
        }
    }, [busy, load, showToast]);

    const rename = async () => {
        if (!editing || busy) return;
        const name = editing.title.trim();
        if (!name) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(editing.id)}`, {
                method: "PATCH", body: JSON.stringify({ title: name }),
            });
            if (!res.ok) {
                showToast(await readApiError(res, "名前を変えられませんでした"), "error");
                return;
            }
            setEditing(null);
            await load();
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "名前を変えられませんでした", "error");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (a: Album) => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(a.id)}`, { method: "DELETE" });
            if (!res.ok) {
                showToast(await readApiError(res, "消せませんでした"), "error");
                return;
            }
            setConfirming(null);
            await load();
            showToast("アルバムを消しました（写真は残ります）", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "消せませんでした", "error");
        } finally {
            setBusy(false);
        }
    };

    /** 自分が作ったアルバムと重ならない、参加しているアルバム */
    const joinedOthers = othersOf(joinedAll, (albums ?? []).map((a) => a.id));

    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    // **送り返さないと決めた回は、画面も出す。**
    //
    // ここでスピナーに落とすと、打ちかけを守るために送り返さなかった意味が
    // 無い——**見えないまま止まるだけ**で、打った名前は state に残っていても
    // 読むことも直すこともできない。`/user/upload:1016` のコメントが
    // この形を名指しで戒めているのに、**その戒めを読まずに同じ形を作った**
    // （借りたのは `useMemberGate` の引数だけで、その引数が前提にしている
    //   「画面も出す」を持ってこなかった）
    if (gate !== "ok" && !hasUnsavedWork) {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">アルバム</h1>
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-bg text-white px-4 py-8">
            <div className="max-w-2xl mx-auto">
                <Link href={ROUTES.HOME} aria-label="戻る" className="inline-flex items-center text-white/70 mb-2" style={{ minHeight: 44, minWidth: 44 }}>
                    <ArrowLeftIcon className="w-5 h-5" aria-hidden="true" />
                </Link>
                {/* 見出しの型は iOS `AlbumsView.header`（明朝の題 → 一行）。以前は 18 のゴシック「共同アルバム」。
                    リンクを開くだけならログインは要らない、の断りは下の参加の札に移した（2026-11-04 判断・札 #478） */}
                <ListPageHeader
                    titleId="site-title"
                    title="アルバム"
                    description="招待リンクで、旅の仲間と写真を集めます"
                />

                <div className="flex gap-2 mb-8">
                    <label htmlFor="album-title" className="sr-only">アルバムの名前</label>
                    <input
                        id="album-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={60}
                        placeholder="例: 北欧の冬"
                        className="flex-1 min-w-0 bg-surface-2 rounded-field px-3 py-2 text-sm ring-1 ring-line-strong"
                    />
                    {/* 🔴 **`aria-disabled` だけにしない。** 以前はこれで、
                        名前が空でも**見た目はそのまま押せて、押しても何も
                        起きなかった**（`create` が黙って return する）。
                        知らせも無いので「壊れている」としか見えない。
                        この画面だけが外れていた——`/user/highlights` の保存・
                        `/user/settings` のパスワード変更・`ReportDialog` の
                        送信は、どれも**本物の `disabled` ＋ 薄くする**で、
                        押せないことが目で分かる。そちらに揃える
                        （見張り: `app/user/albums/__tests__/`） */}
                    <button
                        type="button"
                        onClick={create}
                        disabled={busy || !title.trim()}
                        className="rounded-lg bg-accent-fill text-ink text-sm px-4 disabled:opacity-50"
                        style={{ minHeight: 44 }}
                    >
                        作る
                    </button>
                </div>

                {/* 招待リンクから参加（iOS `joinCard`: 札の中に欄と「開く」）。受け取ったリンクの貼り先が見える形にする */}
                <section aria-labelledby="album-join-title" className="rounded-xl bg-surface ring-1 ring-line p-4 mb-8" data-testid="album-join">
                    <h2 id="album-join-title" className="m-0 text-white font-semibold" style={{ fontSize: "15px", lineHeight: 1.4 }}>招待リンクから参加</h2>
                    <form
                        className="flex gap-2 mt-2.5"
                        onSubmit={(e) => { e.preventDefault(); openInvite(); }}
                    >
                        <label htmlFor="album-invite" className="sr-only">リンクか招待コード</label>
                        <input
                            id="album-invite"
                            value={inviteText}
                            onChange={(e) => { setInviteText(e.target.value); setInviteError(false); }}
                            placeholder="リンクか招待コード"
                            inputMode="url"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className="flex-1 min-w-0 bg-surface-2 rounded-field px-3 text-sm ring-1 ring-line-strong"
                            style={{ minHeight: 44 }}
                        />
                        <button
                            type="submit"
                            disabled={!inviteText.trim()}
                            className="rounded-full ring-1 ring-line-strong text-white text-sm px-5 disabled:opacity-50"
                            style={{ minHeight: 44, touchAction: "manipulation" }}
                        >
                            開く
                        </button>
                    </form>
                    {inviteError && (
                        <p role="alert" className="m-0 mt-2 text-danger" style={{ fontSize: "12px" }}>招待リンクを読み取れませんでした</p>
                    )}
                    <p className="m-0 mt-2.5 text-text-3" style={{ fontSize: "12px", lineHeight: 1.5 }}>
                        受け取ったリンク（https://journey-photo.com/j?t=…）をそのまま貼れます。リンクを開くだけならログインは要りません。
                    </p>
                </section>

                {/* **再試行の口を出す。** `load()` は `gate` が変わったときしか
                    走らないので、無いとページを開き直すしかなかった
                    （`drafts` は再試行ボタンを持っている） */}
                {loadError && (
                    <div className="mb-4" role="alert">
                        <ErrorState
                            message={loadError}
                            onRetry={() => { setLoadError(""); void load(); }}
                            retryLabel="もう一度読み込む"
                            locale={locale === "en" ? "en" : "ja"}
                        />
                    </div>
                )}

                {albums === null ? (
                    // 失敗した回は「読み込み中…」を出さない（上の1行が説明する）
                    loadError ? null : <LoadingState kind="rows" />
                ) : albums.length === 0 && joinedOthers.length === 0 ? (
                    // iOS: 何が無いか → どうすれば埋まるか → 一手（作る）。一手は名前の欄へ
                    <EmptyState
                        title="まだアルバムがありません"
                        message="アルバムを作って招待リンクを送ると、仲間の写真がここに集まります"
                        action={{ label: "アルバムを作る", onClick: () => document.getElementById("album-title")?.focus() }}
                    />
                ) : albums.length === 0 ? null : (
                    <>
                    <p className="m-0 mb-3 eyebrow text-accent eyebrow-line">作ったアルバム</p>
                    <ul className="space-y-4">
                        {albums.map((a) => (
                            <li key={a.id} className="rounded-xl bg-surface ring-1 ring-line p-4">
                                {editing?.id === a.id ? (
                                    <div className="flex gap-2">
                                        <label htmlFor={`rename-${a.id}`} className="sr-only">アルバムの新しい名前</label>
                                        <input
                                            id={`rename-${a.id}`}
                                            value={editing.title}
                                            onChange={(e) => setEditing({ id: a.id, title: e.target.value })}
                                            maxLength={60}
                                            className="flex-1 min-w-0 bg-surface-2 rounded-field px-3 py-2 text-sm ring-1 ring-line-strong"
                                        />
                                        {/* **空の名前でも押せて無反応**だった
                                            （`rename` は `!name` で黙って return するのに、
                                            ここは `busy` しか見ていなかった）。条件を揃える */}
                                        <button type="button" onClick={rename} disabled={busy || !editing.title.trim()}
                                            className="rounded-lg bg-accent-fill text-ink text-sm px-3 disabled:opacity-50" style={{ minHeight: 44 }}>
                                            保存
                                        </button>
                                        <button type="button" onClick={() => setEditing(null)}
                                            className="text-xs text-white/70 px-2" style={{ minHeight: 44 }}>
                                            やめる
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm">{a.title}</p>
                                            <p className="text-xs text-white/60 mt-0.5">{a.memberCount}人が参加</p>
                                        </div>
                                        <div className="flex gap-3 shrink-0">
                                            <button type="button" onClick={() => setEditing({ id: a.id, title: a.title })}
                                                className="text-xs underline decoration-white/40 underline-offset-2" style={{ minHeight: 44 }}>
                                                名前を変える
                                            </button>
                                            <button type="button" onClick={() => setConfirming(a)}
                                                className="text-xs underline decoration-white/40 underline-offset-2" style={{ minHeight: 44 }}>
                                                消す
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {a.inviteToken ? (
                                    <div className="mt-3">
                                        <p className="text-[12px] text-white/50">招待リンク</p>
                                        <p className="text-xs break-all text-white/85 mt-0.5">{inviteUrl(a.inviteToken)}</p>
                                        {a.inviteExpiresAt && (
                                            <p className="text-[12px] text-white/50 mt-1">
                                                {new Date(a.inviteExpiresAt).toLocaleDateString("ja-JP")}まで
                                            </p>
                                        )}
                                        <div className="flex gap-3 mt-2">
                                            <button type="button" onClick={() => issue(a.id)} disabled={busy}
                                                className="text-xs underline decoration-white/40 underline-offset-2 disabled:opacity-50" style={{ minHeight: 44 }}>
                                                作り直す
                                            </button>
                                            <button type="button" onClick={() => revoke(a.id)} disabled={busy}
                                                className="text-xs underline decoration-white/40 underline-offset-2 disabled:opacity-50" style={{ minHeight: 44 }}>
                                                取り消す
                                            </button>
                                        </div>
                                        {/* **前のリンクが死ぬことを書く。** 書かないと、配ったリンクが黙って切れる */}
                                        <p className="text-[12px] text-white/50 mt-1">作り直すと、前のリンクは使えなくなります。</p>
                                    </div>
                                ) : (
                                    <button type="button" onClick={() => issue(a.id)} disabled={busy}
                                        className="mt-3 text-xs underline decoration-white/40 underline-offset-2 disabled:opacity-50" style={{ minHeight: 44 }}>
                                        招待リンクを作る
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                    </>
                )}

                {/* 参加しているアルバム（iOS `joinedSection`）。サーバーの一覧は自分が作った分しか返さないので、
                    この端末が覚えている分を出す。出さないと、参加した瞬間にアルバムへの入口が消える。
                    **抜けるのではなく、この端末の控えを消すだけ**（サーバーに「抜ける」口は無い） */}
                {albums !== null && joinedOthers.length > 0 && (
                    <section aria-labelledby="album-joined-title" className="mt-8" data-testid="album-joined">
                        <h2 id="album-joined-title" className="m-0 mb-3 eyebrow text-accent eyebrow-line">参加しているアルバム</h2>
                        <ul className="m-0 p-0 list-none">
                            {joinedOthers.map((e) => (
                                <li key={e.id} className="flex items-center border-b border-line">
                                    <Link
                                        href={`/j?t=${encodeURIComponent(e.token)}`}
                                        prefetch={false}
                                        className="flex-1 min-w-0 flex flex-col justify-center py-3"
                                        style={{ minHeight: 64 }}
                                    >
                                        <span className={`truncate font-serif ${e.title ? "text-white" : "text-text-2"}`} style={{ fontSize: "18px" }}>
                                            {e.title || "無題のアルバム"}
                                        </span>
                                        <span className="text-text-3" style={{ fontSize: "12px" }}>招待リンクから参加</span>
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => { forgetJoinedAlbum(userId, e.id); setJoinedAll(readJoinedAlbums(userId)); }}
                                        aria-label={`「${e.title || "無題のアルバム"}」を一覧から消す`}
                                        className="shrink-0 text-xs text-text-2 underline decoration-white/40 underline-offset-2 px-2"
                                        style={{ minHeight: 44, touchAction: "manipulation" }}
                                    >
                                        一覧から消す
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* **消す前に一度聞く。** 削除は元に戻せない。
                    「写真は残る」ことも書く——アルバムは束ねているだけで、
                    写真そのものは投稿した人のもの */}
                {confirming && (
                    <div ref={confirmRef} role="dialog" aria-modal="true" aria-label="アルバムを消す"
                        className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50"
                        // 下端に寄せて出すので、ホームへ戻る帯のぶんを下に足す
                        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}>
                        <div className="bg-surface-2 rounded-2xl ring-1 ring-line p-5 max-w-sm w-full">
                            <p className="text-sm">「{confirming.title}」を消しますか？</p>
                            <p className="text-xs text-white/60 mt-2">
                                招待リンクは使えなくなり、参加者はこのアルバムを開けなくなります。
                                <strong className="text-white/85">写真そのものは消えません。</strong>
                            </p>
                            <div className="flex gap-2 justify-end mt-5">
                                <button type="button" onClick={() => setConfirming(null)}
                                    className="text-sm px-4" style={{ minHeight: 44 }}>やめる</button>
                                <button type="button" onClick={() => remove(confirming)} disabled={busy}
                                    className="rounded-lg bg-accent-fill text-ink text-sm px-4 disabled:opacity-50" style={{ minHeight: 44 }}>
                                    消す
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
