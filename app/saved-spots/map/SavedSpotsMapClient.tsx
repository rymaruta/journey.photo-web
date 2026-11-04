"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { usePhotos } from "../../../lib/hooks/usePhotos";
import { useSavedSpots } from "../../../lib/hooks/useSavedSpots";
import { ROUTES, loginWithNext } from "../../../lib/routes";
import { parseSavedKey, dedupeSavedKeys } from "../../../lib/utils/savedSpotKey";
import { photosInCollection } from "../../../lib/utils/collections";
import type { SpotPin } from "../../../lib/data/spotLink";
import PhotoMap, { photosWithCoords, type MapSelection } from "../../components/PhotoMap";
import ListPageHeader from "../../components/ListPageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../components/StateViews";
import MapPhotoSheet from "../../map/MapPhotoSheet";
import MapSpotSheet from "../../map/MapSpotSheet";

/**
 * 行きたい場所を地図で見る（iOS `SavedSpotsMapView`・マイページの「地図で見る」の行き先）。
 *
 * 2026-11-04 判断（札 #478）: 地図の部品は `/map` のもの（`PhotoMap`・各シート）をそのまま使い、
 * **立てるのは保存したものだけ**にする——公式の撮影スポット（座標を持つもの）と、
 * 保存した撮影地の写真（位置情報のあるもの）。サーバーの口は増やさない（一覧は `useSavedSpots` が引く）。
 * 本人だけが見られる頁なので noindex（親の `layout.tsx`）。
 */
export default function SavedSpotsMapClient({ spots }: { spots: readonly SpotPin[] }) {
    const { locale } = useLocale();
    const en = locale === "en";
    const L = en ? "en" : "ja";
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { photos, loaded } = usePhotos();
    const { slugs, pending, failed, retry } = useSavedSpots(isAuthenticated, authLoading);

    const { spotSlugs, locationSlugs } = React.useMemo(() => {
        const spotSet = new Set<string>();
        const locSet: string[] = [];
        for (const key of dedupeSavedKeys(slugs)) {
            const parsed = parseSavedKey(key);
            if (parsed.kind === "spot") spotSet.add(parsed.slug);
            else locSet.push(parsed.slug);
        }
        return { spotSlugs: spotSet, locationSlugs: locSet };
    }, [slugs]);

    const pins = React.useMemo(() => spots.filter((s) => spotSlugs.has(s.slug)), [spots, spotSlugs]);
    const geo = React.useMemo(() => {
        if (locationSlugs.length === 0) return [];
        const byId = new Map<string, (typeof photos)[number]>();
        for (const slug of locationSlugs) {
            for (const p of photosInCollection(photos, "location", slug)) byId.set(p.id, p);
        }
        return photosWithCoords([...byId.values()]);
    }, [photos, locationSlugs]);

    const [selection, setSelection] = React.useState<{ ids: string[]; index: number } | null>(null);
    const [spotSlug, setSpotSlug] = React.useState<string | null>(null);
    const onSelect = React.useCallback((s: MapSelection | null) => {
        setSelection(s ? { ids: s.photos.map((p) => p.id), index: s.index } : null);
        if (s) setSpotSlug(null);
    }, []);
    const onSelectSpot = React.useCallback((slug: string) => { setSpotSlug(slug); setSelection(null); }, []);
    const sheetPhotos = React.useMemo(() => {
        if (!selection) return [];
        const byId = new Map(geo.map((p) => [p.id, p]));
        return selection.ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    }, [selection, geo]);
    const spotSheet = spotSlug ? pins.find((s) => s.slug === spotSlug) ?? null : null;

    const total = pins.length + geo.length;
    const back = (
        <Link href={ROUTES.SAVED_SPOTS} prefetch={false} className="inline-flex items-center gap-1 text-text-2 hover:text-white" style={{ minHeight: 44, fontSize: "13px" }}>
            <ArrowLeftIcon className="w-4 h-4" aria-hidden="true" />
            {en ? "Back to the list" : "一覧にもどる"}
        </Link>
    );

    let body: React.ReactNode;
    if (!authLoading && !isAuthenticated) {
        body = <EmptyState
            message={en ? "Sign in to keep spots you want to visit." : "行きたい場所を残すにはログインしてください。"}
            action={{ label: en ? "Sign in" : "ログイン", href: loginWithNext(ROUTES.SAVED_SPOTS) }} />;
    } else if (pending || (slugs.length > 0 && !loaded && pins.length === 0)) {
        body = <LoadingState kind="rows" locale={L} />;
    } else if (failed) {
        body = <ErrorState message={en ? "Couldn't load your saved spots." : "保存した場所を読み込めませんでした。"}
                           onRetry={retry} retryLabel={en ? "Retry" : "再試行"} locale={L} />;
    } else if (total === 0) {
        body = <EmptyState
            title={en ? "Nothing to show on the map" : "地図に出せる場所がありません"}
            message={en ? "Spots without a location can't be placed on the map." : "位置が分からない場所は、地図に出せません。"}
            action={{ label: en ? "Back to the list" : "一覧にもどる", href: ROUTES.SAVED_SPOTS }} />;
    } else {
        body = (
            <>
                <PhotoMap
                    photos={geo}
                    locale={L}
                    onSelect={onSelect}
                    selectedId={null}
                    sheetOpen={!!selection || !!spotSheet}
                    spots={pins}
                    onSelectSpot={onSelectSpot}
                    selectedSpotSlug={spotSheet?.slug ?? null}
                    className="h-[62vh] min-h-[320px] lg:h-[calc(100vh-260px)] lg:min-h-[480px]"
                />
                {spotSheet && <MapSpotSheet spot={spotSheet} onClose={() => setSpotSlug(null)} locale={L} />}
                {selection && sheetPhotos.length > 0 && (
                    <MapPhotoSheet
                        photos={sheetPhotos}
                        index={selection.index}
                        onIndexChange={(index) => setSelection((s) => (s ? { ...s, index } : s))}
                        onClose={() => setSelection(null)}
                        locale={L}
                    />
                )}
                <p className="text-text-3 mt-3" style={{ fontSize: "12px" }} data-testid="saved-map-count">
                    {en ? `${pins.length} spots · ${geo.length} photos on the map` : `撮影スポット ${pins.length}か所・写真 ${geo.length}枚を地図に出しています`}
                </p>
            </>
        );
    }

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full pb-28">
            {back}
            <ListPageHeader
                titleId="site-title"
                eyebrow="WANT TO GO"
                title={en ? "Want to go, on the map" : "行きたい場所を地図で"}
                description={en ? "Spots you saved, on one map." : "保存した撮影スポットと撮影地を、ひとつの地図で。"}
            />
            {body}
        </main>
    );
}
