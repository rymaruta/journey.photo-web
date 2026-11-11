import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// ページは "use client" なので metadata をここで持つ。意見を送る頁は検索結果に出さない（札 #546）
export const metadata: Metadata = appPageMetadata("/feedback", "意見を送る");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
