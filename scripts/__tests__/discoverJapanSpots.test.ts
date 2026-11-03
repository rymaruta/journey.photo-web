import { describe, expect, it } from "vitest";
import { existingKeys, filterCandidates, parseBindings, queryFor } from "../discover-japan-spots.mjs";

describe("Japan spot discovery", () => {
  it("normalizes names and excludes existing entries", () => {
    expect(existingKeys([{ name: "高屋 神社", aliases: ["たかやじんじゃ"] }]).has("高屋神社")).toBe(true);
    expect(filterCandidates([{ wikidataId: "Q1", name: "高屋神社" }, { wikidataId: "Q2", name: "新しい滝" }],
      [{ name: "高屋 神社" }])).toEqual([{ wikidataId: "Q2", name: "新しい滝" }]);
  });
  it("deduplicates Wikidata identifiers", () => {
    expect(filterCandidates([{ wikidataId: "Q2", name: "滝" }, { wikidataId: "Q2", name: "滝" }], [])).toHaveLength(1);
  });
  it("parses longitude and latitude in the right order", () => {
    const rows = parseBindings([{ item: { value: "https://www.wikidata.org/entity/Q123" },
      name: { value: "テスト山" }, coord: { value: "Point(139.7 35.6)" } }], "mountain");
    expect(rows[0]).toMatchObject({ wikidataId: "Q123", lat: 35.6, lng: 139.7, verified: false });
  });
  it("limits supported categories", () => {
    expect(queryFor("Q34038", 10)).toContain("wd:Q17");
    expect(() => queryFor("Q1", 10)).toThrow();
  });
});
