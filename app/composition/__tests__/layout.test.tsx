import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import Layout, { compositionBreadcrumb, metadata } from "../layout";
import { INDEXABLE_ROBOTS, siteConfig } from "../../../lib/utils/seo";

describe("構図ガイドの公開用 metadata", () => {
  it("canonical・robots・題が公開頁として揃っている", () => {
    expect(metadata.alternates?.canonical).toBe(`${siteConfig.url}/composition`);
    expect(metadata.robots).toBe(INDEXABLE_ROBOTS);
    expect(String(metadata.title)).toContain("構図ガイド");
    expect(String(metadata.title)).not.toContain("撮りどき");
    expect(String(metadata.description)).not.toContain("撮りどき");
    expect((metadata.openGraph as { url?: string }).url).toBe(`${siteConfig.url}/composition`);
  });

  it("パンくずは ホーム → 構図ガイド の2段で、JSON-LD として出る", () => {
    expect(compositionBreadcrumb["@type"]).toBe("BreadcrumbList");
    expect(compositionBreadcrumb.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, "ホーム", `${siteConfig.url}/`],
      [2, "構図ガイド", `${siteConfig.url}/composition`],
    ]);
    const { container } = render(<Layout><p>x</p></Layout>);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(JSON.parse(script!.innerHTML)).toEqual(compositionBreadcrumb);
  });
});
