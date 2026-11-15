import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// スマホ（640px 未満）の拡大表示は、枠ごと1本でスクロールする（2026-11-15 owner「文章だけスクロールできて、
// 写真だけ固定なので見づらい」）。写真は上へ流れ、文章は箱の中ではなく頁として流れる。
// 実際の高さ・スクロールの量は Playwright で測った（PR 本文）。ここは、それを決めるクラスと分岐を縛る。

vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    userPublicFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ likes: 0 }) }),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
vi.mock("../../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import GalleryModal from "../index";
import { phoneImageHeight } from "@/lib/utils/modalLayout";
import type { Photo } from "@/lib/data/photos";

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn.example.com/uploads/u1/${id}.jpg`,
    title: { ja: "写真", en: "Photo" }, tags: [], likes: 0,
    description: { ja: ["一段落目", "二段落目"] } as Photo["description"],
    ...extra,
});

let onClose: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => { onClose = vi.fn<() => void>(); });

function setup(p: Photo = photo("p1", { width: 1600, height: 1200 })) {
    return render(
        <GalleryModal photos={[p, photo("p2")]} currentIndex={0}
            onClose={onClose} onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />,
    );
}

/** 写真の上で、下へ 200px 払う（閉じる形） */
function swipeDownOnPhoto() {
    const area = screen.getByTestId("gallery-modal-image-area").firstElementChild as HTMLElement;
    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(area, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 100, clientY: 300 }] });
}

describe("スマホの拡大表示は1本でスクロールする", () => {
    it("枠がスマホでスクロールし、640px 以上は今までどおり切る", () => {
        setup();
        const frame = screen.getByTestId("gallery-modal-frame");
        expect(frame.className).toContain("max-sm:overflow-y-auto");
        expect(frame.className).toContain("overflow-hidden");
    });

    it("文章の箱はスマホで高さを縛らず、中でスクロールしない（上限・下限は 640px 以上だけ）", () => {
        setup();
        const caption = screen.getByText("一段落目").closest("div.flex-shrink-0") as HTMLElement;
        expect(caption.style.maxHeight).toBe("");
        expect(caption.style.minHeight).toBe("");
        expect(caption.className).not.toMatch(/(^|\s)overflow-y-auto/);
        expect(caption.className).toContain("sm:overflow-y-auto");
        expect(caption.className).toContain("sm:max-h-[var(--gm-cap-max)]");
    });

    it("写真の高さはスマホで縦横比から（640px 以上は 60dvh）", () => {
        setup();
        const area = screen.getByTestId("gallery-modal-image-area");
        expect(area.style.height).toBe("");
        expect(area.style.getPropertyValue("--gm-img-h")).toBe("min(75vw, 80dvh)");
        expect(area.className).toContain("sm:h-[60dvh]");
    });

    it("上の3つ（保存・いいね・閉じる）はスマホで画面に留まる", () => {
        setup();
        for (const name of ["閉じる", "いいね", "保存"]) {
            expect(screen.getByRole("button", { name }).className).toContain("max-sm:fixed");
        }
        expect(screen.getByRole("button", { name: "前の写真" }).className).not.toContain("max-sm:fixed");
    });

    it("一番上で写真を下へ払うと閉じる", () => {
        setup();
        swipeDownOnPhoto();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("読んで下へ送ったあと、上へ戻す指（下へ払う形）では閉じない", () => {
        setup();
        const frame = screen.getByTestId("gallery-modal-frame");
        frame.scrollTop = 240;
        swipeDownOnPhoto();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe("phoneImageHeight", () => {
    it("縦横比どおり・上限 80dvh", () => {
        expect(phoneImageHeight(1600, 1200)).toBe("min(75vw, 80dvh)");
        expect(phoneImageHeight(1200, 1600)).toBe("min(133.333vw, 80dvh)");
        expect(phoneImageHeight(900, 1600)).toBe("min(177.778vw, 80dvh)");
    });
    it("寸法が無い・壊れているときは 60dvh", () => {
        expect(phoneImageHeight()).toBe("60dvh");
        expect(phoneImageHeight(0, 100)).toBe("60dvh");
        expect(phoneImageHeight(100, Number.NaN)).toBe("60dvh");
    });
});
