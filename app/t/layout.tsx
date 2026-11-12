import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// 旅行プランへの招待（2026-11-12）。**私的なリンク**なので検索結果に出さない
// （`appPageMetadata` が `robots: { index: false, follow: true }` を付ける）。sitemap にも載せない（`/j` と同じ）
export const metadata: Metadata = appPageMetadata("/t", "旅行プランへのお誘い");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
