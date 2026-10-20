import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import { findPortalReportContinuation } from "./portal-continuation";

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage {
  return {
    id: partial.id,
    session_id: partial.session_id ?? "s1",
    tenant_id: "t1",
    user_id: "u1",
    role: partial.role,
    content: partial.content ?? "",
    created_at: "2026-10-20T00:00:00.000Z",
    ...(partial.deep_research ? { deep_research: partial.deep_research } : {}),
  };
}

describe("findPortalReportContinuation", () => {
  it("shows continuation only for a stopped report that published a checkpoint event", () => {
    const ready = message({
      id: "a1",
      role: "assistant",
      deep_research: {
        runId: "old",
        status: "failed",
        events: [{
          type: "report_resume_available",
          runId: "old",
          nextRunId: "new",
          completedSections: 1,
          totalSections: 3,
        }],
      },
    });
    const running = message({
      id: "a2",
      role: "assistant",
      deep_research: {
        runId: "live",
        status: "running",
        events: [{
          type: "report_resume_available",
          runId: "live",
          nextRunId: "later",
          completedSections: 1,
          totalSections: 3,
        }],
      },
    });
    const finished = message({
      id: "a3",
      role: "assistant",
      deep_research: { runId: "done", status: "completed", events: [] },
    });
    expect(findPortalReportContinuation([finished, running, ready], "s1")?.id).toBe("a1");
    expect(findPortalReportContinuation([finished], "s1")).toBeUndefined();
    expect(findPortalReportContinuation([ready], "other")).toBeUndefined();
  });
});
