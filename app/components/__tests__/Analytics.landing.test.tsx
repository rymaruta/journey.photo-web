import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { LANDING_STORAGE_KEY } from "../../../lib/utils/landingType";

// 最初に着地した頁の種類の記録（2026-11-04）。GA4 のタグが出る環境でだけ、語1つを sessionStorage に書く
const cfg = vi.hoisted(() => ({ gaId: "G-TEST", plausibleDomain: "" }));
vi.mock("../../../lib/utils/seo", () => ({ siteConfig: cfg }));
vi.mock("next/script", () => ({ default: () => null }));

const Analytics = (await import("../Analytics")).default;

beforeEach(() => { sessionStorage.clear(); cfg.gaId = "G-TEST"; cfg.plausibleDomain = ""; });

describe("Analytics: landing_type の記録", () => {
    it("タグが出る環境では、最初の頁の種類を書く", () => {
        window.history.replaceState({}, "", "/learn/camera-basics");
        render(<Analytics />);
        expect(sessionStorage.getItem(LANDING_STORAGE_KEY)).toBe("learn");
    });

    it("後から別の頁で描き直しても、最初の値のまま", () => {
        window.history.replaceState({}, "", "/composition");
        render(<Analytics />);
        window.history.replaceState({}, "", "/spots/x");
        render(<Analytics />);
        expect(sessionStorage.getItem(LANDING_STORAGE_KEY)).toBe("composition");
    });

    it("GA4 の ID が空（開発・staging）なら何も書かない", () => {
        cfg.gaId = "";
        window.history.replaceState({}, "", "/learn");
        render(<Analytics />);
        expect(sessionStorage.getItem(LANDING_STORAGE_KEY)).toBeNull();
    });

    it("Plausible を使う設定でも書かない（GA4 を出さないため）", () => {
        cfg.plausibleDomain = "journey-photo.com";
        window.history.replaceState({}, "", "/learn");
        render(<Analytics />);
        expect(sessionStorage.getItem(LANDING_STORAGE_KEY)).toBeNull();
    });
});
