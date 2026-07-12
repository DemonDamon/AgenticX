import { describe, expect, it } from "vitest";

import type { Message } from "../store";
import {
  buildPendingToolFallback,
  buildDeferredToolResultResolution,
  drainPendingToolResults,
  hasMatchingToolCall,
  matchesToolCallForSession,
  resolvePendingToolName,
  type PendingToolResult,
} from "./pending-tool-result";

const pending: PendingToolResult = {
  callId: "functions.bash_exec:0",
  toolName: "bash_exec",
  toolArgs: { command: "tmeet meeting list" },
  toolGroupId: "group-1",
  patch: {
    content: "exit_code=0",
    toolStatus: "done",
    toolResultPreview: "success",
    toolStreamLines: [],
  },
};

describe("pending tool result reconciliation", () => {
  it("preserves identity and terminal metadata in a fallback row", () => {
    expect(buildPendingToolFallback(pending)).toEqual({
      toolCallId: "functions.bash_exec:0",
      toolName: "bash_exec",
      toolArgs: { command: "tmeet meeting list" },
      toolGroupId: "group-1",
      toolStatus: "done",
      toolResultPreview: "success",
      toolStreamLines: [],
    });
  });

  it("detects an existing tool call to prevent duplicate fallback rows", () => {
    const existing: Message[] = [
      {
        id: "tool-1",
        role: "tool",
        content: "{}",
        ownerSessionId: "session-a",
        toolCallId: "functions.bash_exec:0",
        toolName: "bash_exec",
        toolStatus: "running",
      },
      {
        id: "final-1",
        role: "assistant",
        content: "查询完成",
      },
    ];

    expect(hasMatchingToolCall(existing, pending.callId, "session-a")).toBe(true);
    expect(hasMatchingToolCall(existing, "call-missing", "session-a")).toBe(false);
  });

  it("never emits an anonymous tool name", () => {
    expect(
      buildPendingToolFallback({
        ...pending,
        toolName: "",
      }).toolName,
    ).toBe("bash_exec");
  });

  it("does not match the same call id owned by another session", () => {
    const message: Message = {
      id: "tool-b",
      role: "tool",
      content: "{}",
      ownerSessionId: "session-b",
      toolCallId: "functions.bash_exec:0",
      toolName: "bash_exec",
    };

    expect(matchesToolCallForSession(message, pending.callId, "session-a")).toBe(false);
    expect(matchesToolCallForSession(message, pending.callId, "session-b")).toBe(true);
  });

  it("recovers a missing tool name from a deterministic call id", () => {
    expect(resolvePendingToolName("", "", "functions.bash_exec:0")).toBe("bash_exec");
    expect(resolvePendingToolName("web_search", "bash_exec", "functions.bash_exec:0")).toBe("web_search");
    expect(resolvePendingToolName("", "knowledge_search", "call-1")).toBe("knowledge_search");
  });

  it("drains pending results exactly once", () => {
    const pendingById = { [pending.callId]: pending };

    expect(drainPendingToolResults(pendingById)).toEqual([pending]);
    expect(drainPendingToolResults(pendingById)).toEqual([]);
  });

  it("merges result-before-call into an inactive session deferred tool row", () => {
    expect(
      buildDeferredToolResultResolution(
        [
          {
            role: "tool",
            extras: {
              toolCallId: pending.callId,
              toolName: "bash_exec",
              toolStatus: "running",
            },
          },
        ],
        pending,
      ),
    ).toEqual({
      index: 0,
      content: "exit_code=0",
      extras: buildPendingToolFallback(pending),
    });
  });
});
