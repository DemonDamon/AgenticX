import { describe, expect, it } from "vitest";
import {
  CONTEXT_WINDOW_1M,
  CONTEXT_WINDOW_300K,
  CONTEXT_WINDOW_512K,
  DEFAULT_DEEPSEEK_REASONING_EFFORT,
  DEFAULT_KIMI_REASONING_EFFORT,
  contextWindowOptionsForModel,
  describeModelForPicker,
  labelForContextWindow,
  labelForDeepSeekReasoningEffort,
  labelForKimiReasoningEffort,
  labelForModelReasoningEffort,
  normalizeContextWindow,
  normalizeDeepSeekReasoningEffort,
  normalizeKimiReasoningEffort,
  normalizeReasoningEffortForModel,
  reasoningEffortOptionsForModel,
  supportsDeepSeekV4Thinking,
  supportsGlm52ReasoningEffort,
  supportsGlm53ReasoningEffort,
  supportsKimiK28ReasoningEffort,
  supportsKimiK3ReasoningEffort,
} from "./model-hover-blurb";

describe("describeModelForPicker", () => {
  it("uses a distinctive blurb for Kimi K3", () => {
    const blurb = describeModelForPicker("kimi", "kimi-k3", "月之暗面");
    expect(blurb.title).toBe("kimi-k3");
    expect(blurb.description).toContain("长程自主任务");
    expect(blurb.description).not.toContain("日常任务");
    expect(blurb.supportsReasoningEffort).toBe(true);
    expect(blurb.metaValue).toBe("月之暗面");
  });

  it("uses a distinctive blurb for MiniMax M3", () => {
    const blurb = describeModelForPicker("minimax", "MiniMax-M3", "MiniMax");
    expect(blurb.description).toContain("原生多模态");
    expect(blurb.description).toContain("代码");
    expect(blurb.supportsReasoningEffort).toBe(false);
    expect(blurb.supportsContextWindow).toBe(true);
    expect(blurb.contextWindowOptions.map((opt) => opt.value)).toEqual([
      CONTEXT_WINDOW_300K,
      CONTEXT_WINDOW_512K,
    ]);
  });

  it("labels code-oriented Kimi models", () => {
    const blurb = describeModelForPicker("kimi", "kimi-k2.7-code", "月之暗面");
    expect(blurb.title).toBe("kimi-k2.7-code");
    expect(blurb.description).toContain("编程");
    expect(blurb.supportsReasoningEffort).toBe(false);
  });

  it("uses a distinctive blurb for DeepSeek V4", () => {
    const pro = describeModelForPicker("deepseek", "deepseek-v4-pro", "DeepSeek");
    expect(pro.description).toBe("DeepSeek 旗舰模型，支持 1M 上下文窗口");
    expect(pro.supportsReasoningEffort).toBe(false);
    expect(pro.supportsDeepSeekThinking).toBe(true);
    expect(pro.supportsContextWindow).toBe(true);
    expect(pro.contextWindowOptions.map((opt) => opt.value)).toEqual([
      CONTEXT_WINDOW_300K,
      CONTEXT_WINDOW_1M,
    ]);
    expect(pro.metaValue).toBe("DeepSeek");

    const flash = describeModelForPicker("deepseek", "deepseek-v4-flash", "DeepSeek");
    expect(flash.description).toBe("DeepSeek 旗舰模型，支持 1M 上下文窗口");
    expect(flash.supportsDeepSeekThinking).toBe(true);
    expect(supportsDeepSeekV4Thinking("openai/deepseek-v4-pro-0813")).toBe(true);
    expect(supportsDeepSeekV4Thinking("deepseek-chat")).toBe(false);
  });

  it("does not invent a consumption multiplier", () => {
    const blurb = describeModelForPicker("custom_openai_caiyun", "glm-5.2", "彩讯-外网");
    expect(blurb.metaLabel).toBe("服务渠道");
    expect(blurb.metaValue).toBe("彩讯-外网");
    expect(JSON.stringify(blurb)).not.toMatch(/\d+(\.\d+)?x/);
  });
});

describe("supportsKimiK3ReasoningEffort", () => {
  it("detects bare and prefixed K3 ids", () => {
    expect(supportsKimiK3ReasoningEffort("kimi-k3")).toBe(true);
    expect(supportsKimiK3ReasoningEffort("moonshot/kimi-k3")).toBe(true);
    expect(supportsKimiK3ReasoningEffort("kimi-k3-preview")).toBe(true);
    expect(supportsKimiK3ReasoningEffort("kimi-k2.6")).toBe(false);
    expect(supportsKimiK3ReasoningEffort("glm-5.2")).toBe(false);
  });
});

describe("supportsGlm53ReasoningEffort", () => {
  it("detects glm-5.3 family including flash, not glm-5.2", () => {
    expect(supportsGlm53ReasoningEffort("glm-5.3-flash")).toBe(true);
    expect(supportsGlm53ReasoningEffort("glm-5.3")).toBe(true);
    expect(supportsGlm53ReasoningEffort("openai/glm-5.3-flash")).toBe(true);
    expect(supportsGlm53ReasoningEffort("zhipu/glm-5.3")).toBe(true);
    expect(supportsGlm53ReasoningEffort("glm-5.2")).toBe(false);
    expect(supportsGlm53ReasoningEffort("kimi-k3")).toBe(false);
  });

  it("exposes low/high/max picker on the hover card", () => {
    const flash = describeModelForPicker("custom_openai_caiyun", "glm-5.3-flash", "彩讯-外网");
    expect(flash.supportsReasoningEffort).toBe(true);
    expect(flash.supportsDeepSeekThinking).toBe(false);

    const flagship = describeModelForPicker("zhipu", "glm-5.3", "智谱");
    expect(flagship.supportsReasoningEffort).toBe(true);

    const older = describeModelForPicker("zhipu", "glm-5.2", "智谱");
    expect(older.supportsReasoningEffort).toBe(true);
    expect(older.reasoningEffortOptions.map((opt) => opt.value)).toEqual(["high", "max"]);
    expect(older.supportsContextWindow).toBe(true);
  });
});

describe("reasoning and context selectors", () => {
  it("uses 极致 for GLM-5.3 / K2.8 and 超高 for GLM-5.2", () => {
    expect(labelForModelReasoningEffort("glm-5.3-flash", "max")).toBe("极致");
    expect(labelForModelReasoningEffort("kimi-k2.8-preview", "max")).toBe("极致");
    expect(labelForModelReasoningEffort("glm-5.2", "max")).toBe("超高");
    expect(labelForModelReasoningEffort("kimi-k3", "max")).toBe("最大");
    expect(reasoningEffortOptionsForModel("glm-5.2").map((opt) => opt.labelKey)).toEqual([
      "effortHigh",
      "effortUltra",
    ]);
  });

  it("normalizes effort and window per SKU", () => {
    expect(supportsGlm52ReasoningEffort("openai/glm-5.2")).toBe(true);
    expect(supportsKimiK28ReasoningEffort("kimi-k2.8-preview")).toBe(true);
    expect(normalizeReasoningEffortForModel("glm-5.2", "low")).toBe("max");
    expect(normalizeReasoningEffortForModel("glm-5.2", "high")).toBe("high");
    expect(normalizeReasoningEffortForModel("glm-5.3", "low")).toBe("low");
    expect(normalizeContextWindow("MiniMax-M3", undefined)).toBe(CONTEXT_WINDOW_300K);
    expect(normalizeContextWindow("MiniMax-M3", CONTEXT_WINDOW_512K)).toBe(CONTEXT_WINDOW_512K);
    expect(normalizeContextWindow("glm-5.3", CONTEXT_WINDOW_1M)).toBe(CONTEXT_WINDOW_1M);
    expect(normalizeContextWindow("glm-5.3", CONTEXT_WINDOW_512K)).toBe(CONTEXT_WINDOW_300K);
    expect(labelForContextWindow("kimi-k3", CONTEXT_WINDOW_1M)).toBe("1M");
    expect(contextWindowOptionsForModel("kimi-k2.8-preview").map((opt) => opt.label)).toEqual([
      "300K",
      "1M",
    ]);
    expect(contextWindowOptionsForModel("gpt-4o")).toEqual([]);
  });
});

describe("normalizeKimiReasoningEffort", () => {
  it("defaults to max and accepts low/high/max", () => {
    expect(normalizeKimiReasoningEffort(undefined)).toBe(DEFAULT_KIMI_REASONING_EFFORT);
    expect(normalizeKimiReasoningEffort("high")).toBe("high");
    expect(normalizeKimiReasoningEffort("LOW")).toBe("low");
    expect(normalizeKimiReasoningEffort("nope")).toBe("max");
    expect(labelForKimiReasoningEffort("high")).toBe("高");
    expect(labelForKimiReasoningEffort("max")).toBe("最大");
  });
});

describe("normalizeDeepSeekReasoningEffort", () => {
  it("defaults to high and accepts high/max only", () => {
    expect(normalizeDeepSeekReasoningEffort(undefined)).toBe(DEFAULT_DEEPSEEK_REASONING_EFFORT);
    expect(normalizeDeepSeekReasoningEffort("max")).toBe("max");
    expect(normalizeDeepSeekReasoningEffort("HIGH")).toBe("high");
    expect(normalizeDeepSeekReasoningEffort("low")).toBe("high");
    expect(labelForDeepSeekReasoningEffort("high")).toBe("高");
    expect(labelForDeepSeekReasoningEffort("max")).toBe("超高");
  });
});
