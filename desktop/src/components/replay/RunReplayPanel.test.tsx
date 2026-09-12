import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { getReplayExport, listReplayEvents, ReplayApiError } from "./replay-api";
import {
  copyReplayReview,
  resolveBranchAvailability,
  RunReplayPanel,
  shouldLoadAllReplayPages,
} from "./RunReplayPanel";
import { ReplayControls } from "./ReplayControls";
import { ReplayEventDetail } from "./ReplayEventDetail";
import { ReplaySummaryBar } from "./ReplaySummaryBar";
import { ReplayTimeline, handleReplayKeyDown } from "./ReplayTimeline";
import { formatReplayEventLabel } from "./replay-event-label";
import {
  payloadErrorForEvent,
  setPayloadErrorForEvent,
} from "./RunReplayPanel";
import type { ReplayEvent, ReplayRun } from "./replay-types";

const run: ReplayRun = {
  runId: "run / 1",
  sessionId: "session / 1",
  turnId: "turn-1",
  agentId: "meta",
  status: "completed",
  createdAt: 1_000,
  completedAt: 2_000,
  eventCount: 1,
  completeness: "partial",
};

function event(seq: number): ReplayEvent {
  return {
    eventId: `event-${seq}`,
    runId: run.runId,
    seq,
    ts: seq * 1_000,
    type: seq % 2 ? "tool_call" : "tool_result",
    agentId: "meta",
    toolCallId: `call-${Math.ceil(seq / 2)}`,
    title: `event ${seq}`,
    summary: "",
    effectClass: "unknown",
    branchable: false,
    unbranchableReason: "no_checkpoint",
  };
}

function render(node: React.ReactNode, language: "zh" | "en" = "zh"): string {
  void i18n.changeLanguage(language);
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe("replay API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes ids, uses desktop token, and returns pagination metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      run: {
        run_id: "run / 1",
        session_id: "session / 1",
        turn_id: "turn-1",
        agent_id: "meta",
        status: "running",
        created_at: 1,
        event_count: 1,
        completeness: "complete",
      },
      events: [{
        event_id: "event-1",
        run_id: "run / 1",
        seq: 1,
        ts: 1,
        type: "tool_call",
        agent_id: "meta",
        branchable: true,
        checkpoint_ref: "checkpoint-a",
        workspace_ref: "workspace-a",
      }],
      next_seq: 1,
      has_more: true,
    }), { status: 200 }));

    const result = await listReplayEvents("http://localhost:8000/", "secret", "run / 1", {
      afterSeq: 0,
      limit: 100,
      types: ["tool_call", "error"],
      includePayload: false,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/runs/run%20%2F%201/events?");
    expect(String(url)).toContain("types=tool_call%2Cerror");
    expect(new Headers(init?.headers).get("x-agx-desktop-token")).toBe("secret");
    expect(result).toMatchObject({ nextSeq: 1, hasMore: true });
    expect(result.events[0]).toMatchObject({
      checkpointRef: "checkpoint-a",
      workspaceRef: "workspace-a",
    });
  });

  it("surfaces backend 403 detail instead of returning an empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      detail: "desktop token required for sensitive replay data",
      code: "token_required",
    }), { status: 403 }));

    await expect(listReplayEvents("http://localhost:8000", "", "run-1")).rejects.toEqual(
      new ReplayApiError("desktop token required for sensitive replay data", 403, "token_required"),
    );
  });

  it("always requests the deterministic redacted backend export", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# deterministic review", { status: 200 }),
    );

    await expect(getReplayExport("http://localhost:8000", "secret", "run / 1", "markdown"))
      .resolves.toBe("# deterministic review");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("format=markdown&redact=true");
  });

  it("surfaces clipboard rejection after fetching the backend review", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# deterministic review", { status: 200 }),
    );
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));

    await expect(copyReplayReview(
      "http://localhost:8000",
      "secret",
      "run-1",
      writeText,
    )).rejects.toThrow("clipboard denied");
    expect(writeText).toHaveBeenCalledWith("# deterministic review");
  });
});

describe("replay UI", () => {
  it("renders honest no-session and partial states in Chinese and English", () => {
    const noSessionZh = render(
      <RunReplayPanel
        paneId="pane-a"
        sessionId=""
        apiBase="http://localhost:8000"
        apiToken="secret"
        avatarById={new Map()}
        agentIds={["meta"]}
        metaLeaderLabel="Machi"
      />,
    );
    const noSessionEn = render(
      <RunReplayPanel
        paneId="pane-a"
        sessionId=""
        apiBase="http://localhost:8000"
        apiToken="secret"
        avatarById={new Map()}
        agentIds={["meta"]}
        metaLeaderLabel="Machi"
      />,
      "en",
    );
    const partial = render(
      <ReplaySummaryBar
        runs={[run]}
        selectedRunId={run.runId}
        stats={{ durationMs: 1_000, rounds: 1, toolCalls: 2, errors: 1, subagents: 1, branches: 0 }}
        summarizing={false}
        onSelectRun={() => {}}
      />,
    );

    expect(noSessionZh).toContain("发送首条消息后可回放执行过程");
    expect(noSessionEn).toContain("Send your first message");
    expect(partial).toContain("记录不完整");
    expect(partial).not.toContain("<select");

    const sessionPlay = render(
      <ReplaySummaryBar
        runs={[run, { ...run, runId: "run / 2", createdAt: 2_000, completeness: "complete" }]}
        selectedRunId={run.runId}
        stats={{ durationMs: 1_000, rounds: 1, toolCalls: 2, errors: 0, subagents: 0, branches: 0 }}
        summarizing={false}
        onSelectRun={() => {}}
      />,
    );
    expect(sessionPlay).toContain("整段会话");
    expect(sessionPlay).toContain("<select");
  });

  it("renders controls and 500 timeline rows without React key warnings", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controls = render(
      <ReplayControls
        playing={false}
        speed={1}
        filters={new Set(["all"])}
        canStepBack={false}
        canStepForward
        copying={false}
        copyFeedback={null}
        onTogglePlay={() => {}}
        onStep={() => {}}
        onSpeedChange={() => {}}
        onFiltersChange={() => {}}
        onCopy={() => {}}
      />,
    );
    const presentControls = render(
      <ReplayControls
        playing={false}
        speed={2}
        filters={new Set(["all"])}
        canStepBack={false}
        canStepForward
        copying={false}
        copyFeedback={null}
        onTogglePlay={() => {}}
        onStep={() => {}}
        onSpeedChange={() => {}}
        onFiltersChange={() => {}}
        onCopy={() => {}}
        presenting={false}
        canPresent
        onTogglePresent={() => {}}
      />,
    );
    const timeline = render(
      <ReplayTimeline
        events={Array.from({ length: 500 }, (_, index) => event(index + 1))}
        rangeFirstSeq={1}
        rangeLastSeq={500}
        rangeFirstTs={1_000}
        cursorSeq={500}
        selectedEventId={null}
        avatarById={new Map()}
        metaLeaderLabel="Meta Test"
        onSeek={() => {}}
        onSelect={() => {}}
        onTogglePlay={() => {}}
        onStep={() => {}}
      />,
    );

    expect(controls).toContain("复制回顾");
    expect(controls).not.toContain("演示");
    expect(presentControls).toContain("演示");
    expect(timeline).toContain("#500");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows honest running status for an unclosed live tool span", () => {
    const timeline = render(
      <ReplayTimeline
        events={[event(1)]}
        rangeFirstSeq={1}
        rangeLastSeq={1}
        rangeFirstTs={1_000}
        cursorSeq={1}
        selectedEventId={null}
        avatarById={new Map()}
        metaLeaderLabel="Meta Test"
        onSeek={() => {}}
        onSelect={() => {}}
        onTogglePlay={() => {}}
        onStep={() => {}}
      />,
    );

    expect(timeline).toContain("运行中");
  });

  it("keeps tool payload folded by default", () => {
    const detail = render(
      <ReplayEventDetail
        event={{
          ...event(1),
          payload: { arguments_summary: "large input" },
          payloadPreviewText: '{\n  "arguments_summary": "large input"\n}',
        }}
        payloadLoading={false}
        payloadError={null}
        onLoadPayload={() => {}}
      />,
    );

    expect(detail).toContain("<details");
    expect(detail).not.toContain("<details open");
  });

  it("shows a recorded causal chain in event detail", () => {
    const call = { ...event(1), type: "tool_call", title: "bash_exec" };
    const result = {
      ...event(2),
      type: "tool_result",
      title: "bash_exec",
      parentEventId: "event-1",
    };
    const detail = render(
      <ReplayEventDetail
        event={result}
        payloadLoading={false}
        payloadError={null}
        onLoadPayload={() => {}}
        chain={{
          targetEventId: "event-2",
          eventIds: ["event-1", "event-2"],
          hops: [{
            fromEventId: "event-1",
            toEventId: "event-2",
            kind: "recorded",
            reason: "parent_event",
          }],
          inferredCount: 0,
        }}
        chainEvents={[call, result]}
      />,
    );

    expect(detail).toContain("因果链");
    expect(detail).toContain("已记录");
  });

  it("shows an empty causal chain message when there are no hops", () => {
    const isolated = { ...event(1), type: "round_started" };
    const detail = render(
      <ReplayEventDetail
        event={isolated}
        payloadLoading={false}
        payloadError={null}
        onLoadPayload={() => {}}
        chain={{
          targetEventId: isolated.eventId,
          eventIds: [isolated.eventId],
          hops: [],
          inferredCount: 0,
        }}
        chainEvents={[isolated]}
      />,
    );

    expect(detail).toContain("没有可追溯的前因");
    expect(detail).not.toContain("复制这条链");
  });

  it("keeps branch action visible but disabled with a localized reason", () => {
    const detail = render(
      <ReplayEventDetail
        event={{ ...event(2), unbranchableReason: "not_git_isolate" }}
        payloadLoading={false}
        payloadError={null}
        onLoadPayload={() => {}}
        canBranch={false}
        branchDisabledReason="not_git_isolate"
        onBranchFromStep={() => {}}
      />,
    );

    expect(detail).toContain("恢复到此步骤");
    expect(detail).toContain("当前会话不在 Git 隔离工作区");
    expect(detail).toContain("disabled");
  });

  it("requires a complete run and checkpoint ref for local branch preview", () => {
    const selected = { ...event(2), type: "tool_call" };
    const missingCheckpoint = {
      ...event(1),
      type: "tool_result",
      branchable: true,
    };
    expect(resolveBranchAvailability(
      { ...run, completeness: "complete" },
      [missingCheckpoint, selected],
      selected,
    )).toMatchObject({ event: null, reason: "checkpoint_unavailable" });
    expect(resolveBranchAvailability(
      { ...run, completeness: "partial" },
      [{ ...missingCheckpoint, checkpointRef: "cp-1" }, selected],
      selected,
    )).toMatchObject({ event: null, reason: "run_incomplete" });
  });

  it("never renders events after cursor while retaining the global scrubber range", () => {
    const timeline = render(
      <ReplayTimeline
        events={[event(2)]}
        rangeFirstSeq={1}
        rangeLastSeq={3}
        rangeFirstTs={1_000}
        cursorSeq={2}
        selectedEventId={null}
        avatarById={new Map()}
        metaLeaderLabel="Custom Meta"
        onSeek={() => {}}
        onSelect={() => {}}
        onTogglePlay={() => {}}
        onStep={() => {}}
      />,
    );

    expect(timeline).toContain('max="3"');
    expect(timeline).toContain("Custom Meta");
    expect(timeline).not.toContain("回放步骤 #3");
    expect(timeline).not.toContain("opacity-45");
  });

  it("renders 600 loaded events in explicit 500-row timeline batches", () => {
    const events = Array.from({ length: 600 }, (_, index) => event(index + 1));
    const initial = render(
      <ReplayTimeline
        events={events}
        renderLimit={500}
        rangeFirstSeq={1}
        rangeLastSeq={600}
        rangeFirstTs={1_000}
        cursorSeq={600}
        selectedEventId={null}
        avatarById={new Map()}
        metaLeaderLabel="Meta"
        onSeek={() => {}}
        onSelect={() => {}}
        onTogglePlay={() => {}}
        onStep={() => {}}
        onShowMore={() => {}}
      />,
    );
    const expanded = render(
      <ReplayTimeline
        events={events}
        renderLimit={1_000}
        rangeFirstSeq={1}
        rangeLastSeq={600}
        rangeFirstTs={1_000}
        cursorSeq={600}
        selectedEventId={null}
        avatarById={new Map()}
        metaLeaderLabel="Meta"
        onSeek={() => {}}
        onSelect={() => {}}
        onTogglePlay={() => {}}
        onStep={() => {}}
        onShowMore={() => {}}
      />,
    );

    expect(initial.match(/aria-label="回放步骤/g)).toHaveLength(500);
    expect(initial).toContain("显示更多事件");
    expect(initial).not.toContain('aria-label="回放步骤 #501"');
    expect(expanded.match(/aria-label="回放步骤/g)).toHaveLength(600);
  });

  it("shows summarizing instead of partial final metrics", () => {
    const summary = render(
      <ReplaySummaryBar
        runs={[run]}
        selectedRunId={run.runId}
        stats={{ durationMs: 1_000, rounds: 1, toolCalls: 100, errors: 0, subagents: 0, branches: 0 }}
        summarizing
        onSelectRun={() => {}}
      />,
    );

    expect(summary).toContain("正在汇总");
    expect(summary).not.toContain("工具调用 <strong");
  });

  it("loads every terminal status to completion but keeps running incremental", () => {
    for (const status of ["completed", "failed", "cancelled", "interrupted"] as const) {
      expect(shouldLoadAllReplayPages(status, true, false)).toBe(true);
    }
    expect(shouldLoadAllReplayPages("running", true, false)).toBe(false);
    expect(shouldLoadAllReplayPages("completed", false, false)).toBe(false);
    expect(shouldLoadAllReplayPages("completed", true, true)).toBe(false);
  });

  it("localizes known events and safely humanizes unknown event types", () => {
    const zh = i18n.getFixedT("zh", "workspace");
    const en = i18n.getFixedT("en", "workspace");
    const known = [
      "round_started",
      "assistant_output_started",
      "assistant_output_completed",
      "run_started",
      "run_resumed",
      "run_completed",
      "user_message",
      "ledger_gap",
      "tool_call",
      "tool_progress",
      "tool_result",
      "confirm_required",
      "confirm_response",
      "clarification_required",
      "clarification_response",
      "clarification_suspended",
      "subagent_started",
      "subagent_progress",
      "subagent_checkpoint",
      "subagent_completed",
      "subagent_error",
      "compaction",
      "context_stats",
      "stall",
      "artifact",
      "error",
    ];

    for (const type of known) {
      expect(formatReplayEventLabel(type, zh)).not.toContain("_");
      expect(formatReplayEventLabel(type, en)).not.toContain("_");
    }
    expect(formatReplayEventLabel("future_safe_event", zh)).toBe("未知事件（future safe event）");
    expect(formatReplayEventLabel("future_safe_event", en)).toBe("Unknown event (future safe event)");
  });

  it("uses localized event labels in detail instead of raw snake case", () => {
    const contextStats = render(
      <ReplayEventDetail
        event={{ ...event(1), type: "context_stats", title: "" }}
        payloadLoading={false}
        payloadError={null}
        onLoadPayload={() => {}}
      />,
    );
    const unknown = render(
      <ReplayEventDetail
        event={{ ...event(1), type: "future_safe_event", title: "" }}
        payloadLoading={false}
        payloadError={null}
        onLoadPayload={() => {}}
      />,
      "en",
    );

    expect(contextStats).toContain("上下文统计");
    expect(contextStats).not.toContain("context_stats");
    expect(unknown).toContain("Unknown event (future safe event)");
    expect(unknown).not.toContain("future_safe_event");
  });

  it("replaces a raw event-type title in the timeline", () => {
    const timeline = render(
      <ReplayTimeline
        events={[{ ...event(1), type: "context_stats", title: "context_stats" }]}
        rangeFirstSeq={1}
        rangeLastSeq={1}
        rangeFirstTs={1_000}
        cursorSeq={1}
        selectedEventId={null}
        avatarById={new Map()}
        metaLeaderLabel="Meta"
        onSeek={() => {}}
        onSelect={() => {}}
        onTogglePlay={() => {}}
        onStep={() => {}}
      />,
    );

    expect(timeline).toContain("上下文统计");
    expect(timeline).not.toContain("context_stats");
  });

  it("keeps payload errors isolated by event id", () => {
    const errors = setPayloadErrorForEvent({}, "event-a", "A failed");

    expect(payloadErrorForEvent(errors, "event-a")).toBe("A failed");
    expect(payloadErrorForEvent(errors, "event-b")).toBeNull();
  });

  it("maps keyboard playback controls and ignores editable targets", () => {
    const actions = {
      toggle: vi.fn(),
      step: vi.fn(),
      seekFirst: vi.fn(),
      seekLast: vi.fn(),
    };
    const preventDefault = vi.fn();

    handleReplayKeyDown({ key: " ", target: { tagName: "DIV" }, preventDefault }, actions);
    handleReplayKeyDown({ key: "ArrowRight", target: { tagName: "DIV" }, preventDefault }, actions);
    handleReplayKeyDown({ key: "Home", target: { tagName: "INPUT" }, preventDefault }, actions);

    expect(actions.toggle).toHaveBeenCalledOnce();
    expect(actions.step).toHaveBeenCalledWith(1);
    expect(actions.seekFirst).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
});
