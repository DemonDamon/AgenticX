import { describe, expect, it } from "vitest";

import {
  buildContextUsageRefreshKey,
  contextUsageMessageSignature,
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
