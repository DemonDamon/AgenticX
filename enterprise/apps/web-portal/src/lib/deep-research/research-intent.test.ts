import { describe, expect, it } from "vitest";
import {
  defaultFacetLanes,
  looksOpenEndedResearchQuery,
} from "./research-intent";

describe("looksOpenEndedResearchQuery", () => {
  it("flags core-tech / survey style asks", () => {
    expect(looksOpenEndedResearchQuery("deepseek v4 核心技术点")).toBe(true);
    expect(looksOpenEndedResearchQuery("开源大模型全面对比分析")).toBe(true);
  });

  it("keeps tight factual asks closed", () => {
    expect(looksOpenEndedResearchQuery("DeepSeek V4 发布时间")).toBe(false);
    expect(looksOpenEndedResearchQuery("是否已开源")).toBe(false);
  });
});

describe("defaultFacetLanes", () => {
  it("builds model-oriented facets for LLM topics", () => {
    const lanes = defaultFacetLanes("deepseek v4 核心技术点");
    expect(lanes.length).toBeGreaterThanOrEqual(4);
    expect(lanes[0]).toContain("模型架构");
  });
});
