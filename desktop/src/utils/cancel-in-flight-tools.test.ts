import { describe, expect, it } from "vitest";
import type { Message } from "../store";
import {
  cancelInFlightToolMessages,
  freezeToolElapsedSeconds,
  isInFlightToolStatus,
} from "./cancel-in-flight-tools";

function tool(
  id: string,
  status: Message["toolStatus"],
  extras: Partial<Message> = {},
): Message {
  return {
    id,
    role: "tool",
    content: "{}",
    toolCallId: id,
    toolName: "liteparse",
    toolStatus: status,
    ...extras,
  };
}

describe("cancelInFlightToolMessages", () => {
  it("marks running and pending tools cancelled and freezes elapsed", () => {
    const now = 10_000;
    const { messages, cancelledCount } = cancelInFlightToolMessages(
      [
        { id: "u1", role: "user", content: "parse" },
        tool("t1", "done"),
        tool("t2", "running", { timestamp: 7_000, toolElapsedSec: 2 }),
        tool("t3", "pending", { timestamp: 8_500 }),
      ],
      { now },
    );

    expect(cancelledCount).toBe(2);
    expect(messages[2]?.toolStatus).toBe("cancelled");
    expect(messages[2]?.toolElapsedSec).toBe(2);
    expect(messages[3]?.toolStatus).toBe("cancelled");
    expect(messages[3]?.toolElapsedSec).toBe(1);
    expect(messages[1]?.toolStatus).toBe("done");
  });

  it("only cancels tools for the current session when ownerSessionId is set", () => {
    const { messages, cancelledCount } = cancelInFlightToolMessages(
      [
        tool("keep", "running", { ownerSessionId: "old" }),
        tool("stop", "running", { ownerSessionId: "cur" }),
        tool("unstamped", "pending"),
      ],
      { ownerSessionId: "cur", now: 1_000 },
    );

    expect(cancelledCount).toBe(2);
    expect(messages[0]?.toolStatus).toBe("running");
    expect(messages[1]?.toolStatus).toBe("cancelled");
    expect(messages[2]?.toolStatus).toBe("cancelled");
  });

  it("leaves non-tool rows untouched", () => {
    const assistant: Message = { id: "a1", role: "assistant", content: "…" };
    const { messages, cancelledCount } = cancelInFlightToolMessages([assistant]);
    expect(cancelledCount).toBe(0);
    expect(messages[0]).toBe(assistant);
  });
});

describe("isInFlightToolStatus / freezeToolElapsedSeconds", () => {
  it("treats only running and pending as in-flight", () => {
    expect(isInFlightToolStatus("running")).toBe(true);
    expect(isInFlightToolStatus("pending")).toBe(true);
    expect(isInFlightToolStatus("cancelled")).toBe(false);
    expect(isInFlightToolStatus("done")).toBe(false);
  });

  it("prefers persisted elapsed over timestamp math", () => {
    expect(freezeToolElapsedSeconds(tool("t", "running", { toolElapsedSec: 13, timestamp: 1 }), 9_000)).toBe(13);
  });
});
