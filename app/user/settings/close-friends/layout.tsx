import type { Metadata } from "next";
import { appPageMetadata } from "../../../../lib/utils/seo";

// 設定の下の画面（本人だけ・検索結果に出さない。`/user/` は robots の disallow に入っている）
export const metadata: Metadata = appPageMetadata("/user/settings/close-friends", "親しい友達");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
