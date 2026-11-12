import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// プロフィールの QR（札 journey.photo-ios#545）の着地点。**私的なリンク**なので検索結果に出さない
// （`appPageMetadata` が noindex を付ける・`robots.ts` でもクロールさせない）。sitemap にも載せない
export const metadata: Metadata = appPageMetadata("/qr", "プロフィールの QR コード");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
