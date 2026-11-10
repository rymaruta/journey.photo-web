import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVENT_SPEC, NAV_AREAS, NAV_DESTS, APP_STORE_PLACEMENTS, sanitizeParams, track } from "../analytics";
import { isSpotDetailPath, pageHasOwnAppCard, SPOTS_RESERVED_SEGMENTS } from "../spotDetailPath";

/** 入口の計測 `nav_click`（2026-11-09・提案書の節5）。area と dest だけ・自由な文字列は通さない */
describe("nav_click の仕様", () => {
    it("EVENT_SPEC に1行: area と dest の2欄だけ", () => {
        expect(Object.keys(EVENT_SPEC.nav_click).sort()).toEqual(["area", "dest"]);
        expect(EVENT_SPEC.nav_click.area).toBe(NAV_AREAS);
        expect(EVENT_SPEC.nav_click.dest).toBe(NAV_DESTS);
    });

    it("area は header / menu / tab / footer / spot_next / home_entry", () => {
        expect([...NAV_AREAS]).toEqual(["header", "menu", "tab", "footer", "spot_next", "home_entry"]);
    });

    it("app_store_click の placement に spot_detail がある（既存の値も残る）", () => {
        expect([...APP_STORE_PLACEMENTS]).toEqual(["footer", "banner", "article", "home", "spot_detail"]);
        expect(sanitizeParams("app_store_click", { placement: "spot_detail" })).toEqual({ placement: "spot_detail" });
    });

    it("表の値だけ通す。範囲外・欠け・余計な欄（URL・slug・検索語）は落ちる", () => {
        expect(sanitizeParams("nav_click", { area: "tab", dest: "login", href: "/login", q: "五稜郭" })).toEqual({ area: "tab", dest: "login" });
        expect(sanitizeParams("nav_click", { area: "sidebar", dest: "login" })).toBeNull();
        expect(sanitizeParams("nav_click", { area: "tab", dest: "/spots/goryokaku" })).toBeNull();
        expect(sanitizeParams("nav_click", { area: "tab" })).toBeNull();
    });

    it("dest に map_pref（ホームの日本地図→県の頁）を許す。県の名前は通さない", () => {
        expect(NAV_DESTS).toContain("map_pref");
        expect(sanitizeParams("nav_click", { area: "home_entry", dest: "map_pref" })).toEqual({ area: "home_entry", dest: "map_pref" });
        expect(sanitizeParams("nav_click", { area: "home_entry", dest: "kanagawa" })).toBeNull();
    });

    it("dest に地図の操作（map_pref_select）を許す。仕様に無い map_sheet_open・map_spot は通さない。県名・スポットの slug は通さない", () => {
        expect(NAV_DESTS).toContain("map_pref_select");
        expect(sanitizeParams("nav_click", { area: "home_entry", dest: "map_pref_select" })).toEqual({ area: "home_entry", dest: "map_pref_select" });
        for (const dest of ["map_sheet_open", "map_spot"]) {
            expect(NAV_DESTS).not.toContain(dest);
            expect(sanitizeParams("nav_click", { area: "home_entry", dest })).toBeNull();
        }
        expect(sanitizeParams("nav_click", { area: "home_entry", dest: "map_pref_kanagawa" })).toBeNull();
        expect(sanitizeParams("nav_click", { area: "home_entry", dest: "map_spot_tokyo-tower" })).toBeNull();
    });

    it("track は gtag に nav_click を送り、範囲外なら送らない", () => {
        const gtag = vi.fn();
        (window as unknown as { gtag?: unknown }).gtag = gtag;
        sessionStorage.clear();
        track("nav_click", { area: "header", dest: "login" });
        track("nav_click", { area: "x", dest: "login" } as never);
        const sent = gtag.mock.calls.filter((c) => c[1] === "nav_click");
        expect(sent).toHaveLength(1);
        expect(sent[0][2]).toEqual(expect.objectContaining({ area: "header", dest: "login" }));
    });
});

describe("撮影スポット詳細のパス", () => {
    beforeEach(() => {});
    it("/spots/<slug> だけが詳細。一覧・県・季節・テーマ・予約語は違う", () => {
        expect(isSpotDetailPath("/spots/goryokaku")).toBe(true);
        expect(isSpotDetailPath("/spots/goryokaku/")).toBe(true);
        for (const p of ["/spots", "/spots/", "/spots/area/hokkaido", "/spots/season/spring", "/spots/theme/castle/hokkaido", "/spots/momiji", "/spots/sakura", "/spots/snow", "/spots/city/tokyo/x", "/", "/learn", null, undefined]) {
            expect(isSpotDetailPath(p), String(p)).toBe(false);
        }
    });

    it("予約語は app/spots の下のディレクトリと一致する（道を足したのに更新を忘れない）", () => {
        const dir = resolve(__dirname, "../../../app/spots");
        const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("[")).map((d) => d.name).sort();
        expect([...SPOTS_RESERVED_SEGMENTS].sort()).toEqual(names);
    });
});

describe("入口の文言の禁止語", () => {
    it("新しく書いた入口の部品に「撮りどき」「この場所」「注目スポット」を書かない", () => {
        const files = ["HomeEntryBand.tsx", "SpotNext.tsx"].map((f) => readFileSync(resolve(__dirname, "../../../app/components", f), "utf8"));
        for (const src of files) {
            const strings = src.match(/"[^"\n]*[ぁ-んァ-ヶ一-龠][^"\n]*"/g) ?? [];
            for (const w of ["撮りどき", "この場所", "注目スポット"]) expect(strings.join("\n"), w).not.toContain(w);
        }
    });
});

// 2026-11-10 札 #515: 本文に自分のアプリの札がある頁（フッターの札を出さない頁）
describe("pageHasOwnAppCard", () => {
    it("ホームと撮影スポット詳細だけ", () => {
        for (const p of ["/", "/spots/goryokaku", "/spots/goryokaku/"]) expect(pageHasOwnAppCard(p), p).toBe(true);
        for (const p of ["/spots", "/spots/sakura", "/spots/area/hokkaido", "/search", "/learn", "/terms", "", null, undefined]) {
            expect(pageHasOwnAppCard(p), String(p)).toBe(false);
        }
    });
});

