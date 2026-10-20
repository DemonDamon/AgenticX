import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import { runningDeepResearchRunIds, takeDeepResearchRunsToRecover } from "./auto-recover";

function assistant(id: string, sessionId: string, runId: string, status: string): ChatMessage {
  return {
    id,
    session_id: sessionId,
    tenant_id: "t",
    user_id: "u",
    role: "assistant",
    content: "",
    created_at: "2026-10-20T00:00:00.000Z",
    deep_research: { runId, status, events: [], artifactIds: [] },
  } as unknown as ChatMessage;
}

describe("runningDeepResearchRunIds", () => {
  it("returns running runs of the session only, without placeholders or duplicates", () => {
    const messages = [
      assistant("a", "s1", "run-1", "running"),
      assistant("b", "s1", "run-1", "running"),
      assistant("c", "s1", "run-2", "completed"),
      assistant("d", "s2", "run-3", "running"),
      assistant("e", "s1", "pending", "running"),
    ];
    expect(runningDeepResearchRunIds(messages, "s1")).toEqual(["run-1"]);
  });
});

describe("takeDeepResearchRunsToRecover", () => {
  it("picks a restored running run once", () => {
    const handled = new Set<string>();
    const messages = [assistant("a", "s1", "run-1", "running")];
    expect(takeDeepResearchRunsToRecover({ messages, sessionId: "s1", streaming: false, handled })).toEqual(["run-1"]);
    expect(takeDeepResearchRunsToRecover({ messages, sessionId: "s1", streaming: false, handled })).toEqual([]);
  });

  it("never reconnects a run first seen while the original stream is live", () => {
    const handled = new Set<string>();
    const messages = [assistant("a", "s1", "run-1", "running")];
    expect(takeDeepResearchRunsToRecover({ messages, sessionId: "s1", streaming: true, handled })).toEqual([]);
    expect(takeDeepResearchRunsToRecover({ messages, sessionId: "s1", streaming: false, handled })).toEqual([]);
  });
});
