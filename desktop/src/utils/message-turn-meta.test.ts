import { describe, expect, it } from "vitest";
import { i18n } from "../i18n/i18n";
import {
  formatCompactTokens,
  formatTurnCacheHit,
  formatTurnCacheHitLabel,
  formatTurnCacheHitTip,
  formatTurnModelLabel,
  formatTurnUsageCount,
  formatTurnUsageLabel,
  formatTurnUsageSplit,
  formatTurnUsageTitle,
  parseMessageUsage,
  sessionAccumulateFromUsageEvent,
} from "./message-turn-meta";

const t = i18n.getFixedT("zh", "chat");

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
    expect(formatTurnUsageLabel(usage, t)).toBe("本轮消耗 1,540");
    expect(formatTurnUsageTitle(usage, t)).toBe(
      "本次请求输入 1,200 · 输出 340 · 缓存 80 · 命中 6.7%（80 / 1.2K）",
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

  it("formats the turn cache-hit ratio from cached / input", () => {
    expect(
      formatTurnCacheHit({
        totalTokens: 430385,
        inputTokens: 429400,
        outputTokens: 985,
        cachedTokens: 404000,
        reasoningTokens: 0,
      }),
    ).toEqual({ percent: 94.1, cached: "404.0K", input: "429.4K" });
    expect(formatTurnCacheHitLabel({ percent: 94.5 }, t)).toBe("缓存 94.5%");
    expect(
      formatTurnCacheHitTip({ percent: 94.5, cached: "38.9K", input: "41.2K" }, t),
    ).toBe("本轮缓存命中 94.5%（38.9K / 41.2K）。越高说明重复上下文越多，不是窗口占用。");
    expect(
      formatTurnCacheHit({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBeUndefined();
  });

  it("returns empty usage label for zeros", () => {
    expect(
      formatTurnUsageLabel({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
      }, t),
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

  it("keeps session accumulate on the turn bill while the footer uses last request", () => {
    const parsed = parseMessageUsage({
      input_tokens: 27111,
      output_tokens: 345,
      cached_tokens: 26112,
      total_tokens: 27456,
    });
    expect(parsed).toBeDefined();
    expect(
      sessionAccumulateFromUsageEvent(
        {
          input_tokens: 27111,
          output_tokens: 345,
          cached_tokens: 26112,
          turn_input_tokens: 78821,
          turn_output_tokens: 666,
          turn_cached_tokens: 62848,
        },
        parsed!,
      ),
    ).toEqual({ input: 78821, output: 666, cached: 62848 });
  });
});
