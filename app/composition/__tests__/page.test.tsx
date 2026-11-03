import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CompositionGuidePage from "../page";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));

const names = ["三分割", "二分割・十字", "シンメトリー", "日の丸", "水平線", "4×4", "方眼", "田字格", "米字格", "ファイグリッド", "黄金螺旋", "フィボナッチ格子", "黄金三角形", "対角線", "3×3＋対角", "45°の対角", "斜めの三分割", "ダイナミックシンメトリー", "アーマチュア", "ルート長方形", "三角", "放射線", "トンネル", "額縁", "余白", "L字", "Z字", "S字", "C字", "1:1", "4:5", "9:16", "16:9", "3:2・2:1・XPan・√2", "6×4", "iPhone 標準", "水準器"];

describe("撮影ガイド", () => {
  it("iOS版と同じ37構図を選択できる", () => {
    render(<CompositionGuidePage />);
    expect(names).toHaveLength(37);
    const buttons = screen.getAllByRole("button").filter((button) => button.querySelector("strong"));
    expect(buttons).toHaveLength(37);
    for (const name of names) {
      const button = buttons.find((item) => item.querySelector("strong")?.textContent === name);
      expect(button, name).toBeDefined();
      fireEvent.click(button!);
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("構図ガイド線")).toBeInTheDocument();
    }
  });

  it("iOSと同じ35%を初期値とし、15〜70%の範囲で線の濃さを変えられる", () => {
    render(<CompositionGuidePage />);
    const opacity = screen.getByRole("slider", { name: "ガイド線の濃さ" });
    expect(opacity).toHaveAttribute("min", "0.15");
    expect(opacity).toHaveAttribute("max", "0.7");
    expect(opacity).toHaveValue("0.35");
    fireEvent.change(opacity, { target: { value: "0.7" } });
    expect(opacity).toHaveValue("0.7");
    expect(screen.getByText(/70%/)).toBeInTheDocument();
  });

  it("回転・左右反転・リセットを操作できる", () => {
    render(<CompositionGuidePage />);
    const guide = screen.getByLabelText("構図ガイド線");
    const group = guide.querySelector("g");
    expect(group?.getAttribute("transform")).toContain("rotate(0)");
    fireEvent.click(screen.getByRole("button", { name: "右へ90°回転" }));
    expect(group?.getAttribute("transform")).toContain("rotate(90)");
    const flip = screen.getByRole("button", { name: "左右反転" });
    fireEvent.click(flip);
    expect(flip).toHaveAttribute("aria-pressed", "true");
    expect(group?.getAttribute("transform")).toContain("scale(-1 1)");
    fireEvent.click(screen.getByRole("button", { name: "向きをリセット" }));
    expect(group?.getAttribute("transform")).toContain("rotate(0)");
    expect(flip).toHaveAttribute("aria-pressed", "false");
  });

  it("iOS構図のバリエーションを切り替えられる", () => {
    render(<CompositionGuidePage />);
    const symmetry = screen.getAllByRole("button").find((item) => item.querySelector("strong")?.textContent === "シンメトリー");
    fireEvent.click(symmetry!);
    const vertical = screen.getByRole("button", { name: "上下" });
    fireEvent.click(vertical);
    expect(vertical).toHaveAttribute("aria-pressed", "true");
    const ratios = screen.getAllByRole("button").find((item) => item.querySelector("strong")?.textContent === "3:2・2:1・XPan・√2");
    fireEvent.click(ratios!);
    const xpan = screen.getByRole("button", { name: "XPan 65:24" });
    fireEvent.click(xpan);
    expect(xpan).toHaveAttribute("aria-pressed", "true");
  });

  it("三角とL字のiOSバリエーションを切り替えられる", () => {
    render(<CompositionGuidePage />);
    const buttons = screen.getAllByRole("button");
    const triangle = buttons.find((item) => item.querySelector("strong")?.textContent === "三角");
    fireEvent.click(triangle!);
    const down = screen.getByRole("button", { name: "下向き" });
    fireEvent.click(down);
    expect(down).toHaveAttribute("aria-pressed", "true");
    const lShape = buttons.find((item) => item.querySelector("strong")?.textContent === "L字");
    fireEvent.click(lShape!);
    const topRight = screen.getByRole("button", { name: "右上" });
    fireEvent.click(topRight);
    expect(topRight).toHaveAttribute("aria-pressed", "true");
  });

  it("ガイド線を表示・非表示に切り替えられる", () => {
    render(<CompositionGuidePage />);
    expect(screen.getByLabelText("構図ガイド線")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "ガイド線を表示" }));
    expect(screen.queryByLabelText("構図ガイド線")).toBeNull();
  });
});
