"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track, type SelectContentType } from "../../lib/utils/analytics";

/**
 * 押したら GA4 の `select_content` を数えるリンク（記事 → スポット・作例・次の記事。2026-11-04）。
 *
 * 送るのは `content_type` だけ。**`item_id`（スポットの slug・写真の id）は送らない**
 * （owner の判断待ち。`lib/utils/analytics.ts` の `EVENT_SPEC`）。
 * 記事の頁は書き出し時に作る側（サーバー側の部品）なので、押す処理だけをここに切り出している。
 */
export default function TrackedLink({ contentType, onClick, ...rest }: ComponentProps<typeof Link> & { contentType: SelectContentType }) {
    return (
        <Link
            prefetch={false}   // 公開ページのリンクは先読みしない（`app/__tests__/linkPrefetch.test.ts`）。渡されれば上書きできる
            {...rest}
            onClick={(e) => {
                track("select_content", { content_type: contentType });
                onClick?.(e);
            }}
        />
    );
}
