import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * **配線を縛る。** 台帳でいちばん繰り返している失敗が
 * 「関数は書いたが渡していない」。`initialBio` を受け取る側だけ直しても、
 * `page.tsx` が渡さなければ静的本文には1文字も出ない。
 */
const profiles = vi.hoisted(() => ({ current: {} as Record<string, { bio?: string; username?: string }> }));
vi.mock("../../../data/profiles.json", () => ({ default: profiles.current }));
// 受け取った値をそのまま描く偽物（本物は API を叩く）
vi.mock("../../UserProfileClient", () => ({
    default: ({ initialBio, initialUsername }: { initialBio?: string; initialUsername?: string }) => (
        <>
            <div data-testid="client">{initialBio ?? "(渡っていない)"}</div>
            <div data-testid="client-username">{initialUsername ?? "(渡っていない)"}</div>
        </>
    ),
}));

const UserProfilePage = (await import("../page")).default;

beforeEach(() => { for (const k of Object.keys(profiles.current)) delete profiles.current[k]; });

const OWNER = "67d49a68-80f1-7083-b0e0-c767886ef868";

describe("静的なプロフィールページが、自己紹介を本文へ渡す", () => {
    it("ビルド時の自己紹介をそのまま渡す", async () => {
        profiles.current[OWNER] = { bio: "旅先の光を追いかけて写真を撮っています。" };
        render(await UserProfilePage({ params: Promise.resolve({ id: OWNER }) }));
        expect(screen.getByTestId("client").textContent).toBe("旅先の光を追いかけて写真を撮っています。");
    });

    // **改行は落とさない。** 画面は `whitespace-pre-wrap` で出すので、
    // ここで1行に均すと段落が消える（1行に均すのはメタ情報だけ）
    it("改行をそのまま渡す", async () => {
        profiles.current[OWNER] = { bio: "一行目。\n二行目。" };
        render(await UserProfilePage({ params: Promise.resolve({ id: OWNER }) }));
        expect(screen.getByTestId("client").textContent).toBe("一行目。\n二行目。");
    });

    it("自己紹介が無ければ空で渡す", async () => {
        render(await UserProfilePage({ params: Promise.resolve({ id: OWNER }) }));
        expect(screen.getByTestId("client").textContent).toBe("");
    });

    it("前後の空白は落とす", async () => {
        profiles.current[OWNER] = { bio: "  自己紹介  " };
        render(await UserProfilePage({ params: Promise.resolve({ id: OWNER }) }));
        expect(screen.getByTestId("client").textContent).toBe("自己紹介");
    });
});

// 2026-11-11 journey.photo-ios#525: `@ユーザー名` を最初の HTML に出す配線
describe("静的なプロフィールページが、ユーザー名を本文へ渡す", () => {
    it("ビルド時のユーザー名を渡す", async () => {
        profiles.current[OWNER] = { username: "ryuhei" };
        render(await UserProfilePage({ params: Promise.resolve({ id: OWNER }) }));
        expect(screen.getByTestId("client-username").textContent).toBe("ryuhei");
    });

    it("決まりに合わないユーザー名は渡さない", async () => {
        profiles.current[OWNER] = { username: "<b>x</b>" };
        render(await UserProfilePage({ params: Promise.resolve({ id: OWNER }) }));
        expect(screen.getByTestId("client-username").textContent).toBe("(渡っていない)");
    });

    it("構造化データの Person に @ユーザー名 を別名で出す", async () => {
        profiles.current[OWNER] = { username: "ryuhei" };
        const { container } = render(await UserProfilePage({ params: Promise.resolve({ id: OWNER }) }));
        const ld = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
        expect([ld.mainEntity.alternateName].flat()).toContain("@ryuhei");
    });
});
