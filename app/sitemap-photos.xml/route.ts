import { sitemapGroups, renderUrlset, xmlResponse } from "@/lib/server/sitemap";

export const dynamic = "force-static";

// 種類別のサイトマップ（`/sitemap.xml` が束ねる）。中身は `lib/server/sitemap.ts`
export async function GET() {
    return xmlResponse(renderUrlset((await sitemapGroups()).photos));
}
