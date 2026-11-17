"use client";

import { useEffect } from "react";
import { track } from "@/lib/utils/analytics";

const TARGETS = ["brand_official", "camera_examples", "camera_basics", "brand_jump"] as const;
type Target = (typeof TARGETS)[number];

/**
 * 記事のリンク導線だけを集計する。閲覧・スクロールは送らず、クリック時だけ。
 * メーカー名・URL・閲覧者の識別情報はGA4に送らない。
 */
export default function CameraBrandsAnalytics() {
    useEffect(() => {
        const root = document.querySelector('[data-testid="learn-brands"]');
        if (!root) return;
        const onClick = (event: Event) => {
            if (!(event.target instanceof Element)) return;
            const link = event.target.closest("a[data-learn-target]");
            if (!link || !root.contains(link)) return;
            const value = link.getAttribute("data-learn-target");
            if (!TARGETS.some((target) => target === value)) return;
            track("learn_link_click", { article: "camera_brands", target: value as Target });
        };
        root.addEventListener("click", onClick);
        return () => root.removeEventListener("click", onClick);
    }, []);
    return null;
}
