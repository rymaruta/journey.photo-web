// app/today/PrefChips.tsx（サーバーコンポーネント）
//
// **47県のリンク**（地方ごと）。/today の下と、各県の頁の下の「ほかの県」で使う。
// JavaScript が無くても辿れる（位置情報が断られたときの行き先でもある）。

import Link from "next/link";
import { PREFECTURES, REGIONS } from "@/lib/data/prefectures";
import { ROUTES } from "@/lib/routes";
import { shortPrefName } from "@/lib/data/todayPlaces";
import { CHIP_OFF, CHIP_SIZE, CHIP_HIT, CHIP_ROW } from "@/app/components/chipStyles";

export default function PrefChips({ currentSlug, headingLevel = 3 }: { currentSlug?: string; headingLevel?: 3 | 4 }) {
    const H = `h${headingLevel}` as "h3" | "h4";
    return (
        <div data-testid="today-pref-links">
            {REGIONS.map((region) => {
                const prefs = PREFECTURES.filter((p) => p.region === region && p.slug !== currentSlug);
                if (prefs.length === 0) return null;
                return (
                    <div key={region} className="mb-4">
                        <H className="m-0 mb-2 font-semibold text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>{region}</H>
                        <ul className={CHIP_ROW} style={{ listStyle: "none" }}>
                            {prefs.map((p) => (
                                <li key={p.slug}>
                                    <Link href={ROUTES.TODAY_PREF(p.slug)} prefetch={false}
                                          className={`${CHIP_HIT} inline-flex items-center rounded-full ${CHIP_OFF} transition-colors`}
                                          style={CHIP_SIZE}>
                                        {shortPrefName(p)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}
