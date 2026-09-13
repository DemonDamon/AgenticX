import { describe, expect, it } from "vitest";

import {
  buildContextUsageRefreshKey,
  contextUsageMessageSignature,
  formatCategoryTokens,
  formatOccupancyFullLabel,
  formatOccupancyTokenPair,
  formatWindowPercent,
  shouldDropCachedOccupancy,
  shouldFetchContextUsage,
} from "./context-usage-refresh";

const base = {
  sessionId: "2bbaa24b-36ce-4b5e-b683-9ecebd291d6c",
  model: "glm-5.2",
  isStreaming: false,
  messageCount: 12,
  lastMessageId: "asst-final",
  sessionInputTokens: 996_400,
  sessionOutputTokens: 3_700,
};

describe("buildContextUsageRefreshKey", () => {
  it("ignores token_usage ticks while streaming but not a retry trim", () => {
    const before = buildContextUsageRefreshKey({
      ...base,
      isStreaming: true,
      sessionInputTokens: 900_000,
    });
    const afterTick = buildContextUsageRefreshKey({
      ...base,
      isStreaming: true,
      sessionInputTokens: 996_400,
      sessionOutputTokens: 4_200,
    });
    expect(afterTick).toBe(before);
    const afterTrim = buildContextUsageRefreshKey({
      ...base,
      isStreaming: true,
      messageCount: 1,
      lastMessageId: "user-retry",
    });
    expect(afterTrim).not.toBe(before);
  });

  it("changes after a retry trim while the session is idle", () => {
    const before = buildContextUsageRefreshKey(base);
    const trimmed = contextUsageMessageSignature([
      { id: "user-1" },
      { id: "asst-1" },
      { id: "user-retry" },
    ]);
    const afterTrim = buildContextUsageRefreshKey({
      ...base,
      isStreaming: false,
      ...trimmed,
    });
    expect(afterTrim).not.toBe(before);
  });

  it("changes when a turn settles with new messages or ledger totals", () => {
    const streaming = buildContextUsageRefreshKey({ ...base, isStreaming: true });
    const settled = buildContextUsageRefreshKey({
      ...base,
      isStreaming: false,
      messageCount: 13,
      lastMessageId: "asst-retry",
      sessionInputTokens: 1_010_000,
    });
    expect(settled).not.toBe(streaming);
  });
});

describe("shouldFetchContextUsage", () => {
  it("fetches on refresh-key change; streaming key already ignores token ticks", () => {
    expect(shouldFetchContextUsage(true)).toBe(true);
    expect(shouldFetchContextUsage(false)).toBe(true);
  });
});

describe("shouldDropCachedOccupancy", () => {
  it("drops the previous turn when retry has already zeroed pane tokens", () => {
    expect(
      shouldDropCachedOccupancy({ sessionInputTokens: 0, cachedLedgerInput: 51_615 })
    ).toBe(true);
    expect(
      shouldDropCachedOccupancy({ sessionInputTokens: 51_615, cachedLedgerInput: 51_615 })
    ).toBe(false);
    expect(
      shouldDropCachedOccupancy({ sessionInputTokens: 0, cachedLedgerInput: 0 })
    ).toBe(false);
  });
});

describe("formatWindowPercent", () => {
  it("reports category share of the model window", () => {
    expect(formatWindowPercent(2_000, 1_000_000)).toBe("0.2%");
    expect(formatWindowPercent(5_000, 1_000_000)).toBe("0.5%");
    expect(formatWindowPercent(64_000, 1_000_000)).toBe("6.4%");
    expect(formatWindowPercent(1_000, 1_000_000)).toBe("0.1%");
    expect(formatWindowPercent(0, 1_000_000)).toBe("0%");
    expect(formatWindowPercent(72_400, 1_000_000)).toBe("7.2%");
  });
});

describe("occupancy headline", () => {
  it("uses percent-full plus approximate used / cap tokens", () => {
    expect(formatOccupancyFullLabel(2.9)).toBe("2.9% 已占用");
    expect(formatOccupancyFullLabel(46)).toBe("46% 已占用");
    expect(formatOccupancyFullLabel(0)).toBe("0% 已占用");
    expect(formatOccupancyTokenPair(28_600, 1_000_000)).toBe("~28.6K / 1000K");
    expect(formatOccupancyTokenPair(118_200, 256_000)).toBe("~118.2K / 256K");
    expect(formatCategoryTokens(1_500)).toBe("1.5K");
    expect(formatCategoryTokens(0)).toBe("0");
    expect(formatCategoryTokens(613)).toBe("613");
  });
});
