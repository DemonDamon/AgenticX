import { describe, expect, it } from "vitest";
import {
  buildCausalChain,
  extractReplayPaths,
  formatCausalChainMarkdown,
} from "./replay-causal-chain";
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

const MARKDOWN_LABELS = {
  heading: "因果链",
  recorded: "已记录",
  inferred: "推断",
  reasons: {
    parent_event: "父事件",
    tool_call_id: "工具调用配对",
    wait_pair: "确认 / 澄清配对",
    path_in_tool_input: "路径出现在工具参数",
    failed_result_to_error: "失败结果之后的错误",
  },
  note: "标注为「推断」的边来自本次打开时的规则推算，不是运行账本里的字段，不会写回记录。",
} as const;

describe("buildCausalChain", () => {
  it("walks a recorded parent_event hop in chronological order", () => {
    const events = [
      event(1, "tool_call", { toolCallId: "call-1", title: "bash_exec" }),
      event(2, "tool_result", {
        toolCallId: "call-1",
        parentEventId: "event-1",
        title: "bash_exec",
      }),
    ];

    const chain = buildCausalChain(events, "event-2");

    expect(chain.eventIds).toEqual(["event-1", "event-2"]);
    expect(chain.hops).toEqual([{
      fromEventId: "event-1",
      toEventId: "event-2",
      kind: "recorded",
      reason: "parent_event",
    }]);
    expect(chain.inferredCount).toBe(0);
  });

  it("pairs tool_result to tool_call by toolCallId when parent is missing", () => {
    const events = [
      event(1, "tool_call", { toolCallId: "call-1" }),
      event(2, "tool_result", { toolCallId: "call-1" }),
    ];

    const chain = buildCausalChain(events, "event-2");

    expect(chain.hops).toEqual([{
      fromEventId: "event-1",
      toEventId: "event-2",
      kind: "recorded",
      reason: "tool_call_id",
    }]);
  });

  it("prefers parentEventId over a matching toolCallId", () => {
    const events = [
      event(1, "tool_call", { toolCallId: "call-1", title: "first" }),
      event(2, "tool_call", { toolCallId: "call-1", title: "second" }),
      event(3, "tool_result", {
        toolCallId: "call-1",
        parentEventId: "event-1",
      }),
    ];

    const chain = buildCausalChain(events, "event-3");

    expect(chain.hops).toEqual([{
      fromEventId: "event-1",
      toEventId: "event-3",
      kind: "recorded",
      reason: "parent_event",
    }]);
  });

  it("infers an error from the nearest failed tool result", () => {
    const events = [
      event(1, "tool_result", {
        title: "bash_exec",
        payload: { status: "failed" },
      }),
      event(2, "error", { title: "工具失败" }),
    ];

    const chain = buildCausalChain(events, "event-2");

    expect(chain.hops).toEqual([{
      fromEventId: "event-1",
      toEventId: "event-2",
      kind: "inferred",
      reason: "failed_result_to_error",
    }]);
    expect(chain.inferredCount).toBe(1);
  });

  it("infers a path hop from tool input onto a later artifact", () => {
    const events = [
      event(1, "tool_call", {
        title: "file_edit",
        payload: { arguments_summary: '{"path":"src/auth.ts"}' },
      }),
      event(2, "artifact", { summary: "wrote src/auth.ts" }),
    ];

    const chain = buildCausalChain(events, "event-2");

    expect(chain.hops).toEqual([{
      fromEventId: "event-1",
      toEventId: "event-2",
      kind: "inferred",
      reason: "path_in_tool_input",
    }]);
  });

  it("does not extract a bare filename without a directory", () => {
    const isolated = event(1, "artifact", { summary: "auth.ts" });
    const prior = event(1, "tool_call", { summary: "touched auth.ts" });
    const later = event(2, "artifact", { summary: "auth.ts" });

    expect(extractReplayPaths(isolated)).toEqual([]);
    expect(buildCausalChain([prior, later], "event-2").hops).toEqual([]);
  });

  it("infers a confirmation wait pair for the same agent", () => {
    const events = [
      event(1, "confirm_required", { agentId: "meta" }),
      event(2, "confirm_response", { agentId: "coder" }),
      event(3, "confirm_response", { agentId: "meta" }),
    ];

    const chain = buildCausalChain(events, "event-3");

    expect(chain.hops).toEqual([{
      fromEventId: "event-1",
      toEventId: "event-3",
      kind: "inferred",
      reason: "wait_pair",
    }]);
  });

  it("stops a parent cycle without throwing", () => {
    const events = [
      event(1, "tool_call", { parentEventId: "event-2", toolCallId: "call-1" }),
      event(2, "tool_result", { parentEventId: "event-1", toolCallId: "call-1" }),
    ];

    expect(() => buildCausalChain(events, "event-2")).not.toThrow();
    const chain = buildCausalChain(events, "event-2");
    expect(chain.hops.length).toBeLessThanOrEqual(24);
    expect(chain.eventIds.length).toBeLessThanOrEqual(25);
  });

  it("caps a linear parent walk at 24 hops", () => {
    const events = Array.from({ length: 26 }, (_, index) => {
      const seq = index + 1;
      return event(seq, "round_started", {
        parentEventId: seq > 1 ? `event-${seq - 1}` : undefined,
      });
    });

    const chain = buildCausalChain(events, "event-26");

    expect(chain.hops).toHaveLength(24);
    expect(chain.eventIds).toHaveLength(25);
    expect(chain.eventIds[0]).toBe("event-2");
    expect(chain.eventIds.at(-1)).toBe("event-26");
  });

  it("returns an empty event list when the target is missing", () => {
    expect(buildCausalChain([event(1, "tool_call")], "missing")).toEqual({
      targetEventId: "missing",
      eventIds: [],
      hops: [],
      inferredCount: 0,
    });
  });

  it("does not mutate the input events array or objects", () => {
    const events = [
      event(2, "tool_result", { parentEventId: "event-1", toolCallId: "call-1" }),
      event(1, "tool_call", { toolCallId: "call-1" }),
    ];
    const first = events[0];
    const snapshot = events.map((item) => ({ ...item }));

    buildCausalChain(events, "event-2");

    expect(events).toHaveLength(2);
    expect(events[0]).toBe(first);
    expect(events[0]?.title).toBe(snapshot[0]?.title);
    expect(events.map((item) => item.eventId)).toEqual(["event-2", "event-1"]);
  });
});

describe("formatCausalChainMarkdown", () => {
  it("includes the target seq, recorded/inferred labels, and a no-write-back note", () => {
    const events = [
      event(1, "tool_call", { toolCallId: "call-1", title: "bash_exec" }),
      event(2, "tool_result", {
        toolCallId: "call-1",
        parentEventId: "event-1",
        title: "bash_exec",
        payload: { status: "failed" },
      }),
      event(3, "error", { title: "工具失败" }),
    ];
    const chain = buildCausalChain(events, "event-3");
    const markdown = formatCausalChainMarkdown(chain, events, MARKDOWN_LABELS);

    expect(markdown).toContain("目标：#3 `error` 工具失败");
    expect(markdown).toContain("已记录");
    expect(markdown).toContain("推断");
    expect(markdown).toContain("不会写回");
    expect(markdown).not.toMatch(/总之|综上所述|作为 AI/);
  });
});
