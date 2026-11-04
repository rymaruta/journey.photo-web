import type { Metadata } from "next";
import { noindexMetadata } from "../../../../lib/utils/seo";

// 1回きりの作業頁。検索結果に出さず、サイトマップにもリンクにも載せない。
export const metadata: Metadata = noindexMetadata("撮影地の一括修正");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
