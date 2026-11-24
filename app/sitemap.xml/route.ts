import { sitemapGroups, renderSitemapIndex, xmlResponse } from "@/lib/server/sitemap";

export const dynamic = "force-static";

// サイトマップの索引。URL は以前の「全部入り」の `/sitemap.xml` のまま（Search Console の登録を壊さない）。
// 中身は種類別の `/sitemap-<種類>.xml`（`lib/server/sitemap.ts`）
export async function GET() {
    return xmlResponse(renderSitemapIndex(await sitemapGroups()));
}
