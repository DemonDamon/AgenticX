import { describe, expect, it } from "vitest";
import {
  MAX_VARIANTS_PER_LANE,
  heuristicVariants,
  parseVariantsJson,
} from "./query-expander";

describe("heuristicVariants", () => {
  it("adds english variant for CJK queries", () => {
    const variants = heuristicVariants("深度求索核心技术");
    expect(variants.some((v) => v.kind === "primary")).toBe(true);
    expect(variants.some((v) => v.kind === "english")).toBe(true);
  });

  it("skips english variant for ascii queries", () => {
    const variants = heuristicVariants("deepseek architecture");
    expect(variants.some((v) => v.kind === "english")).toBe(false);
  });
});

describe("parseVariantsJson", () => {
  it("parses fenced json and dedupes", () => {
    const raw = `\`\`\`json
[{"query":"A","kind":"primary"},{"query":"a","kind":"term"},{"query":"B","kind":"authority"}]
\`\`\``;
    const variants = parseVariantsJson(raw, "A");
    expect(variants[0]?.query.toLowerCase()).toBe("a");
    expect(variants[1]?.query.toLowerCase()).toBe("b");
    expect(variants.length).toBeGreaterThanOrEqual(2);
  });

  it("truncates beyond MAX_VARIANTS_PER_LANE", () => {
    const items = Array.from({ length: MAX_VARIANTS_PER_LANE + 3 }, (_, i) => ({
      query: `q${i}`,
      kind: i === 0 ? "primary" : "term",
    }));
    expect(parseVariantsJson(JSON.stringify(items), "q0")).toHaveLength(MAX_VARIANTS_PER_LANE);
  });

  it("falls back on invalid / empty arrays", () => {
    expect(parseVariantsJson("not-json", "主题").some((v) => v.kind === "primary")).toBe(true);
    expect(parseVariantsJson("[]", "主题").some((v) => v.kind === "primary")).toBe(true);
  });
});
