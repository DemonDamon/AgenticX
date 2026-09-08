import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n/i18n";
import { formatModelOptionLabel, normalizeBareModelId } from "./model-display";
import {
  getProviderDisplayName,
  isOfficialOpenAIBase,
  isProviderDisplayNameEditable,
  isProviderDeletable,
} from "./provider-display";

describe("provider-display", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("hides raw custom provider ids when displayName is missing", () => {
    expect(getProviderDisplayName("custom_openai_1782269503107", undefined)).toBe("历史厂商");
    expect(getProviderDisplayName("custom_openai_caiyun", { displayName: "彩讯" })).toBe("彩讯");
  });

  it("localizes built-in vendors but keeps user-defined names", async () => {
    expect(getProviderDisplayName("zhipu", {})).toBe("智谱开放平台");
    expect(getProviderDisplayName("volcengine", {})).toBe("火山引擎");
    expect(getProviderDisplayName("custom_openai_caixun", { displayName: "彩讯-外网" })).toBe("彩讯-外网");

    await i18n.changeLanguage("en");
    expect(getProviderDisplayName("zhipu", {})).toBe("Zhipu AI");
    expect(getProviderDisplayName("volcengine", {})).toBe("Volcengine");
    expect(getProviderDisplayName("bailian", {})).toBe("Alibaba Cloud Bailian");
    expect(getProviderDisplayName("qianfan", {})).toBe("Baidu Qianfan");
    expect(getProviderDisplayName("kimi", {})).toBe("Moonshot AI");
    expect(getProviderDisplayName("openai", { baseUrl: "http://47.2.1.1/v1" })).toBe("OpenAI-compatible");
    expect(getProviderDisplayName("custom_openai_caixun", { displayName: "彩讯-外网" })).toBe("彩讯-外网");
    expect(getProviderDisplayName("zhipu", {})).not.toContain("智谱");
  });

  it("allows renaming custom vendors and openai-compatible gateways", () => {
    expect(isProviderDisplayNameEditable("custom_openai_yidong", { displayName: "移动云" })).toBe(true);
    expect(isProviderDisplayNameEditable("openai", { baseUrl: "http://47.2.1.1/v1" })).toBe(true);
    expect(isProviderDisplayNameEditable("openai", { baseUrl: "https://api.openai.com/v1" })).toBe(false);
    expect(isProviderDisplayNameEditable("anthropic", {})).toBe(false);
    expect(isProviderDisplayNameEditable("deepseek", {})).toBe(false);
  });

  it("allows deleting user-added vendors but not built-in slots", () => {
    expect(isProviderDeletable("custom_openai_caixun_b")).toBe(true);
    expect(isProviderDeletable("custom_ollama_remote")).toBe(true);
    expect(isProviderDeletable("openai")).toBe(false);
    expect(isProviderDeletable("anthropic")).toBe(false);
    expect(isProviderDeletable("ollama")).toBe(false);
    expect(isProviderDeletable("deepseek")).toBe(false);
  });

  it("labels built-in openai with custom base as compatible gateway", () => {
    expect(
      getProviderDisplayName("openai", { baseUrl: "http://47.2.1.1/v1" }),
    ).toBe("OpenAI 兼容");
    expect(getProviderDisplayName("openai", { baseUrl: "https://api.openai.com/v1" })).toBe("OpenAI");
    expect(getProviderDisplayName("deepseek", {})).toBe("DeepSeek");
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
