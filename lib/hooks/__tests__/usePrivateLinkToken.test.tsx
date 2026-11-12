import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// 私的なリンクの合図（`/j?t=`・`/qr?t=`）を開いたらすぐ URL から外し、合図は state に持つ（2026-11-12・札 journey.photo-ios#545）

const params = vi.hoisted(() => ({ current: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => params.current }));

const { usePrivateLinkToken } = await import("../usePrivateLinkToken");

function Probe() {
    const token = usePrivateLinkToken();
    return <p data-testid="token">{token}</p>;
}

const TOKEN = "Ab3_x-9ZqAb3_x-9ZqAb3_x-9ZqAb3_x";

beforeEach(() => {
    window.history.replaceState({ keep: 1 }, "", `/qr?t=${TOKEN}&from=line#top`);
    params.current = new URLSearchParams(`t=${TOKEN}&from=line`);
});
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("usePrivateLinkToken", () => {
    it("開いたら t だけを URL から外し、ほかのクエリ・#・history.state は残す", () => {
        render(<Probe />);
        expect(window.location.pathname).toBe("/qr");
        expect(window.location.search).toBe("?from=line");
        expect(window.location.hash).toBe("#top");
        expect(window.history.state).toEqual({ keep: 1 });
        expect(window.location.href).not.toContain(TOKEN);
    });

    it("URL から外したあとも（Next が useSearchParams を空にしても）合図は持ち続ける", () => {
        const { rerender } = render(<Probe />);
        params.current = new URLSearchParams("from=line");
        rerender(<Probe />);
        expect(screen.getByTestId("token").textContent).toBe(TOKEN);
    });

    it("t が無ければ URL に触らない", () => {
        window.history.replaceState(null, "", "/qr?from=x");
        params.current = new URLSearchParams("from=x");
        const spy = vi.spyOn(window.history, "replaceState");
        render(<Probe />);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
