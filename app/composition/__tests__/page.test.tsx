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

  it("構図を変更し、ガイド線を切り替えられる", () => {
    render(<CompositionGuidePage />);
    fireEvent.click(screen.getByRole("button", { name: /シンメトリー/ }));
    expect(screen.getByRole("button", { name: /シンメトリー/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("構図ガイド線")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "ガイド線を表示" }));
    expect(screen.queryByLabelText("構図ガイド線")).toBeNull();
  });
});
