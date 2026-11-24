import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
        const attrs: Record<string, unknown> = { ...rest };
        delete attrs.prefetch;
        return <a href={href} {...attrs}>{children}</a>;
    },
}));

import { LocaleProvider } from "../i18n/context";
import SpotIndexClient from "../components/SpotIndexClient";
import type { SpotIndexItem } from "../../lib/data/spotLink";

/**
 * 県の一覧（`/spots/area/<県>`）の最初の画面（2026-11-09・Web 入口ページ監査の案A）。
 * 青森県は21個のカテゴリの札が 390px の画面で6行（約230px）を占め、最初の写真が画面の下端だった。
 * スマホは**横に流す1行**にして、写真が最初の画面に入るようにする。`lg` 以上は広いので折り返す。
 */
const CATS = ["海岸", "山岳", "寺社", "滝", "岬", "温泉", "橋", "湖沼", "史跡", "展望台", "島", "アート"];
const ITEMS = CATS.map((c, i) => ({ slug: `s${i}`, name: `スポット${i}`, category: c, region: "青森県", summary: "あ", stage: "published", cover: null }) as unknown as SpotIndexItem);

describe("県の一覧のカテゴリの札", () => {
    it("スマホは折り返さず横に流す1行（flex-nowrap＋overflow-x-auto）。札は縮めない", () => {
        render(<LocaleProvider><SpotIndexClient spots={ITEMS} area={{ name: "青森県", nameEn: "Aomori" }} /></LocaleProvider>);
        const row = screen.getByTestId("spots-theme-row");
        const c = row.className.split(/\s+/);
        expect(c).toEqual(expect.arrayContaining(["flex", "flex-nowrap", "overflow-x-auto"]));
        // `lg` 以上は従来どおり折り返す
        expect(c).toEqual(expect.arrayContaining(["lg:flex-wrap", "lg:overflow-visible"]));
        // 「すべて」＋カテゴリの全札が行の中に居る（消していない）。縮めない
        const buttons = row.querySelectorAll("button");
        expect(buttons).toHaveLength(CATS.length + 1);
        buttons.forEach((b) => expect(b.className).toContain("shrink-0"));
    });
});
