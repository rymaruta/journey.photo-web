"use client";

import React from "react";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useAuth } from "../auth/context";
import { useMyServerLikes } from "../../lib/hooks/useMyServerLikes";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { usePhotos } from "../../lib/hooks/usePhotos";
import GalleryGrid from "../components/GalleryGrid";
import { EDITORIAL_HERO_SIZES, EDITORIAL_PAIR_SIZES } from "../components/gridSizes";
import ListPageHeader from "../components/ListPageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import { ROUTES } from "../../lib/routes";
import { useLocale } from "../i18n/context";
import { photoCategoryMap } from "../../lib/utils/categoryMap";

export default function FavoritesPage() {
    const { locale, labels } = useLocale();
    const { favorites } = useFavorites();
    const { preloadMultiple } = useImagePreloader();
    const { photos: allPhotos } = usePhotos();
    const { isAuthenticated, loading: authLoading } = useAuth();
    // **サーバーにも聞く。** 端末の控え（localStorage）だけを見ていたので、
    // スマホで押したいいねを PC で開くと0件だった（同じ写真のページは
    // マーカーを見るので「いいね済み」と出る＝同じアカウントで食い違う）
    const serverLikes = useMyServerLikes(isAuthenticated, authLoading);

    // いいねした写真。**サーバーと端末の和**——サーバーは別の端末のぶんを、
    // 端末は未ログインで押したぶんと、一覧の書き込みが落ちた回を拾う
    const favoritePhotos = React.useMemo(() => {
        const ids = new Set<string>(favorites);
        for (const id of serverLikes.photoIds) ids.add(id);
        return allPhotos.filter((p) => ids.has(p.id));
    }, [favorites, serverLikes.photoIds, allPhotos]);

    // お気に入りの画像をプリロード
    React.useEffect(() => {
        if (favoritePhotos.length > 0) {
            const imageSrcs = favoritePhotos.map(p => p.thumbSrc ?? p.src);
            // 最初の10枚を優先的にプリロード
            preloadMultiple(imageSrcs.slice(0, 10));
        }
    }, [favoritePhotos, preloadMultiple]);

    // **鍵は写真が持っている値そのもの**（読む側 `GalleryGrid` が生の値で
    // 引き、落とし先を持たない）。名前を引くときだけスラッグにする
    // ——理由は `lib/utils/categoryMap.ts` に書いた
    const categoryDisplayMap = React.useMemo(
        () => photoCategoryMap(favoritePhotos, labels.category.names ?? {}),
        [labels, favoritePhotos],
    );

    const en = locale === "en";
    const n = favoritePhotos.length;
    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full">
            {/* 見出しの型は iOS `FavoritesView.header`（眉 → 明朝の題 → 一行）。2026-11-04 判断（札 #478）。
                眉の件数は聞けたときだけ（「まだ」と「0件」を混ぜない） */}
            <ListPageHeader
                titleId="site-title"
                eyebrow={serverLikes.pending || n === 0 ? "LIKED" : en ? `LIKED · ${n}` : `LIKED · ${n}枚`}
                title={en ? "Liked Photos" : "いいねした写真"}
                description={en
                    ? "Photos you liked. The photographer is notified, and the same list appears on your other devices and the web. Bookmarked photos are under Saved on your page."
                    : "ハートを押した写真。作者に届き、ほかの端末や Web でも同じ一覧が見られます。しおりで保存した写真はマイページの「保存」に。"}
            />

            {/* 取りに行って失敗した回は、黙って短い一覧を出さない
                （端末の控えぶんは出るので、足りていないことだけ伝える） */}
            {serverLikes.failed && n > 0 && (
                <p role="alert" className="mb-4 text-sm text-danger">
                    {en
                        ? "Couldn't load the likes saved on your account. Some photos may be missing. "
                        : "アカウントに保存されたいいねを読み込めませんでした。表示されていない写真があるかもしれません。"}
                    <button onClick={serverLikes.retry} className="underline text-white/80 hover:text-white" style={{ minHeight: 44 }}>
                        {en ? "Retry" : "再試行"}
                    </button>
                </p>
            )}

            {serverLikes.pending && n === 0 ? (
                // 読み込み中は格子の灰の骨格（iOS `JPLoadingState(kind: .grid)`・0.3 秒より早ければ出さない）
                <LoadingState kind="grid" locale={en ? "en" : "ja"} />
            ) : n === 0 && serverLikes.failed ? (
                <div role="alert">
                    <ErrorState
                        message={en ? "Couldn't load your liked photos. Check your connection." : "いいねした写真を読み込めませんでした。通信の状態を確かめてください"}
                        onRetry={serverLikes.retry}
                        retryLabel={en ? "Retry" : "再試行"}
                        locale={en ? "en" : "ja"}
                    />
                </div>
            ) : n === 0 ? (
                <EmptyState
                    message={en ? "No liked photos yet" : "まだいいねした写真がありません"}
                    action={{ label: en ? "Browse photos" : "写真を見に行く", href: ROUTES.HOME }}
                />
            ) : (
                // 先頭を大きな1枚に（iOS は高さ 280 の先頭＋3列。Web は他の一覧と同じ `editorial`：大きく1枚 → 2枚ずつ）
                <GalleryGrid
                    sizes={EDITORIAL_PAIR_SIZES}
                    heroSizes={EDITORIAL_HERO_SIZES}
                    layout="editorial"
                    priorityCount={3}
                    photos={favoritePhotos}
                    locale={locale}
                    categoryDisplayMap={categoryDisplayMap}
                />
            )}
        </main>
    );
}
