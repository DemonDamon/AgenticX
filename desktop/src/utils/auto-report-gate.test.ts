import { describe, expect, it } from "vitest";
import {
  shouldAutoReportSubagentCompletion,
  shouldDeferAutoReport,
  shouldNotifySubagentCompletion,
} from "./auto-report-gate";

describe("shouldDeferAutoReport", () => {
  const now = 1_000_000;
  it("defers while another sub-agent of the same session is running", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [
          { sessionId: "s1", status: "completed" },
          { sessionId: "s1", status: "running" },
        ],
        oldestQueuedAt: now - 1000,
        now,
      }),
    ).toBe(true);
  });

  it("does not defer when everything in the session has finished", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [
          { sessionId: "s1", status: "completed" },
          { sessionId: "s1", status: "failed" },
        ],
        oldestQueuedAt: now - 1000,
        now,
      }),
    ).toBe(false);
  });

  it("ignores active sub-agents of other sessions", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [{ sessionId: "s2", status: "running" }],
        oldestQueuedAt: now,
        now,
      }),
    ).toBe(false);
  });

  it("releases after the max defer window", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [{ sessionId: "s1", status: "running" }],
        oldestQueuedAt: now - 11 * 60 * 1000,
        now,
      }),
    ).toBe(false);
  });
});

describe("shouldNotifySubagentCompletion", () => {
  it("does not notify when a sub-agent is first seen already terminal (restart hydrate)", () => {
    expect(shouldNotifySubagentCompletion(undefined, "completed")).toBe(false);
    expect(shouldNotifySubagentCompletion(undefined, "failed")).toBe(false);
    expect(shouldNotifySubagentCompletion(undefined, "paused")).toBe(false);
  });

  it("notifies when status transitions from active to terminal in this process", () => {
    expect(shouldNotifySubagentCompletion("running", "completed")).toBe(true);
    expect(shouldNotifySubagentCompletion("pending", "failed")).toBe(true);
    expect(shouldNotifySubagentCompletion("awaiting_confirm", "paused")).toBe(true);
  });

  it("does not notify when already terminal", () => {
    expect(shouldNotifySubagentCompletion("completed", "completed")).toBe(false);
    expect(shouldNotifySubagentCompletion("failed", "paused")).toBe(false);
  });
});

describe("shouldAutoReportSubagentCompletion", () => {
  it("skips Near CodeBuddy CLI children by run id prefix", () => {
    expect(
      shouldAutoReportSubagentCompletion({ agentId: "cb-subagent-6e61fa0175-1" }),
    ).toBe(false);
  });

  it("skips Near Claude Code CLI children by run id prefix", () => {
    expect(
      shouldAutoReportSubagentCompletion({ runId: "cc-subagent-abc123-2" }),
    ).toBe(false);
  });

  it("skips by near-* source_tool_call_id even without id prefix", () => {
    expect(
      shouldAutoReportSubagentCompletion({
        agentId: "mystery-run",
        sourceToolCallId: "near-cb-6e61fa0175",
      }),
    ).toBe(false);
    expect(
      shouldAutoReportSubagentCompletion({
        agentId: "mystery-run",
        sourceToolCallId: "near-cc-deadbeef",
      }),
    ).toBe(false);
  });

  it("skips when kind is cross-harness and orchestrated_by near", () => {
    expect(
      shouldAutoReportSubagentCompletion({
        agentId: "other-id",
        kind: "codebuddy",
        detailRefs: { orchestrated_by: "near" },
      }),
    ).toBe(false);
    expect(
      shouldAutoReportSubagentCompletion({
        agentId: "other-id",
        kind: "claude-code",
        detailRefs: { orchestrated_by: "near" },
      }),
    ).toBe(false);
  });

  it("keeps auto-report for native AGX sa-* / spawn_subagent children", () => {
    expect(shouldAutoReportSubagentCompletion({ agentId: "sa-abc123" })).toBe(true);
    expect(
      shouldAutoReportSubagentCompletion({
        agentId: "sa-abc123",
        kind: "subagent",
        sourceToolCallId: "toolu_spawn_1",
      }),
    ).toBe(true);
  });
});

