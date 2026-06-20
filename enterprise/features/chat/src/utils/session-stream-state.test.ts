import { describe, expect, it } from "vitest";
import { getSessionRequestId, isSessionStreaming } from "./session-stream-state";

describe("session-stream-state", () => {
  it("returns false for null sessionId", () => {
    expect(isSessionStreaming({ streamStateBySessionId: {} }, null)).toBe(false);
    expect(getSessionRequestId({ streamStateBySessionId: {} }, null)).toBeNull();
  });

  it("returns false when session is absent from map", () => {
    expect(isSessionStreaming({ streamStateBySessionId: {} }, "A")).toBe(false);
    expect(getSessionRequestId({ streamStateBySessionId: {} }, "A")).toBeNull();
  });

  it("tracks per-session streaming status independently", () => {
    const state = {
      streamStateBySessionId: {
        A: { status: "streaming" as const, activeRequestId: "req-a" },
        B: { status: "sending" as const, activeRequestId: "req-b" },
      },
    };
    expect(isSessionStreaming(state, "A")).toBe(true);
    expect(isSessionStreaming(state, "B")).toBe(true);
    expect(isSessionStreaming(state, "C")).toBe(false);
    expect(getSessionRequestId(state, "A")).toBe("req-a");
    expect(getSessionRequestId(state, "B")).toBe("req-b");
  });
});
