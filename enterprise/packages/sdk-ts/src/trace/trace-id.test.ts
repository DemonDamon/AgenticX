import { describe, expect, it } from "vitest";
import { isTraceId, newTraceId } from "./trace-id";

describe("newTraceId / isTraceId", () => {
  it("returns length 26", () => {
    expect(newTraceId()).toHaveLength(26);
  });

  it("produces unique ids across 1000 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(newTraceId());
    }
    expect(seen.size).toBe(1000);
  });

  it("is lexicographically monotonic with increasing timestamps", () => {
    expect(newTraceId(1) < newTraceId(2)).toBe(true);
  });

  it("validates Crockford Base32 ULIDs", () => {
    expect(isTraceId(newTraceId())).toBe(true);
    expect(isTraceId("abc")).toBe(false);
    expect(isTraceId("I".repeat(26))).toBe(false);
  });
});
