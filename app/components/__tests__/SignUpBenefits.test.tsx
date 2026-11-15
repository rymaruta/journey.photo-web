import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

// 「登録するとできること」（札 journey.photo-ios#618 の案1・2026-11-15 判断で案C）
const authState = vi.hoisted(() => ({ current: { isAuthenticated: false, loading: false } }));
vi.mock("../../auth/context", () => ({ useAuth: () => authState.current }));
const pathname = vi.hoisted(() => ({ current: "/photo/abc" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import SignUpBenefits from "../SignUpBenefits";
import HomeMosaic from "../HomeMosaic";
import {
    SIGNUP_BENEFITS, SIGNUP_BENEFITS_HEADING, SIGNUP_BENEFITS_AFTER_INDEX,
    showsSignupBenefits, signupBenefitsSignupHref, signupBenefitsLoginHref,
} from "@/lib/auth/signupBenefits";
import type { Photo } from "@/lib/data/photos";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

beforeEach(() => {
    authState.current = { isAuthenticated: false, loading: false };
    pathname.current = "/photo/abc";
});

describe("登録するとできること（文と行き先）", () => {
    it("4枚は iOS（SignUpBenefit）と同じ字、同じ順。中黒で区切らない", () => {
        expect(SIGNUP_BENEFITS.map((b) => b.ja)).toEqual(["写真を載せる", "行きたい場所を保存", "旅行プランを仲間と作る", "メッセージで話す"]);
        expect(SIGNUP_BENEFITS_HEADING.ja).toBe("登録するとできること");
        for (const b of SIGNUP_BENEFITS) expect(b.ja).not.toMatch(/[・·]/);
        // iOS の札の字と突き合わせる（片方だけ変えない）
        const ios = path.resolve(root, "../journey.photo-ios/Sources/JourneyPhoto/Core/Text/SignUpBenefits.swift");
        if (fs.existsSync(ios)) {
            const swift = fs.readFileSync(ios, "utf8");
            for (const b of SIGNUP_BENEFITS) expect(swift).toContain(`L("${b.ja}"`);
        }
    });

    it("確かめが終わって、ログインしていない人にだけ出す", () => {
        expect(showsSignupBenefits({ loading: false, isAuthenticated: false })).toBe(true);
        expect(showsSignupBenefits({ loading: true, isAuthenticated: false })).toBe(false);
        expect(showsSignupBenefits({ loading: false, isAuthenticated: true })).toBe(false);
    });

    it("押した先は今の登録の頁とログインの頁。戻り先を添える（外の頁は添えない）", () => {
        expect(signupBenefitsSignupHref("/photo/abc")).toBe("/signup?next=%2Fphoto%2Fabc");
        expect(signupBenefitsSignupHref("//evil.example")).toBe("/signup");
        expect(signupBenefitsSignupHref(null)).toBe("/signup");
        expect(signupBenefitsLoginHref("/photo/abc")).toBe("/login?next=%2Fphoto%2Fabc");
    });
});

describe("SignUpBenefits（画面）", () => {
    it("未ログイン: 真鍮の眉ラベル、札4枚（登録の頁へ）、新規登録、ログイン", () => {
        render(<SignUpBenefits locale="ja" />);
        const section = screen.getByTestId("signup-benefits");
        const heading = within(section).getByRole("heading", { name: "登録するとできること" });
        expect(heading.className).toContain("text-accent");
        const cards = SIGNUP_BENEFITS.map((b) => within(section).getByTestId(`signup-benefit-${b.id}`));
        expect(cards.map((c) => c.textContent)).toEqual(SIGNUP_BENEFITS.map((b) => b.ja));
        for (const c of cards) {
            expect(c.getAttribute("href")).toBe("/signup?next=%2Fphoto%2Fabc");
            expect(c.style.minHeight).toBe("44px");
        }
        expect(within(section).getByTestId("signup-benefits-signup").getAttribute("href")).toBe("/signup?next=%2Fphoto%2Fabc");
        const login = within(section).getByTestId("signup-benefits-login");
        expect(login.getAttribute("href")).toBe("/login?next=%2Fphoto%2Fabc");
        expect(login.style.minHeight).toBe("44px");
        // 写真の上の印は白（真鍮は黒地の上の眉ラベルだけ）
        expect(section.querySelectorAll("svg.text-white")).toHaveLength(4);
        expect(section.innerHTML).not.toContain("accent-fill");
    });

    it("ログイン中と確かめ中は何も描かない", () => {
        authState.current = { isAuthenticated: true, loading: false };
        const { container, rerender } = render(<SignUpBenefits locale="ja" />);
        expect(container.innerHTML).toBe("");
        authState.current = { isAuthenticated: false, loading: true };
        rerender(<SignUpBenefits locale="ja" />);
        expect(container.innerHTML).toBe("");
    });
});

describe("置き場所", () => {
    const photos = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, src: `/p${i}.jpg`, title: `t${i}` })) as unknown as Photo[];

    it("トップの並び: ひと回り（5枚）の後ろに1つだけ挟む", () => {
        const { container } = render(<HomeMosaic photos={photos} locale="ja"
            insert={{ afterIndex: SIGNUP_BENEFITS_AFTER_INDEX, node: <span>挟む段</span> }} />);
        const items = Array.from(container.querySelectorAll("ol > li"));
        const at = items.findIndex((li) => li.getAttribute("data-testid") === "home-mosaic-insert");
        expect(at).toBe(SIGNUP_BENEFITS_AFTER_INDEX + 1);
        expect(container.querySelectorAll("[data-testid=home-mosaic-insert]")).toHaveLength(1);
    });

    it("写真が少ない日は最後に置く。挟まない回は今の並びのまま", () => {
        const few = render(<HomeMosaic photos={photos.slice(0, 2)} locale="ja" insert={{ afterIndex: 4, node: <span>x</span> }} />);
        const items = Array.from(few.container.querySelectorAll("ol > li"));
        expect(items[items.length - 1].getAttribute("data-testid")).toBe("home-mosaic-insert");
        const none = render(<HomeMosaic photos={photos} locale="ja" />);
        expect(none.container.querySelectorAll("[data-testid=home-mosaic-insert]")).toHaveLength(0);
    });

    it("トップの新着とおすすめ、写真の頁に配線し、登録とログインの頁は変えない", () => {
        const gallery = read("app/GalleryPageClient.tsx");
        // 新着は並びに挟む（insert）。おすすめは季節の段で並びを割っている枝では、段の後ろに置く（benefitsShown）
        const inserted = (gallery.match(/insert=\{benefitsInsert\(filteredPhotos\)\}/g) ?? []).length;
        const afterShelf = (gallery.match(/\{benefitsShown && \(/g) ?? []).length;
        expect(inserted + afterShelf).toBe(2);
        expect(gallery).toContain("showsSignupBenefits({ loading: authLoading, isAuthenticated })");
        expect(read("app/photo/[id]/PhotoPageClient.tsx")).toContain("<SignUpBenefits locale=");
        expect(read("app/signup/page.tsx")).not.toContain("SignUpBenefits");
        expect(read("app/login/page.tsx")).not.toContain("SignUpBenefits");
    });
});
