"use client";

import React from "react";
import { useAuth } from "../auth/context";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { fetchFollowingSet, subscribeFollowingSet } from "../../lib/hooks/useFollow";
import { timelinePhotos } from "../../lib/utils/timeline";
import { ROUTES, loginWithNext } from "../../lib/routes";
import { track } from "../../lib/utils/analytics";
import HomeMosaic from "./HomeMosaic";
import { EmptyState, ErrorState, LoadingState } from "./StateViews";

type Props = { locale: string };

/** 「フォロー中」の未ログイン案内を数えたか（ページを開いている間に1回）。試験が戻すための口だけ公開 */
let guestPromptCounted = false;
export function resetGuestPromptCounted() { guestPromptCounted = false; }

/**
 * フォローしている人の写真が**投稿の新しい順に流れる**面（Instagram のホームに
 * 当たる）。トップの「フォロー中」タブが描く。
 *
 * **並べ方は新着・おすすめと同じ `HomeMosaic`**（iOS の `GalleryView` が3つのタブを
 * 同じ並びで描くのに揃えた・2026-09-29）。撮った人の名前は撮影地と一緒に写真に重ねる。
 * **撮影地の無い写真は名前も重ねない**（iOS と同じ）ので、そのときは読み上げと写真ページで分かる。
 * 以前は縦1列の札（投稿者の行・題・説明・タグ・保存など4つの操作）だった
 *
 * owner:「この画面（トップ）は、タブで切り替えて、自分の写真かフォロー中の人の
 * 写真みれるようにしたい」。以前は別ページ `/timeline` → マイページのタブと
 * 置き場所を2回読み違えた。中身の決め方は `lib/utils/timeline.ts`。
 *
 * **投稿権限（グループ）は要らない**——フォローはグループが無くてもできる。
 * 未ログインで描かれることは無いはずだが、その場合はログインへの導線を出す。
 */
export default function TimelineFeed({ locale }: Props) {
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { photos, loaded: photosLoaded, failed: photosFailed, retry: retryPhotos } = usePhotos();
    // `null` ＝ まだ分からない。**「0人」と混ぜない**（取得中に「まだ誰も
    // フォローしていません」を出すと、フォローが効いていないように見える）
    const [following, setFollowing] = React.useState<Set<string> | null>(null);
    const [followingError, setFollowingError] = React.useState(false);
    const [reloadKey, setReloadKey] = React.useState(0);

    React.useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) {
            // ログアウトしたら前の人の集合を持ち越さない
            setFollowing(null);
            setFollowingError(false);
            return;
        }
        let aborted = false;
        setFollowingError(false);
        setFollowing(null);
        fetchFollowingSet()
            .then((set) => { if (!aborted) setFollowing(new Set(set)); })
            .catch(() => { if (!aborted) setFollowingError(true); });
        return () => { aborted = true; };
    }, [authLoading, isAuthenticated, reloadKey]);

    // 未ログインで「フォロー中」の案内（下の `following-guest`）が**実際に出た回**を数える（2026-11-09・登録の入口の数え方）。
    // 判定中・ログイン済みでは出さない。再描画・タブを替えて戻る（再マウント）でも**ページを開いている間に1回**
    // （モジュールの印。再読み込みで戻る）
    React.useEffect(() => {
        if (authLoading || isAuthenticated || guestPromptCounted) return;
        guestPromptCounted = true;
        track("login_prompt", { trigger: "following_tab" });
    }, [authLoading, isAuthenticated]);

    // フォロー・解除・ブロックで共有の一覧が変わったら取り直す
    // （結果をコピーして持つので、購読しないと伝わらない）
    React.useEffect(() => subscribeFollowingSet(() => setReloadKey((k) => k + 1)), []);

    const items = React.useMemo(
        () => (following ? timelinePhotos(photos, following) : []),
        [photos, following],
    );

    const isJa = locale !== "en";
    const loc = isJa ? "ja" : "en";

    /*
     * **状態の形は iOS のホームと同じ**（`GalleryView.feedEmptyState`・板 Main「フォロー中が空」・`StateViews`）。
     * 2026-11-04: 以前は文字だけの「読み込み中…」と、灰の札に入れた一文・灰の丸いボタンだった。
     *   読み込み中 … 写真の格子の灰の骨組み（`LoadingState`）
     *   失敗       … 三角・一文・「もう一度試す」（`ErrorState`）
     *   空         … 明朝の見出し「フォロー中の人の写真はまだありません」・一文・主ボタン「写真や人を探す」（`EmptyState`）。
     *                iOS は「0人」と「フォロー先がまだ上げていない」を分けない（どちらも見出しが「何が無いか」を言う）
     */
    if (authLoading) return <LoadingState kind="grid" locale={loc} />;
    if (!isAuthenticated) {
        // 2026-11-09: 押しても何も起きないように見えていたので、タブの中で「ログインすると見られる」ことを言い、
        // ログインへ進める（戻り先は今の頁・`via=follow` でログイン画面が理由を言う）
        return (
            <EmptyState className="py-16" testId="following-guest"
                title={isJa ? "ログインすると、フォロー中の人の写真が見られます" : "Log in to see photos from people you follow"}
                message={isJa ? "気になる作者をフォローすると、新しい写真がここに並びます。" : "Follow photographers you like and their new photos will appear here."}
                action={{ label: isJa ? "ログイン" : "Log in", href: loginWithNext(typeof window === "undefined" ? null : window.location.pathname + window.location.search, "follow") }} />
        );
    }
    if (followingError) {
        // iOS は「…引き下げて読み直せます」。Web は引き下げが無いので、その代わりの「もう一度試す」を出す
        return (
            <ErrorState className="py-16" locale={loc}
                message={isJa ? "フォロー中の人を読み込めませんでした。" : "Couldn't load the people you follow."}
                onRetry={() => setReloadKey((k) => k + 1)} />
        );
    }
    if (following === null) return <LoadingState kind="grid" locale={loc} />;
    const empty = (
        <EmptyState className="py-16" testId="following-empty"
            title={isJa ? "フォロー中の人の写真はまだありません" : "No photos from people you follow yet"}
            message={isJa ? "気になる作者をフォローすると、新しい写真がここに並びます。" : "Follow photographers you like and their new photos will appear here."}
            action={{ label: isJa ? "写真や人を探す" : "Find photos and people", href: ROUTES.SEARCH }} />
    );
    // **0人の答えは確定しているので、写真を待たない**（待つと0人の人にだけ骨組みが出続ける）
    if (following.size === 0) return empty;
    if (items.length === 0) {
        // 一覧が届く前は「まだありません」と言い切らない
        // （`photos` の初期値はビルド時のスナップショット＝週1で古い）
        if (!photosLoaded && !photosFailed) return <LoadingState kind="grid" locale={loc} />;
        if (!photosLoaded && photosFailed) {
            return <ErrorState className="py-16" locale={loc} message={isJa ? "読み込めませんでした" : "Couldn't load"} onRetry={retryPhotos} />;
        }
        return empty;
    }
    return <HomeMosaic photos={items} locale={isJa ? "ja" : "en"} />;
}
