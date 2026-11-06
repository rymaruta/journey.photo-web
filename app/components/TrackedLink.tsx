"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track, type SelectContentType } from "../../lib/utils/analytics";

/** `href`（文字列）の最後の区切り。クエリ・ハッシュ・末尾の `/` は落とす。`/` だけなら `home` */
export function itemIdFromHref(href: unknown): string {
    if (typeof href !== "string") return "other";
    const path = href.split("#")[0].split("?")[0].replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop();
    return last ? last : "home";
}

/**
 * 押したら GA4 の `select_content` を数えるリンク（記事 → スポット・作例・次の記事。2026-11-04）。
 *
 * 送るのは `content_type` と `item_id`（`href` の最後の区切り＝記事・スポットの slug・写真の id。
 * 2026-11-06 owner「どちらでも」→ 推奨で送る）。形は `lib/utils/analytics.ts` の `ITEM_ID_PATTERN` に合う
 * ものだけ（合わなければそのイベントは送らない）。検索語・クエリ・ハッシュは送らない。
 * 記事の頁は書き出し時に作る側（サーバー側の部品）なので、押す処理だけをここに切り出している。
 */
export default function TrackedLink({ contentType, onClick, ...rest }: ComponentProps<typeof Link> & { contentType: SelectContentType }) {
    return (
        <Link
            prefetch={false}   // 公開ページのリンクは先読みしない（`app/__tests__/linkPrefetch.test.ts`）。渡されれば上書きできる
            {...rest}
            onClick={(e) => {
                track("select_content", { content_type: contentType, item_id: itemIdFromHref(rest.href) });
                onClick?.(e);
            }}
        />
    );
}
