import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CompositionGuidePage from "../page";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));

describe("撮影ガイド", () => {
  it("iOSと同名の18種類を選べる", () => {
    render(<CompositionGuidePage />);
    for (const name of ["三分割", "日の丸", "対角線", "二分割・十字", "シンメトリー", "水平線", "4×4", "方眼", "田字格", "米字格", "ファイグリッド", "3×3＋対角", "三角", "放射線", "1:1", "4:5", "9:16", "16:9"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("iOS版の37構図をすべて選択できる", () => {
    render(<CompositionGuidePage />);
    const names = ["三分割", "二分割・十字", "シンメトリー", "日の丸", "水平線", "4×4", "方眼", "田字格", "米字格", "ファイグリッド", "黄金螺旋", "フィボナッチ格子", "黄金三角形", "対角線", "3×3＋対角", "45°の対角", "斜めの三分割", "ダイナミックシンメトリー", "アーマチュア", "ルート長方形", "三角", "放射線", "トンネル", "額縁", "余白", "L字", "Z字", "S字", "C字", "1:1", "4:5", "9:16", "16:9", "3:2・2:1・XPan・√2", "6×4", "iPhone 標準", "水準器"];
    expect(names).toHaveLength(37);
    for (const name of names) {
      const button = screen.getByRole("button", { name: new RegExp(name.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\  it("構図を変更し、ガイド線を切り替えられる", () => {")) });
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("構図ガイド線")).toBeInTheDocument();
    }
  });

  it("構図を変更し、ガイド線を切り替えられる", () => {
    render(<CompositionGuidePage />);
    fireEvent.click(screen.getByRole("button", { name: /シンメトリー/ }));
    expect(screen.getByRole("button", { name: /シンメトリー/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("構図ガイド線")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "ガイド線を表示" }));
    expect(screen.queryByLabelText("構図ガイド線")).toBeNull();
  });
});
