import { describe, expect, it } from "vitest";

import {
  buildContextUsageRefreshKey,
  contextUsageMessageSignature,
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
  it("freezes the key while streaming so token_usage ticks do not refetch", () => {
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
      messageCount: 13,
      lastMessageId: "asst-draft",
    });
    expect(afterTick).toBe(before);
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
  it("skips in-flight streams and fetches once the turn is idle", () => {
    expect(shouldFetchContextUsage(true)).toBe(false);
    expect(shouldFetchContextUsage(false)).toBe(true);
  });
});
