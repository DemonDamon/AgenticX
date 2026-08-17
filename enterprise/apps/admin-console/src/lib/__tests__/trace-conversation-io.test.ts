import { describe, expect, it } from "vitest";
import {
  clipText,
  pickTurnMessages,
  splitReasoning,
  TRACE_IO_PREVIEW_CHARS,
} from "../trace-conversation-io";

describe("trace-conversation-io helpers", () => {
  it("clips long text with truncated flag", () => {
    const long = "a".repeat(TRACE_IO_PREVIEW_CHARS + 10);
    const clipped = clipText(long, TRACE_IO_PREVIEW_CHARS);
    expect(clipped.truncated).toBe(true);
    expect(clipped.length).toBe(long.length);
    expect(clipped.text.endsWith("…")).toBe(true);
    expect(clipped.text.length).toBe(TRACE_IO_PREVIEW_CHARS + 1);
  });

  it("splits think blocks from assistant content", () => {
    const raw = "<think>plan step</think>\nfinal answer";
    const { display, reasoning } = splitReasoning(raw);
    expect(reasoning).toContain("plan step");
    expect(display).toContain("final answer");
    expect(display).not.toContain("plan step");
  });

  it("pickTurnMessages keeps user→tool→assistant window", () => {
    const rows = [
      { role: "assistant", id: "a2" },
      { role: "tool", id: "t1" },
      { role: "user", id: "u1" },
      { role: "assistant", id: "a1" },
    ];
    expect(pickTurnMessages(rows).map((r) => r.id)).toEqual(["u1", "t1", "a2"]);
  });
});
