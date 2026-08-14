import { describe, expect, it } from "vitest";
import {
  MAX_VARIANTS_PER_LANE,
  allowsRecencyVariant,
  expandQueries,
  heuristicVariants,
  isNearDuplicateQuery,
  parseVariantsJson,
  querySimilarity,
} from "./query-expander";

describe("expandQueries", () => {
  it("anchors generated variants to an explicitly specified document", async () => {
    let captured: Array<{ role: string; content: string }> = [];
    await expandQueries({
      callJson: async (messages) => {
        captured = messages;
        return '[{"query":"arXiv 2606.19348 limitations","kind":"primary"}]';
      },
      topic: "arXiv 2606.19348",
      subQuestion: "这篇文章的局限性是什么？",
      todayLine: "今天是 2026-08-14（UTC+8）。",
    });

    expect(captured[0]?.content).toContain("所有调研车道必须严格围绕该文档本身展开");
    expect(captured[0]?.content).toContain("严禁泛化");
  });
});

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
  it("keeps model variants when a think block is prefixed", () => {
    const raw = `<think>要几条变体？{4}条</think>[{"query":"A","kind":"primary"},{"query":"B","kind":"english"},{"query":"C","kind":"authority"}]`;
    const variants = parseVariantsJson(raw, "原始子问题");
    expect(variants.map((v) => v.query)).toEqual(["A", "B", "C"]);
  });

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

  it("drops variants that only differ by particles or punctuation", () => {
    const raw = JSON.stringify([
      { query: "MiniMax M2 的模型架构", kind: "primary" },
      { query: "MiniMax M2 模型架构", kind: "term" },
      { query: "MiniMax M2 模型架构？", kind: "term" },
      { query: "MiniMax M2 architecture paper", kind: "english" },
    ]);
    const variants = parseVariantsJson(raw, "MiniMax M2 的模型架构");
    expect(variants.map((v) => v.query)).toEqual([
      "MiniMax M2 的模型架构",
      "MiniMax M2 architecture paper",
    ]);
  });

  it("keeps variants that add a real search angle", () => {
    const raw = JSON.stringify([
      { query: "MiniMax M2 模型架构", kind: "primary" },
      { query: "MiniMax M2 模型架构 技术报告 论文", kind: "authority" },
      { query: "MiniMax M2 模型架构 局限 质疑", kind: "contrarian" },
    ]);
    expect(parseVariantsJson(raw, "MiniMax M2 模型架构")).toHaveLength(3);
  });
});

describe("querySimilarity / isNearDuplicateQuery", () => {
  it("scores identical-after-normalization queries as 1", () => {
    expect(querySimilarity("X 的架构", "X架构")).toBe(1);
    expect(querySimilarity("Deep Seek", "deepseek")).toBe(1);
  });

  it("scores unrelated queries near 0", () => {
    expect(querySimilarity("模型架构", "训练成本")).toBeLessThan(0.2);
  });

  it("treats a long added qualifier as a new angle, not a duplicate", () => {
    const base = "MiniMax M2 混合专家路由策略与推理开销";
    expect(isNearDuplicateQuery(base, `${base} 技术报告`)).toBe(false);
  });

  it("still catches word-order and punctuation reshuffles", () => {
    expect(isNearDuplicateQuery("模型架构 MiniMax M2", "MiniMax M2 模型架构")).toBe(false);
    expect(isNearDuplicateQuery("MiniMax M2, 模型架构!", "MiniMax M2 模型架构")).toBe(true);
  });

  it("ignores empty queries", () => {
    expect(isNearDuplicateQuery("", "x")).toBe(false);
    expect(isNearDuplicateQuery("  ", "  ")).toBe(false);
  });

  it("keeps heuristic fallback variants distinct from each other", () => {
    const variants = heuristicVariants("MiniMax M2 混合专家路由策略与推理开销的权衡");
    const queries = variants.map((v) => v.query);
    expect(new Set(queries).size).toBe(queries.length);
    expect(variants.length).toBeGreaterThanOrEqual(3);
  });
});

describe("recency variant gating", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");

  it("allows a recency probe only for current-state sub-questions", () => {
    for (const question of [
      "MiniMax M2 最新定价",
      "欧盟 AI 法案的近期进展",
      "该框架目前的默认配置是什么",
      "2026 年的模型发布节奏",
      "2027 年的模型能力",
      "latest release notes for the runtime",
    ]) {
      expect(allowsRecencyVariant(question, now)).toBe(true);
    }
  });

  it("refuses one for historical, foundational and definitional sub-questions", () => {
    for (const question of [
      "Transformer 架构的历史沿革",
      "注意力机制的基础理论与数学推导",
      "什么是挂谷猜想的定义",
      "分布式共识的经典论文有哪些",
      "2020 年的模型表现",
      "截至 2020 年的模型价格",
      "the origin of the seminal backpropagation proof",
    ]) {
      expect(allowsRecencyVariant(question, now)).toBe(false);
    }
  });

  it("keeps past-to-present ranges time-sensitive", () => {
    expect(allowsRecencyVariant("2020 年至今的模型价格趋势", now)).toBe(true);
    expect(allowsRecencyVariant("changes from 2020 to present", now)).toBe(true);
  });

  it("keeps a mislabelled recency query but demotes its kind", () => {
    const variants = parseVariantsJson(
      JSON.stringify([
        { query: "Transformer 架构的历史沿革", kind: "primary" },
        { query: "Transformer 架构 演进 综述", kind: "recency" },
      ]),
      "Transformer 架构的历史沿革",
    );

    expect(variants.map((v) => v.query)).toContain("Transformer 架构 演进 综述");
    expect(variants.some((v) => v.kind === "recency")).toBe(false);
  });

  it("preserves the recency kind when the sub-question really asks for now", () => {
    const variants = parseVariantsJson(
      JSON.stringify([
        { query: "MiniMax M2 最新定价", kind: "primary" },
        { query: "MiniMax M2 pricing 2026", kind: "recency" },
      ]),
      "MiniMax M2 最新定价",
    );

    expect(variants.some((v) => v.kind === "recency")).toBe(true);
  });
});
