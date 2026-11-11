import type { Metadata } from "next";
import { ROUTES } from "../../lib/routes";
import { INDEXABLE_ROBOTS, shareImageUrl, shareOgImage, siteConfig } from "../../lib/utils/seo";

// 撮影スポットを払う（`/swipe`・2026-11-11）。**ログイン不要の公開頁で、検索に出す**（題と説明を持つ。
// 頁の頭の見出しと説明は静的な HTML に入る・札の山は画面が `/app/data/swipe.json` から読む）。
// robots は手書きせず `INDEXABLE_ROBOTS` を引く（手書きすると親の googleBot の指定が消える・seo.ts の注記）
const SWIPE_TITLE = "写真を払って、行きたい場所を探す";
const SWIPE_DESCRIPTION =
    "撮影スポットの写真を1枚ずつ見て、右へ払うと行きたい、左へ払うと見送る。ログインなしではじめられ、選んだ場所は地図と旅行プランで見られます。";
const URL = `${siteConfig.url}${ROUTES.SWIPE}`;

export const metadata: Metadata = {
    title: SWIPE_TITLE,
    description: SWIPE_DESCRIPTION,
    alternates: { canonical: URL },
    robots: INDEXABLE_ROBOTS,
    openGraph: {
        type: "website",
        locale: siteConfig.locale.ja,
        url: URL,
        siteName: siteConfig.name,
        title: SWIPE_TITLE,
        description: SWIPE_DESCRIPTION,
        images: [shareOgImage()],
    },
    twitter: {
        card: "summary_large_image",
        title: SWIPE_TITLE,
        description: SWIPE_DESCRIPTION,
        images: [shareImageUrl()],
        creator: siteConfig.twitterHandle,
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
