import { describe, expect, it } from "vitest";
import { formatModelOptionLabel, normalizeBareModelId } from "./model-display";
import { getProviderDisplayName, isOfficialOpenAIBase } from "./provider-display";

describe("provider-display", () => {
  it("uses custom displayName when configured", () => {
    expect(getProviderDisplayName("custom_openai_caiyun", { displayName: "彩讯" })).toBe("彩讯");
  });

  it("labels built-in openai with custom base as compatible gateway", () => {
    expect(
      getProviderDisplayName("openai", { baseUrl: "http://47.2.1.1/v1" }),
    ).toBe("OpenAI 兼容");
    expect(getProviderDisplayName("openai", { baseUrl: "https://api.openai.com/v1" })).toBe("OpenAI");
    expect(isOfficialOpenAIBase("https://api.openai.com/v1/")).toBe(true);
  });
});

describe("model-display", () => {
  it("strips gateway routing prefixes from model ids", () => {
    expect(normalizeBareModelId("openai/deepseek-r1")).toBe("deepseek-r1");
    expect(normalizeBareModelId("  gpt-4o-mini  ")).toBe("gpt-4o-mini");
  });

  it("shows configured provider name instead of inventing model vendors", () => {
    expect(formatModelOptionLabel("openai", "deepseek-r1", { baseUrl: "http://47.2.1.1/v1" })).toBe(
      "OpenAI 兼容/deepseek-r1",
    );
    expect(formatModelOptionLabel("custom_openai_caiyun", "glm-5.1", { displayName: "彩讯" })).toBe(
      "彩讯/glm-5.1",
    );
    expect(formatModelOptionLabel("custom_openai_yidong", "minimax-m2.5", { displayName: "移动云" })).toBe(
      "移动云/minimax-m2.5",
    );
    expect(formatModelOptionLabel("openai", "gpt-4.1", { baseUrl: "https://api.openai.com/v1" })).toBe(
      "OpenAI/gpt-4.1",
    );
  });
});
