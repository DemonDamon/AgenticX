import { describe, expect, it } from "vitest";
import {
  formatCompactTokens,
  formatTurnModelLabel,
  formatTurnUsageCount,
  formatTurnUsageLabel,
  formatTurnUsageSplit,
  formatTurnUsageTitle,
  parseMessageUsage,
} from "./message-turn-meta";

describe("message-turn-meta", () => {
  it("formats a turn usage label", () => {
    const usage = {
      totalTokens: 1540,
      inputTokens: 1200,
      outputTokens: 340,
      cachedTokens: 80,
      reasoningTokens: 0,
    };
    expect(formatTurnUsageCount(usage)).toBe("1,540");
    expect(formatTurnUsageLabel(usage)).toBe("本轮消耗 1,540");
    expect(formatTurnUsageTitle(usage)).toBe(
      "本轮输入 1,200（含重发的上下文） · 输出 340 · 缓存 80",
    );
  });

  it("splits input and output so the re-sent context is visible", () => {
    expect(
      formatTurnUsageSplit({
        totalTokens: 28663,
        inputTokens: 28294,
        outputTokens: 369,
        cachedTokens: 0,
        reasoningTokens: 0,
      }),
    ).toEqual({ input: "28.3K", output: "369" });
  });

  it("returns no split when a turn has no input or output", () => {
    expect(
      formatTurnUsageSplit({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBeUndefined();
  });

  it("formats compact token counts like the context popup", () => {
    expect(formatCompactTokens(369)).toBe("369");
    expect(formatCompactTokens(1000)).toBe("1.0K");
    expect(formatCompactTokens(28294)).toBe("28.3K");
    expect(formatCompactTokens(0)).toBe("0");
  });

  it("returns empty usage label for zeros", () => {
    expect(
      formatTurnUsageLabel({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe("");
  });

  it("formats model labels including auto", () => {
    expect(formatTurnModelLabel("kimi-k2.6")).toBe("kimi-k2.6");
    expect(formatTurnModelLabel("openai/kimi-k2.6")).toBe("kimi-k2.6");
    expect(formatTurnModelLabel("kimi-k2.6", "auto")).toBe("auto(kimi-k2.6)");
    expect(formatTurnModelLabel("", "auto")).toBe("");
  });

  it("backfills total tokens when mapping usage", () => {
    const parsed = parseMessageUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 0 });
    expect(parsed?.totalTokens).toBe(3);
  });
});
