import type { Metadata } from "next";
import Link from "next/link";
import SpotAreaIndexClient from "@/app/components/SpotAreaIndexClient";
import { SPOTS } from "@/lib/data/spots";
import { spotAreas } from "@/lib/data/spotLink";
import { visibleSpots, publishableSpots } from "@/lib/utils/spotGuide";
import { siteConfig, pageRobots, shareOgImage } from "@/lib/utils/seo";
import { spotAreaItemList } from "@/lib/data/spotSeo";
import { spotCheckedClaim } from "@/lib/data/spotPageMeta";
import { spotIndexTopics, firstSpotOgImage, spotTwitterMeta } from "@/lib/data/spotTopics";
import { TopicChips, Lang } from "@/app/components/SpotTopicLists";
import SectionHead, { SectionTitle } from "@/app/components/SectionHead";
import { ROUTES } from "@/lib/routes";
import { spotIndexPhotos } from "@/lib/data/spotIndexPhotos";
import type { TopicLink } from "@/lib/data/spotTopics";
import type { ReactNode } from "react";
import TopicFold from "@/app/components/TopicFold";

/**
 * **撮影地ガイドの入口。**
 *
 * `/location`（写真から作る撮影地の索引）とは別の面。あちらは維持する。
 *
 * **人が確かめたスポットが少ないうちは索引に載せない**——名前が数個並ぶだけの
 * ページを検索に出しても、見た人の役に立たない（`/location` の索引が
 * `isIndexableCollectionIndex` で同じ判断をしている）。**下書き（review）は
 * 件数に数えない**——運営未確認の一覧を検索の着地点にしない。
 */
const MIN_INDEXABLE_SPOTS = 3;

export async function generateMetadata(): Promise<Metadata> {
    const n = visibleSpots(SPOTS).length;
    const verified = publishableSpots(SPOTS).length;
    const areas = spotAreas().length;
    const title = "撮影スポットをさがす";
    const og = firstSpotOgImage(publishableSpots(SPOTS), title);
    // 件数に「運営が調べた」と読める形で数えるのは、人が確かめた行だけ
    const description = n > 0
        ? (verified >= MIN_INDEXABLE_SPOTS
            ? `写真を撮りに行ける場所のガイド（${areas}地域・${verified}件${n > verified ? `・ほかに下書き${n - verified}件` : ""}）。見どころと、月ごとの日の出・日の入りなど撮影の光まで。${spotCheckedClaim(visibleSpots(SPOTS))}`
            : `写真を撮りに行ける場所のガイドの下書き（${areas}地域・${n}件）。運営がまだ確認していない情報を含みます。`)
        : "写真を撮りに行ける場所のガイド。";
    return {
        title,
        description,
        alternates: { canonical: `${siteConfig.url}/spots` },
        robots: pageRobots(verified >= MIN_INDEXABLE_SPOTS),
        openGraph: {
            type: "website", url: `${siteConfig.url}/spots`, siteName: siteConfig.name, title, description,
            // 子の `openGraph` は親（レイアウト）の画像ごと置き換えるので、ここで渡す（2026-10-16・絵が無かった）
            // 写真が無ければサイトの固定の代表画像（2026-10-31 #432）
            images: [og ?? shareOgImage()],
        },
        // og:image と同じ1枚（レイアウトの新着写真を残さない・2026-10-22）
        twitter: spotTwitterMeta(title, description, og?.url),
    };
}

export default function SpotIndexPage() {
    // 🔴 **スポットそのものを渡さない。** クライアント部品への props は HTML に
    // 埋め込まれるので、渡したぶんが訪問のたびに落ちる。ここが渡すのは
    // **県の名前と件数だけ**で、47県でも3KBに満たない
    // （実測は `lib/data/spotLink.ts` の `SpotArea` の注記）
    const total = visibleSpots(SPOTS).length;
    const areas = spotAreas();
    // 地方の下の「ほかの切り口」へ飛ぶ近道は、実際に描くときだけ（`SpotIndexTopicSections` と同じ条件・2026-11-09）。
    // 2026-11-10 案A: 季節・市区町村・テーマは1つの節の開け閉めの段に畳んだので、行き先はその節の見出し1つ
    const topics = spotIndexTopics();
    const topicsShown = topics.seasons.length > 0 || topics.themes.length > 0;
    const jumps = topicsShown ? [{ id: "spots-more", label: "ほかの切り口", labelEn: "More ways" }] : [];
    // 写真の札（県の代表写真・国・いまの季節・出典）。渡すのは写真の場所と出典だけ（`spotIndexPhotos` の注記）
    //
    // 2026-11-10 判断（確かめ役の指摘 3「出典が HTML に2回」への答え・実測）: 出典は HTML の本文と水和用のデータ（RSC）に
    // 1回ずつ乗るが、これは App Router ではどちらの描き方でも同じ。**頁の下の「写真の出典」をサーバー側で描いて children で
    // 渡す形を試すと、/spots は重くなった**——HTML（gzip）50,493 → 53,307 B・RSC（gzip）21,902 → 24,856 B。水和用のデータが
    // 出典の値（66 件）ではなく、項目ごとの要素の木（li・p・span の class と style）を運ぶため。だから値を props で渡す今の形のまま
    const photos = spotIndexPhotos(new Date());
    return (
        <>
            {/* **一覧の構造化データ（ItemList）。** 画面に並べている地域のリンク
                （`/spots/area/<slug>`）と同じものを同じ順で渡す——画面に無いもの
                （個々のスポット）は載せない。0件なら出さない */}
            {areas.length > 0 && (
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(spotAreaItemList(areas)) }} />
            )}
            <SpotAreaIndexClient areas={areas} total={total} draftCount={total - publishableSpots(SPOTS).length} jumps={jumps} photos={photos}>
                <SpotIndexTopicSections />
            </SpotAreaIndexClient>
        </>
    );
}

/** JSON-LD を `<script>` に埋める形（`SpotGuidePage.tsx` と同じ。`</script>` で閉じられないように） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");


/**
 * **季節・テーマの切り口への入口**（2026-10-11）。県の一覧の下に置く。
 * 海外の国は「海外」の区画（`/spots/area/overseas`＝国の一覧）から辿る。
 * サーバーで描くので、切り口の一覧はクライアントの props に乗らない（HTML の本文だけ）。
 *
 * 2026-11-10（札 rymaruta/journey.photo-ios#516 の案A・owner 承認）: 文字の札が頁の 4 分の 3 を占めていた
 * （電話で 13,568px）ので、**同じ頁の中の開け閉めの段に畳む**。リンクは全部 HTML に残し、URL は変えない
 */
function SpotIndexTopicSections() {
    const { seasons, themes, seasonThemes, cities, momiji, sakura, snow } = spotIndexTopics();
    if (seasons.length === 0 && themes.length === 0) return null;
    const features: Array<{ id: string; title: ReactNode; links: TopicLink[] }> = [
        { id: "spots-sakura", title: <Lang ja="桜の撮影スポット" en="Cherry blossom photo spots" />, links: sakura },
        { id: "spots-momiji", title: <Lang ja="紅葉の撮影スポット" en="Autumn foliage photo spots" />, links: momiji },
        { id: "spots-snow", title: <Lang ja="雪景色の撮影スポット" en="Snow scenery photo spots" />, links: snow },
    ].filter((f) => f.links.length > 0);
    const featureCount = features.reduce((n, f) => n + f.links.length, 0);
    return (
        <section className="mb-7" data-testid="spots-topic-index">
            <SectionHead id="spots-more" eyebrow="MORE" title={<Lang ja="ほかの切り口でさがす" en="More ways to find spots" />} />
            <div className="border-t border-line">
                {seasons.length > 0 && (
                    <TopicFold id="spots-by-season" title={<Lang ja="季節" en="Season" />} count={seasons.length}>
                        <TopicChips links={seasons} />
                    </TopicFold>
                )}
                {features.length > 0 && (
                    <TopicFold id="spots-features" title={<Lang ja="桜・紅葉・雪景色" en="Cherry blossoms, foliage, snow" />} count={featureCount}>
                        {features.map((f) => (
                            <div key={f.id} className="mb-3">
                                <SectionTitle as="h3" id={f.id}>{f.title}</SectionTitle>
                                <TopicChips links={f.links} />
                            </div>
                        ))}
                    </TopicFold>
                )}
                {seasonThemes.length > 0 && (
                    <TopicFold id="spots-by-season-theme" title={<Lang ja="季節 × 種類" en="Season and type" />} count={seasonThemes.length}>
                        <TopicChips links={seasonThemes} />
                    </TopicFold>
                )}
                {cities.length > 0 && (
                    <TopicFold id="spots-by-city" title={<Lang ja="市区町村" en="City" />} count={cities.length}>
                        <TopicChips links={cities} />
                    </TopicFold>
                )}
                {themes.length > 0 && (
                    <TopicFold id="spots-by-theme" title={<Lang ja="テーマ" en="Theme" />} count={themes.reduce((n, g) => n + g.links.length, 0)}>
                        {themes.map((g) => (
                            <div key={g.category} className="mb-3">
                                <SectionTitle as="h3"><Lang ja={g.category} en={g.categoryEn} /></SectionTitle>
                                <TopicChips links={g.links} />
                            </div>
                        ))}
                    </TopicFold>
                )}
                <SpotIndexTodayEntry />
            </div>
        </section>
    );
}

/**
 * **「今日の日の出・日の入り」への入口**（2026-11-07）。撮影に向く時間帯を日付で見る頁（`/today`）。
 * 県庁所在地の市付近の座標から計算した目安で、現在地でも調べられる。
 * 2026-11-10: 「ほかの切り口」の段と同じ行の形（52・題 15・右に ›）にした（開け閉めは無く、そのまま頁へ）
 */
function SpotIndexTodayEntry() {
    return (
        <Link href={ROUTES.TODAY} prefetch={false} data-testid="spots-today-entry"
              className="flex items-center justify-between gap-3 min-h-[52px] border-b border-line text-white hover:bg-white/5 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent rounded"
              style={{ fontSize: "15px", lineHeight: "20px" }}>
            <span className="min-w-0">
                <Lang ja="今日の日の出・日の入り" en="Today's sunrise and sunset" />
                <span className="block text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>
                    <Lang ja="朝夕のゴールデンアワーも。現在地か県を選んで調べられます" en="With golden hours. Pick your location or a prefecture" />
                </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-text-2" style={{ fontSize: "17px" }}>›</span>
        </Link>
    );
}
