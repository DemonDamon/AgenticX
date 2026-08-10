import { describe, expect, it } from "vitest";
import type { PortalLogItem } from "../portal-logs-query";
import type { AgentTraceSpanRow } from "../agent-trace-store";
import { assembleTraceTimeline } from "../trace-timeline";

function portalLog(partial: Partial<PortalLogItem> & Pick<PortalLogItem, "id" | "event">): PortalLogItem {
  return {
    tenant_id: "tenant-a",
    log_time: "2026-08-10T08:00:00.000Z",
    level: "info",
    trace_id: "01JZTRACEID000000000000001",
    user_id: "user-1",
    session_id: "session-1",
    route: "chat.completions",
    status: 200,
    duration_ms: 1200,
    error_name: null,
    error_message: null,
    error_stack: null,
    fields: null,
    ...partial,
  };
}

function span(partial: Partial<AgentTraceSpanRow> & Pick<AgentTraceSpanRow, "id" | "step_no">): AgentTraceSpanRow {
  return {
    trace_id: "01JZTRACEID000000000000001",
    step_kind: "model",
    status: "ok",
    model: "gpt-test",
    provider: "openai",
    input_tokens: 10,
    output_tokens: 20,
    reasoning_tokens: 0,
    total_tokens: 30,
    cost_usd: "0.001",
    duration_ms: 100,
    error_message: null,
    metadata: null,
    created_at: new Date("2026-08-10T08:00:00.000Z"),
    ...partial,
  };
}

describe("assembleTraceTimeline", () => {
  it("builds request → model → deep-research tree with sanitization", () => {
    const longNarrative = "n".repeat(250);
    const timeline = assembleTraceTimeline({
      traceId: "01JZTRACEID000000000000001",
      portalLogs: [
        portalLog({
          id: "log-1",
          event: "chat.completions.start",
          log_time: "2026-08-10T08:00:00.000Z",
          duration_ms: 1,
        }),
        portalLog({
          id: "log-2",
          event: "chat.completions.finish",
          log_time: "2026-08-10T08:00:10.000Z",
          duration_ms: 10000,
        }),
        portalLog({
          id: "log-3",
          event: "deep_research.stream.finish",
          route: "deep_research.stream",
          log_time: "2026-08-10T08:00:11.000Z",
          duration_ms: 50,
        }),
      ],
      modelSpans: [
        span({ id: "s1", step_no: 1, total_tokens: 30 }),
        span({ id: "s2", step_no: 2, total_tokens: 40 }),
        span({ id: "s3", step_no: 3, total_tokens: 50 }),
        span({ id: "s4", step_no: 4, total_tokens: 60 }),
      ],
      deepResearchRun: {
        runId: "run-1",
        sessionId: "session-1",
        status: "completed",
        phase: "done",
        topic: "topic",
        createdAt: "2026-08-10T08:00:00.000Z",
        updatedAt: "2026-08-10T08:00:10.000Z",
        events: [
          { type: "phase", phase: "lanes", message: "lanes" },
          { type: "lane_started", laneId: "lane-a", title: "Lane A", index: 0, total: 1 },
          {
            type: "lane_sources",
            laneId: "lane-a",
            sources: [{ title: "Doc", url: "https://example.com/doc" }],
          },
          { type: "lane_done", laneId: "lane-a", status: "ok" },
          { type: "artifact", id: "art-1", path: "/r.md", title: "Report", kind: "report", bytes: 12 },
          { type: "narrative", text: longNarrative },
          {
            type: "research_plan",
            runId: "run-1",
            action: "proposed",
            version: 1,
            plan: {
              version: 1,
              objective: "obj",
              scope: [],
              subQuestions: [{ id: "q1", title: "Q1", purpose: "secret purpose" }],
              sourceStrategy: [],
              deliverables: [],
              assumptions: [],
              prompt: "SHOULD_NOT_LEAK",
            },
          },
        ],
      },
    });

    expect(timeline.nodes).toHaveLength(3);
    const primary = timeline.nodes.find((n) => n.label === "chat.completions.finish");
    expect(primary).toBeTruthy();
    expect(primary?.children.filter((c) => c.kind === "model_step")).toHaveLength(4);

    const phase = primary?.children.find((c) => c.kind === "dr_phase");
    expect(phase?.label).toBe("phase: lanes");
    const lane = phase?.children.find((c) => c.kind === "dr_lane");
    expect(lane?.label).toBe("lane: Lane A");
    expect(lane?.children.some((c) => c.label === "lane_sources")).toBe(true);
    expect(lane?.children.some((c) => c.label === "lane_done")).toBe(true);

    expect(timeline.totals.tokens).toBe(30 + 40 + 50 + 60);
    expect(timeline.sources.deep_research_run).toBe(true);

    const narrative = primary?.children
      .flatMap((c) => [c, ...c.children, ...c.children.flatMap((x) => x.children)])
      .find((n) => n.label === "narrative");
    const text = String(narrative?.attrs?.text ?? "");
    expect(text.length).toBeLessThanOrEqual(201);
    expect(text.endsWith("…")).toBe(true);

    const planNode = primary?.children
      .flatMap((c) => [c, ...c.children, ...c.children.flatMap((x) => x.children)])
      .find((n) => n.label === "research_plan");
    const planJson = JSON.stringify(planNode?.attrs ?? {});
    expect(planJson.includes("SHOULD_NOT_LEAK")).toBe(false);
    expect(planJson.includes("secret purpose")).toBe(false);
    expect(planJson.includes("Q1")).toBe(true);
  });

  it("builds two-level tree without deep-research run", () => {
    const timeline = assembleTraceTimeline({
      traceId: "01JZTRACEID000000000000002",
      portalLogs: [
        portalLog({
          id: "log-x",
          event: "chat.completions.finish",
          duration_ms: 500,
        }),
      ],
      modelSpans: [span({ id: "s1", step_no: 1, total_tokens: 11 })],
      deepResearchRun: null,
    });

    expect(timeline.sources.deep_research_run).toBe(false);
    expect(timeline.nodes).toHaveLength(1);
    expect(timeline.nodes[0]?.children).toHaveLength(1);
    expect(timeline.nodes[0]?.children[0]?.kind).toBe("model_step");
    expect(timeline.totals.tokens).toBe(11);
  });

  it("labels model steps with stage and surfaces duration/error status", () => {
    const timeline = assembleTraceTimeline({
      traceId: "01JZTRACEID000000000000003",
      portalLogs: [
        portalLog({
          id: "log-y",
          event: "chat.completions.finish",
          duration_ms: 900,
        }),
      ],
      modelSpans: [
        span({
          id: "s-err",
          step_no: 2,
          duration_ms: 1234,
          status: "error",
          error_message: "upstream 500",
          metadata: { stage: "dr.lane.expand" },
        }),
      ],
      deepResearchRun: null,
    });

    const node = timeline.nodes[0]?.children[0];
    expect(node?.kind).toBe("model_step");
    expect(node?.label).toContain("dr.lane.expand");
    expect(node?.label).toContain("step 2");
    expect(node?.durationMs).toBe(1234);
    expect(node?.status).toBe("error");
    expect(node?.attrs?.stage).toBe("dr.lane.expand");
    expect(node?.attrs?.error_message).toBe("upstream 500");
  });
});
