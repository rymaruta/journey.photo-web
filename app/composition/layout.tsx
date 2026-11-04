import type { Metadata } from "next";
import { ROUTES } from "../../lib/routes";
import { INDEXABLE_ROBOTS, generateBreadcrumbStructuredData, shareImageUrl, shareOgImage, siteConfig } from "../../lib/utils/seo";

// 構図ガイドは**ログイン不要の公開頁**。page.tsx は "use client" で metadata を持てないので、
// ここ（サーバー部品）で持つ。robots は手書きせず `INDEXABLE_ROBOTS` を引く
// （手書きすると親の googleBot の指定が消える。seo.ts の注記）。
export const COMPOSITION_PATH = "/composition";
const TITLE = "構図ガイド｜ガイド線を自分の写真に重ねて試せる";
const DESCRIPTION =
    "三分割・日の丸・黄金螺旋・対角線など37種類の構図を、ガイド線として自分の写真に重ねて試せます。写真は端末内だけで表示し、アップロードしません。";
const URL = `${siteConfig.url}${COMPOSITION_PATH}`;

export const metadata: Metadata = {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: URL },
    robots: INDEXABLE_ROBOTS,
    openGraph: {
        type: "website",
        locale: siteConfig.locale.ja,
        url: URL,
        siteName: siteConfig.name,
        title: TITLE,
        description: DESCRIPTION,
        images: [shareOgImage()],
    },
    twitter: {
        card: "summary_large_image",
        title: TITLE,
        description: DESCRIPTION,
        images: [shareImageUrl()],
        creator: siteConfig.twitterHandle,
    },
};

export const compositionBreadcrumb = generateBreadcrumbStructuredData([
    { name: "ホーム", url: `${siteConfig.url}${ROUTES.HOME}` },
    { name: "構図ガイド", url: URL },
]);

const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(compositionBreadcrumb) }} />
            {children}
        </>
    );
}
