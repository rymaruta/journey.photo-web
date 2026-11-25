import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TermsPage from "../page";
import { LEGAL_CONSENT_VERSION } from "../../../lib/utils/legalConsent";

// 利用規約（App Store の審査 1.2 の差し戻し・2026-11-25・journey.photo-ios#604）。
// 「不適切な投稿といやがらせは一切許さない。違反した投稿は消し、利用を止める」を、日本語と英語の両方ではっきり書く。
// アプリの利用規約（EULA）を兼ねることも書く
describe("利用規約", () => {
    it("不適切な投稿といやがらせを一切許さないと、節の頭に書く", () => {
        render(<TermsPage />);
        const box = document.getElementById("zero-tolerance");
        expect(box).not.toBeNull();
        expect(box?.textContent).toContain("不適切な投稿や、ほかの利用者へのいやがらせは一切許しません。");
        expect(box?.textContent).toContain("違反した投稿を速やかに削除し、投稿した人の利用を止めます");
    });

    it("iOS アプリにも適用され、EULA を兼ねる", () => {
        render(<TermsPage />);
        expect(screen.getByText(/iOS アプリ「.+」にも同じように適用されます（アプリの利用規約（EULA）を兼ねます）/)).toBeInTheDocument();
    });

    it("英語の要約にも同じことを書く", () => {
        render(<TermsPage />);
        expect(screen.getByRole("heading", { name: "English summary" })).toBeInTheDocument();
        expect(screen.getByText("We have zero tolerance for objectionable content and abusive users.")).toBeInTheDocument();
        expect(screen.getByText(/promptly remove it, and ban the user who posted it/)).toBeInTheDocument();
        expect(screen.getByText(/end user license agreement \(EULA\)/)).toBeInTheDocument();
    });

    it("規約を変えたので、同意の版を上げてある（iOS の LegalConsent.currentVersion と同じ 2）", () => {
        expect(LEGAL_CONSENT_VERSION).toBeGreaterThanOrEqual(2);
    });
});
