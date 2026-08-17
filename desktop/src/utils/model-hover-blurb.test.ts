import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEEPSEEK_REASONING_EFFORT,
  DEFAULT_KIMI_REASONING_EFFORT,
  describeModelForPicker,
  labelForDeepSeekReasoningEffort,
  labelForKimiReasoningEffort,
  normalizeDeepSeekReasoningEffort,
  normalizeKimiReasoningEffort,
  supportsDeepSeekV4Thinking,
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
