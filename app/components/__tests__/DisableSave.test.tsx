import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DisableSave from "../DisableSave";

/**
 * 写真を保存させない（2026-11-12 owner「他人は共有画像とかは DL できないようにして欲しい」）。
 *
 * 以前は `Thumb`・写真の詳細・モーダルの `<img>` にだけ右クリック止めがあり、
 * 本番の /map では写真21枚すべてで右クリックの保存とドラッグが通っていた。
 * サイト全体で止めるのは `DisableSave`（document の capture）と `globals.css`。
 *
 * 画面の側の `<img>` には何も付けずに置く——**どの画面の写真でも、何も付けなくても止まる**ことを見る。
 */
afterEach(cleanup);

function fire(el: Element, type: "contextmenu" | "dragstart"): boolean {
    const ev = type === "contextmenu"
        ? new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
        : new Event("dragstart", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
}

function mount() {
    return render(
        <>
            <DisableSave />
            {/* 守りを付けていない画面（地図の写真の一覧の形）。他人の写真 */}
            <div>
                <img data-testid="plain" src="https://journey-photo.com/uploads/u1/p1.jpg" alt="" />
                <picture>
                    <source data-testid="source" type="image/avif" srcSet="https://journey-photo.com/uploads/p2_lg.avif" />
                    <img data-testid="pictured" src="https://journey-photo.com/uploads/p2.jpg" alt="" />
                </picture>
                <video data-testid="video" src="https://journey-photo.com/uploads/s1.mp4" />
                {/* 署名つき CloudFront（非公開の写真の本人向け）でも同じ */}
                <img data-testid="signed" src="https://d1s3.cloudfront.net/uploads/p3.jpg?Expires=1&Signature=x" alt="" />
            </div>
            {/* 文字・入力欄の右クリック（コピー・貼り付け）は止めない */}
            <p data-testid="text">本文</p>
            <a data-testid="link" href="/photo/1">リンク</a>
            <input data-testid="input" />
            {/* 保存させたい所の逃げ道 */}
            <div data-allow-save>
                <img data-testid="allowed" src="/x.jpg" alt="" />
            </div>
        </>,
    );
}

describe("DisableSave — 写真の右クリック・ドラッグの保存を止める", () => {
    it("守りの無い画面の写真でも、右クリックのメニューを出さない", () => {
        const { getByTestId } = mount();
        for (const id of ["plain", "pictured", "source", "video", "signed"]) {
            expect(fire(getByTestId(id), "contextmenu"), id).toBe(true);
        }
    });

    it("写真をドラッグして落とせない", () => {
        const { getByTestId } = mount();
        for (const id of ["plain", "pictured", "video", "signed"]) {
            expect(fire(getByTestId(id), "dragstart"), id).toBe(true);
        }
    });

    it("文字・リンク・入力欄の右クリックは今までどおり（コピー・新しいタブで開く）", () => {
        const { getByTestId } = mount();
        for (const id of ["text", "link", "input"]) {
            expect(fire(getByTestId(id), "contextmenu"), id).toBe(false);
        }
    });

    it("data-allow-save の中だけは止めない", () => {
        const { getByTestId } = mount();
        expect(fire(getByTestId("allowed"), "contextmenu")).toBe(false);
        expect(fire(getByTestId("allowed"), "dragstart")).toBe(false);
    });

    it("Ctrl/Cmd+S（頁ごと保存）を止める", () => {
        mount();
        for (const init of [{ key: "s", ctrlKey: true }, { key: "s", metaKey: true }, { key: "S", ctrlKey: true, shiftKey: true }]) {
            const ev = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
            document.dispatchEvent(ev);
            expect(ev.defaultPrevented, JSON.stringify(init)).toBe(true);
        }
    });

    it("外したら止めない（画面を離れたあとに残らない）", () => {
        const { getByTestId, unmount } = mount();
        const img = getByTestId("plain");
        unmount();
        document.body.appendChild(img);
        expect(fire(img, "contextmenu")).toBe(false);
        img.remove();
    });
});

describe("globals.css — iOS Safari の長押しの保存を止める", () => {
    // 長押しの「写真に保存」は contextmenu が出ないので JS では止まらない。CSS だけが効く
    const css = readFileSync(resolve(__dirname, "../../globals.css"), "utf8");

    it("すべての img・video に -webkit-touch-callout: none と -webkit-user-drag: none", () => {
        const rule = css.match(/(^|\n)img,\s*\nvideo\s*\{([^}]*)\}/);
        expect(rule, "img, video の規則が無い").not.toBeNull();
        expect(rule![2]).toMatch(/-webkit-touch-callout:\s*none/);
        expect(rule![2]).toMatch(/-webkit-user-drag:\s*none/);
    });
});
