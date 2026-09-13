import { describe, expect, it } from "vitest";
import {
  groupEventsIntoLanes,
  projectReplay,
  visibleEventsAtCursor,
} from "./replay-projection";
import {
  normalizeReplayEventsResponse,
  normalizeReplayRunsResponse,
} from "./replay-types";
import type { ReplayEvent } from "./replay-types";

function event(
  seq: number,
  type: string,
  overrides: Partial<ReplayEvent> = {},
): ReplayEvent {
  return {
    eventId: `event-${seq}`,
    runId: "run-1",
    seq,
    ts: seq * 1_000,
    type,
    agentId: "meta",
    title: type,
    summary: "",
    effectClass: "none",
    branchable: false,
    ...overrides,
  };
}

describe("replay response normalization", () => {
  it("normalizes snake_case contracts and maps unknown enums honestly", () => {
    const result = normalizeReplayRunsResponse({
      runs: [{
        run_id: "run-1",
        session_id: "session-1",
        turn_id: "turn-1",
        agent_id: "meta",
        status: "future_status",
        created_at: 10,
        event_count: 3,
        branch_count: 2,
        completeness: "complete",
      }],
    });

    expect(result.runs[0]).toMatchObject({
      runId: "run-1",
      status: "interrupted",
      createdAt: 10_000,
      branchCount: 2,
    });
    expect(result.parseWarnings).toContain("run run-1: unknown status future_status");
  });

  it("skips invalid events and keeps parse warnings", () => {
    const result = normalizeReplayEventsResponse({
      run: {
        run_id: "run-1",
        session_id: "session-1",
        turn_id: "turn-1",
        agent_id: "meta",
        status: "running",
        created_at: 1,
        event_count: 2,
        completeness: "partial",
      },
      events: [
        {
          event_id: "",
          run_id: "run-1",
          seq: 1,
          ts: 1,
          type: "tool_call",
          agent_id: "meta",
        },
        {
          event_id: "valid",
          run_id: "run-1",
          seq: 2,
          ts: 2,
          type: "tool_call",
          agent_id: "meta",
          effect_class: "future_effect",
        },
        {
          event_id: "bad-seq",
          run_id: "run-1",
          seq: 0,
          ts: 3,
          type: "error",
          agent_id: "meta",
        },
      ],
      next_seq: 2,
      has_more: false,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.effectClass).toBe("unknown");
    expect(result.parseWarnings).toHaveLength(3);
  });

  it("marks lazily resolved payloads so replay cache avoids refetching", () => {
    const result = normalizeReplayEventsResponse({
      run: {
        run_id: "run-1",
        session_id: "session-1",
        turn_id: "turn-1",
        agent_id: "meta",
        status: "completed",
        created_at: 1,
        event_count: 1,
        completeness: "complete",
      },
      events: [{
        event_id: "event-1",
        run_id: "run-1",
        seq: 1,
        ts: 1,
        type: "tool_result",
        agent_id: "meta",
        payload_ref: "blob-1",
        payload: { preview: "short" },
        resolved_payload: { result: "full" },
      }],
      next_seq: 1,
      has_more: false,
    });

    expect(result.events[0]).toMatchObject({
      payload: { preview: "short", result: "full" },
      payloadPreviewText: expect.stringContaining('"result": "full"'),
      payloadPreviewTruncated: false,
    });
  });

  it("normalizes nested sub-agent replay references for the existing drawer", () => {
    const result = normalizeReplayEventsResponse({
      run: {
        run_id: "run-1",
        session_id: "session-1",
        turn_id: "turn-1",
        agent_id: "meta",
        status: "running",
        created_at: 1,
        event_count: 1,
        completeness: "complete",
      },
      events: [{
        event_id: "event-1",
        run_id: "run-1",
        seq: 1,
        ts: 1,
        type: "tool_call",
        agent_id: "meta",
        payload: { name: "delegate_to_avatar" },
        subagent_runs: [{ run: { run_id: "sub-run-1" }, activity: [] }],
      }],
      next_seq: 1,
      has_more: false,
    });

    expect(result.events[0]?.payload?.subagent_run_id).toBe("sub-run-1");
  });
});

describe("replay projection", () => {
  it("merges 100 tool call/result pairs into exactly 100 spans", () => {
    const events = Array.from({ length: 100 }, (_, index) => {
      const callSeq = index * 2 + 1;
      const toolCallId = `call-${index}`;
      return [
        event(callSeq, "tool_call", { toolCallId }),
        event(callSeq + 1, "tool_result", { toolCallId }),
      ];
    }).flat();

    expect(projectReplay(events).spans.filter((span) => span.kind === "tool")).toHaveLength(100);
  });

  it("orders meta first and remaining lanes by first sequence", () => {
    const lanes = groupEventsIntoLanes([
      event(1, "subagent_started", { agentId: "worker-b" }),
      event(2, "round_started", { agentId: "meta" }),
      event(3, "tool_call", { agentId: "worker-a", toolCallId: "call-a" }),
    ]);

    expect(lanes.map((lane) => lane.agentId)).toEqual(["meta", "worker-b", "worker-a"]);
  });

  it("marks unclosed tools interrupted and clips state at cursor", () => {
    const events = [
      event(100, "tool_call", { toolCallId: "call-open" }),
      event(101, "assistant_output_started"),
      event(102, "assistant_output_completed"),
      event(103, "run_completed"),
    ];
    const projection = projectReplay(events);

    expect(projection.spans.find((span) => span.toolCallId === "call-open")?.status).toBe("interrupted");
    expect(visibleEventsAtCursor(events, 101).map((item) => item.seq)).toEqual([100, 101]);
  });

  it("keeps an unclosed tool running while the run has no terminal event", () => {
    const projection = projectReplay([
      event(1, "tool_call", { toolCallId: "call-live" }),
      event(2, "tool_progress", { toolCallId: "call-live" }),
    ]);

    expect(projection.spans.find((span) => span.toolCallId === "call-live")?.status).toBe("running");
  });

  it("keeps ledger gaps visible under tool-only filtering", () => {
    const projection = projectReplay([
      event(1, "round_started"),
      event(2, "ledger_gap", { title: "gap" }),
      event(3, "tool_call", { toolCallId: "call-1" }),
    ], new Set(["tool"]));

    expect(projection.visibleEvents.map((item) => item.type)).toEqual(["ledger_gap", "tool_call"]);
  });

  it("counts distinct sub-agent runs from ledger payloads", () => {
    const projection = projectReplay([
      event(1, "subagent_started", { payload: { run_id: "sub-1" } }),
      event(2, "subagent_started", { payload: { run_id: "sub-2" } }),
      event(3, "subagent_progress", { payload: { run_id: "sub-1" } }),
    ]);

    expect(projection.stats.subagents).toBe(2);
  });

  it("does not miscount run resume markers as branches", () => {
    const projection = projectReplay([
      event(1, "run_resumed", { payload: { parent_run_id: "run-parent" } }),
    ]);

    expect(projection.stats.branches).toBe(0);
  });

  it("deduplicates event ids and reports duplicate sequences", () => {
    const projection = projectReplay([
      event(1, "round_started"),
      event(1, "tool_call", { eventId: "event-other", toolCallId: "call-1" }),
      event(2, "error", { eventId: "event-1" }),
    ]);

    expect(projection.events).toHaveLength(1);
    expect(projection.warnings).toEqual([
      "duplicate seq 1",
      "duplicate event id event-1",
    ]);
  });
});
