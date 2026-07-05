import { describe, expect, it } from "vitest";
import { formatModelOptionLabel, normalizeBareModelId } from "./model-display";
import {
  getProviderDisplayName,
  isOfficialOpenAIBase,
  isProviderDisplayNameEditable,
  isProviderDeletable,
} from "./provider-display";

describe("provider-display", () => {
  it("hides raw custom provider ids when displayName is missing", () => {
    expect(getProviderDisplayName("custom_openai_1782269503107", undefined)).toBe("历史厂商");
    expect(getProviderDisplayName("custom_openai_caiyun", { displayName: "彩讯" })).toBe("彩讯");
  });

  it("allows renaming custom vendors and openai-compatible gateways", () => {
    expect(isProviderDisplayNameEditable("custom_openai_yidong", { displayName: "移动云" })).toBe(true);
    expect(isProviderDisplayNameEditable("openai", { baseUrl: "http://47.2.1.1/v1" })).toBe(true);
    expect(isProviderDisplayNameEditable("openai", { baseUrl: "https://api.openai.com/v1" })).toBe(false);
    expect(isProviderDisplayNameEditable("anthropic", {})).toBe(false);
  });

  it("allows deleting user-added vendors but not built-in slots", () => {
    expect(isProviderDeletable("custom_openai_caixun_b")).toBe(true);
    expect(isProviderDeletable("custom_ollama_remote")).toBe(true);
    expect(isProviderDeletable("openai")).toBe(false);
    expect(isProviderDeletable("anthropic")).toBe(false);
    expect(isProviderDeletable("ollama")).toBe(false);
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
    expect(formatModelOptionLabel("custom_openai_moma", "ZHIPU/GLM-5.2", { displayName: "MOMA" })).toBe(
      "MOMA/GLM-5.2",
    );
  });
});
