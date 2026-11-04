import type { Metadata } from "next";
import { noindexMetadata } from "../../../lib/utils/seo";

// 本人だけが見られる頁。`/saved-spots` と同じ扱い（親の layout は題だけ引き継ぐので、ここでも明示する）
export const metadata: Metadata = noindexMetadata("行きたい場所の地図");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
