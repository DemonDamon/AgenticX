import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import { mergeDeepResearchHydrate } from "./deep-research-hydrate";

function msg(
  partial: Pick<ChatMessage, "id" | "role" | "content"> & Partial<ChatMessage>,
): ChatMessage {
  return {
    session_id: "s1",
    tenant_id: "t1",
    user_id: "u1",
    created_at: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("mergeDeepResearchHydrate", () => {
  it("attaches latest run events onto the last assistant without workbench", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "deepseek v4" }),
      msg({ id: "a1", role: "assistant", content: "摘要与产物链接" }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-1",
      sessionId: "s1",
      status: "running",
      phase: "synthesize",
      topic: "deepseek v4",
      updatedAt: "2026-08-01T01:00:00.000Z",
      events: [
        { type: "phase", phase: "lanes", message: "开题冷启动检索…" },
        {
          type: "artifact",
          id: "art-1",
          path: "research/run-1/final-report.md",
          title: "终稿",
          kind: "report",
          bytes: 12,
        },
      ],
    });
    expect(next[1]?.deep_research?.runId).toBe("run-1");
    expect(next[1]?.deep_research?.events).toHaveLength(2);
    expect(next[1]?.deep_research?.status).toBe("completed");
  });

  it("does not overwrite an existing workbench", () => {
    const messages = [
      msg({
        id: "a1",
        role: "assistant",
        content: "x",
        deep_research: {
          runId: "run-existing",
          status: "completed",
          events: [{ type: "phase", phase: "done", message: "ok" }],
        },
      }),
    ];
    const next = mergeDeepResearchHydrate(messages, {
      runId: "run-other",
      sessionId: "s1",
      status: "completed",
      phase: "done",
      topic: "t",
      updatedAt: "2026-08-01T01:00:00.000Z",
      events: [{ type: "narrative", text: "should not attach" }],
    });
    expect(next[0]?.deep_research?.runId).toBe("run-existing");
    expect(next[0]?.deep_research?.events).toHaveLength(1);
  });
});
