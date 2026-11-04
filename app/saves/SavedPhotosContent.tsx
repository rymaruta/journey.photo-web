"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "../auth/context";
import { useMySaves } from "../../lib/hooks/useMySaves";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { usePhotos } from "../../lib/hooks/usePhotos";
import GalleryGrid from "../components/GalleryGrid";
import { EDITORIAL_HERO_SIZES, EDITORIAL_PAIR_SIZES } from "../components/gridSizes";
import ListPageHeader from "../components/ListPageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import { useLocale } from "../i18n/context";
import { photoCategoryMap } from "../../lib/utils/categoryMap";
import { ROUTES, loginWithNext } from "../../lib/routes";

/**
 * 保存した写真（/saves）。**`/favorites`（いいねした写真）とは別のページ。**
 *
 * 見分けが付くように、3つとも違えてある:
 *   - 題: 「保存した写真」／あちらは「いいねした写真」
 *   - 印: しおり（青）／あちらはハート（赤）
 *   - 説明: 「自分用の棚。投稿者には伝わりません」の1行を出す
 *
 * **端末の控え（localStorage）は混ぜない。** いいねは未ログインでも押せる
 * ので `useFavorites` との和を出しているが、保存はログインした人だけの
 * 機能で、真値はサーバーの `saves#<uid>` 1つ。
 */
export default function SavedPhotosContent({ embedded = false }: { embedded?: boolean } = {}) {
    const { locale, labels } = useLocale();
    const { preloadMultiple } = useImagePreloader();
    // **写真の一覧の状態も見る。** 棚が持っているのは ID だけで、中身は
    // こちらから引く——届いていなければ、保存が10件あっても0件に見える
    // （手元の断面はビルド時のもので、そのあと保存した写真は API の一覧に
    // しか無い）。`loaded` / `failed` を捨てると、それが「まだありません」に
    // 化ける
    const { photos: allPhotos, loaded: photosLoaded, failed: photosFailed } = usePhotos();
    const { isAuthenticated, loading: authLoading } = useAuth();
    const saves = useMySaves(isAuthenticated, authLoading);
    const en = locale === "en";

    /** まだ答えが出そろっていない（棚の一覧・写真の一覧のどちらか待ち） */
    const pending = saves.pending || (!photosLoaded && !photosFailed);
    /** 聞きに行って失敗した。**0件と混ぜない** */
    const failed = saves.failed || photosFailed;

    // 保存した写真。**新しい順はサーバーの一覧が持っている**ので、
    // `allPhotos` の並びではなくそちらに合わせて並べ直す
    // （`filter` だけだと、棚の順番がギャラリーの並びに化ける）。
    const savedPhotos = React.useMemo(() => {
        const byId = new Map(allPhotos.map((p) => [p.id, p]));
        return saves.photoIds
            .map((id) => byId.get(id))
            .filter((p): p is NonNullable<typeof p> => !!p);
    }, [saves.photoIds, allPhotos]);

    React.useEffect(() => {
        if (savedPhotos.length > 0) {
            preloadMultiple(savedPhotos.slice(0, 10).map((p) => p.thumbSrc ?? p.src));
        }
    }, [savedPhotos, preloadMultiple]);

    // **鍵は写真が持っている値そのもの**（読む側 `GalleryGrid` が生の値で
    // 引き、落とし先を持たない）。理由は `lib/utils/categoryMap.ts` に
    const categoryDisplayMap = React.useMemo(
        () => photoCategoryMap(savedPhotos, labels.category.names ?? {}),
        [labels, savedPhotos],
    );

    const Root = embedded ? "section" : "main";
    const n = savedPhotos.length;
    /** iOS `MyPageView.savedArea` の一文（保存の札の下）。いいねとの違いをここで言う */
    const note = (
        <>
            {en
                ? "Photos you bookmarked. Only you can see them, and the photographer isn't notified (liked photos are "
                : "しおりで保存した写真。あなただけに見え、作者には届きません（いいねした写真は"}
            <Link
                href={ROUTES.FAVORITES}
                prefetch={false}
                className="underline underline-offset-4 hover:text-white/80 inline-flex items-center"
                style={{ minHeight: 44 }}
            >
                {en ? "under Liked Photos" : "メニューの「いいねした写真」"}
            </Link>
            {en ? ")." : "）"}
        </>
    );
    const loadingEl = <LoadingState kind="grid" locale={en ? "en" : "ja"} testId="saves-loading" />;
    return (
        <Root className={embedded ? "w-full text-white" : "p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full"}>
            {/* 見出しの型は iOS の一覧の頁と同じ（眉 → 明朝の題 → 一行）。
                **マイページの札の中（embedded）では出さない**——札の名前「保存」がそのまま題で、
                同じ語の見出しが中にもう一度出ていた（2026-11-04 判断・棚卸し 11）。
                眉の件数は聞けたときだけ（「まだ」と「0件」を混ぜない） */}
            {!embedded && (
                <ListPageHeader
                    titleId="site-title"
                    eyebrow={pending || failed || n === 0 ? "SAVED" : en ? `SAVED · ${n}` : `SAVED · ${n}枚`}
                    title={en ? "Saved Photos" : "保存した写真"}
                    description={note}
                />
            )}

            {/* 取りに行って失敗した回は、黙って短い一覧を出さない */}
            {failed && n > 0 && (
                <p role="alert" className="mb-4 text-sm text-danger">
                    {en
                        ? "Couldn't load your saved photos. "
                        : "保存した写真を読み込めませんでした。"}
                    <button onClick={saves.retry} className="underline text-white/80 hover:text-white" style={{ minHeight: 44 }}>
                        {en ? "Retry" : "再試行"}
                    </button>
                </p>
            )}

            {pending && n === 0 ? (
                loadingEl
            ) : failed && n === 0 ? (
                // **失敗を「まだありません」と言い換えない。** 失敗の形（何が起きたか → もう一度）だけを出す。
                // 控えを持たない設計なので、ここが普通の経路（`/favorites` は端末の控えがある）
                <div role="alert">
                    <ErrorState
                        message={en
                            ? "Couldn't load your saved photos. Check your connection — some may have been removed."
                            : "保存した写真を読み込めませんでした。通信の状態を確かめるか、消された写真かもしれません"}
                        onRetry={saves.retry}
                        retryLabel={en ? "Retry" : "再試行"}
                        locale={en ? "en" : "ja"}
                        testId="saves-error"
                    />
                </div>
            ) : n === 0 ? (
                // **未ログインには「まだありません」と言わない。** 保存はログインした人の機能なので、
                // 0件なのではなく「まだ使えない」
                !authLoading && !isAuthenticated ? (
                    <EmptyState
                        message={en ? "Log in to keep photos here." : "写真を保存するにはログインしてください。"}
                        // **戻り先を持たせる。** 素の `/login` だと、見に来た棚に戻れない
                        action={{ label: en ? "Log in" : "ログイン", href: loginWithNext(ROUTES.SAVES) }}
                    />
                ) : (
                    <EmptyState
                        message={en
                            ? "No saved photos yet. Tap the bookmark on a photo to save it."
                            : "保存した写真はまだありません。写真の詳細のしおりで保存できます"}
                        action={{ label: en ? "Browse photos" : "写真を見に行く", href: ROUTES.HOME }}
                    />
                )
            ) : (
                // 先頭を大きな1枚に（他の一覧と同じ `editorial`）。埋め込みのときも同じ並び
                <GalleryGrid
                    sizes={EDITORIAL_PAIR_SIZES}
                    heroSizes={EDITORIAL_HERO_SIZES}
                    layout="editorial"
                    priorityCount={3}
                    photos={savedPhotos}
                    locale={locale}
                    categoryDisplayMap={categoryDisplayMap}
                />
            )}

            {/* 札の中は一文を格子の下に（iOS `savedArea` と同じ位置）。0件・読み込み中は出さない */}
            {embedded && n > 0 && (
                <p className="m-0 mt-3 text-text-3" style={{ fontSize: "12px", lineHeight: 1.6 }}>{note}</p>
            )}
        </Root>
    );
}
