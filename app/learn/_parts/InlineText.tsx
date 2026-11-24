// app/learn/_parts/InlineText.tsx
//
// 教科書の本文の文字列を描く。`[見える文字](/spots/…)` をサイトの中のリンクにする（`lib/learn/inlineLinks.ts`・2026-11-11 #527）。
// 見た目は教科書のほかのリンク（「次に読む」など）と同じ真鍮の下線（黒地の上・板の決まり）。

import React from "react";
import TrackedLink from "@/app/components/TrackedLink";
import { inlineSegments } from "@/lib/learn/inlineLinks";

export default function InlineText({ text }: { text: string }) {
    return (
        <>
            {inlineSegments(text).map((s, i) =>
                typeof s === "string"
                    ? <React.Fragment key={i}>{s}</React.Fragment>
                    : (
                        <TrackedLink key={i} contentType={s.href.startsWith("/spots") ? "spot" : "article"} href={s.href} prefetch={false}
                                     className="text-accent underline underline-offset-4 hover:text-accent-strong"
                                     data-testid="learn-inline-link">
                            {s.label}
                        </TrackedLink>
                    ))}
        </>
    );
}
