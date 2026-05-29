import { describe, expect, it } from "vitest";
import { continueSessionUrl, inferContinueReason } from "./session-continue";
import { mergeSessionMessagesTail } from "./session-message-merge";
import type { LoadedSessionMessage } from "./session-message-map";

describe("continueSessionUrl", () => {
  it("builds POST target for session continuation", () => {
    expect(continueSessionUrl("http://127.0.0.1:65133", "abc-123")).toBe(
      "http://127.0.0.1:65133/api/sessions/abc-123/continue"
    );
    expect(continueSessionUrl("http://127.0.0.1:65133/", "abc-123")).toBe(
      "http://127.0.0.1:65133/api/sessions/abc-123/continue"
    );
  });
});

describe("inferContinueReason", () => {
  it("maps stall and execution states to continue reasons", () => {
    expect(inferContinueReason({ stallState: "exhausted", executionState: "idle" })).toBe("exhausted");
    expect(inferContinueReason({ stallState: "none", executionState: "interrupted" })).toBe("interrupted");
    expect(inferContinueReason({ stallState: "stall", executionState: "running" })).toBe("stall");
    expect(inferContinueReason({ stallState: "none", executionState: "idle" })).toBe("manual");
  });
});

describe("mergeSessionMessagesTail", () => {
  const row = (id: string, content: string): LoadedSessionMessage => ({
    id,
    role: "assistant",
    content,
  });

  it("returns existing rows untouched when disk tail is empty", () => {
    const existing = [{ id: "s-i0-a", role: "assistant", content: "hi" }] as never[];
    expect(mergeSessionMessagesTail(existing, [], "s")).toBe(existing);
  });

  it("appends new disk rows that are not yet in memory", () => {
    const existing = [{ id: "s-i0-a", role: "assistant", content: "hi" }] as never[];
    const merged = mergeSessionMessagesTail(existing, [row("a", "hi"), row("b", "more")], "s");
    expect(merged).toHaveLength(2);
    expect(merged[1].content).toBe("more");
  });

  it("does not grow when disk only echoes already-present rows", () => {
    const existing = mergeSessionMessagesTail([], [row("a", "hi")], "s");
    const again = mergeSessionMessagesTail(existing, [row("a", "hi")], "s");
    expect(again).toHaveLength(existing.length);
  });

  it("keeps in-memory timestamp when disk row has none", () => {
    const ts = 1_700_000_000_000;
    const existing = [{ id: "s-i0-a", role: "assistant", content: "hi", timestamp: ts }] as never[];
    const merged = mergeSessionMessagesTail(existing, [row("a", "hi")], "s");
    expect(merged[0].timestamp).toBe(ts);
  });
});
