import { describe, expect, it } from "vitest";
import { listKbEmbeddingModelOptions } from "./embedding-model-options";
import type { ProviderCatalogEntry } from "./model-options";

function entry(models: string[]): ProviderCatalogEntry {
  return {
    apiKey: "k",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: models[0] ?? "",
    models,
    enabled: true,
    dropParams: false,
  };
}

describe("listKbEmbeddingModelOptions", () => {
  it("lists visible embedding SKUs for bailian catalog", () => {
    const providers = {
      bailian: entry(["qwen-plus", "text-embedding-v4", "multimodal-embedding-v1"]),
    };
    const options = listKbEmbeddingModelOptions("bailian", providers);
    expect(options).toContain("text-embedding-v4");
    expect(options).toContain("multimodal-embedding-v1");
    expect(options).not.toContain("qwen-plus");
  });

  it("falls back to default when catalog has no embedding models", () => {
    const providers = { bailian: entry(["qwen-plus"]) };
    const options = listKbEmbeddingModelOptions("bailian", providers);
    expect(options).toEqual(["text-embedding-v4"]);
  });
});
