import { describe, expect, it } from "vitest";
import {
  ZHIPU_DOCUMENTED_VLM_MODELS,
  isZhipuLike,
  mergeProviderCatalogExtras,
} from "./fetch-upstream-models";

describe("fetch-upstream-models catalog merge", () => {
  it("detects zhipu provider and bigmodel base URL", () => {
    expect(isZhipuLike("zhipu", "https://open.bigmodel.cn/api/paas/v4")).toBe(true);
    expect(isZhipuLike("custom", "https://open.bigmodel.cn/api/paas/v4")).toBe(true);
    expect(isZhipuLike("openai", "https://api.openai.com/v1")).toBe(false);
  });

  it("merges documented VLM SKUs when /models only returns text chat models", () => {
    const apiOnlyText = [
      "glm-4.6",
      "glm-4.7",
      "glm-5",
      "glm-5-turbo",
      "glm-5.1",
      "glm-5.2",
    ];
    const merged = mergeProviderCatalogExtras("zhipu", "https://open.bigmodel.cn/api/paas/v4", apiOnlyText);
    expect(merged).toEqual(expect.arrayContaining([...apiOnlyText, ...ZHIPU_DOCUMENTED_VLM_MODELS]));
    expect(merged).toContain("glm-4.6v");
    expect(merged.length).toBe(apiOnlyText.length + ZHIPU_DOCUMENTED_VLM_MODELS.length);
  });
});
