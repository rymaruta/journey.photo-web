import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../music/MusicContext", () => ({
    useMusic: () => ({ queueKey: "bgm:u1", index: 0, playing: false, play: vi.fn(), next: vi.fn(), prev: vi.fn(), getAudio: () => null }),
}));
vi.mock("../SmoothProgress", () => ({ default: () => null }));
const MusicCard = (await import("../MusicCard")).default;

/** マイBGM の曲の頁へのリンクは利用者が選んだもの。`ugc nofollow` を付ける（2026-11-25） */
const SONG = { title: "LADY", artist: "米津玄師", previewUrl: "https://audio-ssl.itunes.apple.com/a.m4a", trackUrl: "https://music.apple.com/jp/album/x/1?i=2" };

describe("マイBGM の曲のリンク", () => {
    it.each([["札の行", true], ["カード", false]])("%s: rel に ugc と nofollow", (_name, row) => {
        render(<MusicCard queueKey="bgm:u1" songs={[SONG]} label="マイBGM" locale="ja" row={row} />);
        const link = screen.getByText("LADY").closest("a")!;
        expect(link.getAttribute("href")).toBe(SONG.trackUrl);
        const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
        for (const r of ["ugc", "nofollow", "noopener", "noreferrer"]) expect(rel, r).toContain(r);
    });
});
