import { describe, expect, it } from "vitest";

import {
  buildReplayTimeline,
  displayStatusKey,
  formatDuration,
  parseListQuery,
  type ReplayItem,
} from "../ma-session-console";

const units = { ms: "毫秒", s: "秒", m: "分" };
const now = new Date("2026-10-25T12:00:00Z");

function toolUse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "agent.tool_use",
    id: "T",
    seq: 4,
    created_at: "2026-10-25T00:00:00.000Z",
    name: "bash_exec",
    input: { cmd: "ls" },
    ...overrides,
  };
}

function toolResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "agent.tool_result",
    id: "R",
    seq: 5,
    created_at: "2026-10-25T00:00:01.500Z",
    tool_use_id: "T",
    is_error: false,
    content: [{ type: "text", text: "ok" }],
    ...overrides,
  };
}

describe("parseListQuery", () => {
  it("parseListQuery defaults to a 7 day window", () => {
    expect(parseListQuery(new URLSearchParams(), now)).toEqual({
      range: "7d",
      limit: 50,
      createdFrom: "2026-10-18T12:00:00.000Z",
    });
  });

  it("parseListQuery omits createdFrom for range=all", () => {
    expect(parseListQuery(new URLSearchParams("range=all"), now)).toEqual({ range: "all", limit: 50 });
  });

  it("parseListQuery rejects illegal filters", () => {
    expect(() => parseListQuery(new URLSearchParams("range=2d"), now)).toThrow("时间范围参数不合法");
    expect(() => parseListQuery(new URLSearchParams("agent_id=abc"), now)).toThrow("智能体参数不合法");
    expect(() => parseListQuery(new URLSearchParams("status=paused"), now)).toThrow("状态参数不合法");
    expect(() => parseListQuery(new URLSearchParams("source=im"), now)).toThrow("来源参数不合法");
    expect(() => parseListQuery(new URLSearchParams("limit=0"), now)).toThrow("分页参数不合法");
    expect(() => parseListQuery(new URLSearchParams("limit=500"), now)).toThrow("分页参数不合法");
    expect(() => parseListQuery(new URLSearchParams("before_id=x"), now)).toThrow("分页参数不合法");
  });

  it("parseListQuery normalizes user email", () => {
    const params = new URLSearchParams();
    params.set("user_email", " Alice@Example.com ");
    expect(parseListQuery(params, now).userEmail).toBe("alice@example.com");
  });
});

describe("buildReplayTimeline", () => {
  it("buildReplayTimeline merges tool use and result", () => {
    const use = toolUse();
    const result = toolResult();
    const forward = buildReplayTimeline([use, result]);
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({
      kind: "tool",
      seq: 4,
      result: { durationMs: 1500, text: "ok", isError: false },
    });
    expect(buildReplayTimeline([result, use])).toEqual(forward);
  });

  it("attaches confirmations and custom results", () => {
    const items = buildReplayTimeline([
      toolUse({ id: "T1", seq: 1, evaluated_policy: "always_ask", name: "bash_exec" }),
      {
        type: "session.status_idle",
        id: "S",
        seq: 2,
        created_at: "2026-10-25T00:00:00.100Z",
        stop_reason: { type: "requires_action", event_ids: ["T1"] },
      },
      {
        type: "user.tool_confirmation",
        id: "C",
        seq: 3,
        created_at: "2026-10-25T00:00:00.200Z",
        tool_use_id: "T1",
        result: "deny",
        deny_message: "no",
      },
      toolResult({ seq: 4, tool_use_id: "T1", is_error: true, content: [{ type: "text", text: "denied" }] }),
      {
        type: "agent.custom_tool_use",
        id: "C1",
        seq: 5,
        created_at: "2026-10-25T00:00:02.000Z",
        name: "ship",
        input: {},
      },
      {
        type: "user.custom_tool_result",
        id: "CR",
        seq: 6,
        created_at: "2026-10-25T00:00:03.000Z",
        custom_tool_use_id: "C1",
        content: [{ type: "text", text: "shipped" }],
      },
    ]);
    const tool = items.find((item) => item.kind === "tool" && item.toolType === "builtin");
    const custom = items.find((item) => item.kind === "tool" && item.toolType === "custom");
    const status = items.find((item) => item.kind === "status");
    expect(tool && tool.kind === "tool" ? tool.resolution : null).toMatchObject({ result: "deny", message: "no" });
    expect(tool && tool.kind === "tool" ? tool.result?.isError : null).toBe(true);
    expect(status && status.kind === "status" ? status.stopReason : null).toBe("requires_action");
    expect(custom && custom.kind === "tool" ? custom.toolType : null).toBe("custom");
    expect(custom && custom.kind === "tool" ? custom.result?.text : null).toBe("shipped");
  });

  it("pairs model request spans", () => {
    const start = {
      type: "span.model_request_start",
      id: "MS",
      seq: 3,
      created_at: "2026-10-25T00:00:00.000Z",
      model: "m",
    };
    const end = {
      type: "span.model_request_end",
      id: "ME",
      seq: 6,
      created_at: "2026-10-25T00:00:02.000Z",
      model: "m",
      model_usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
    };
    const paired = buildReplayTimeline([start, end]);
    expect(paired).toHaveLength(1);
    expect(paired[0]).toMatchObject({
      kind: "model_request",
      seq: 3,
      durationMs: 2000,
      usage: { input: 10, output: 5, cacheRead: 2 },
    });

    const onlyEnd = buildReplayTimeline([end]);
    expect(onlyEnd).toHaveLength(1);
    expect(onlyEnd[0]).toMatchObject({ kind: "model_request", durationMs: null });

    const other = buildReplayTimeline([
      { type: "session.thread_created", seq: 1, created_at: "2026-10-25T00:00:00.000Z" },
    ]);
    expect(other).toEqual<ReplayItem[]>([
      { kind: "other", seq: 1, at: "2026-10-25T00:00:00.000Z", type: "session.thread_created" },
    ]);
  });
});

describe("formatDuration", () => {
  it("formatDuration", () => {
    expect(formatDuration(320, units)).toBe("320 毫秒");
    expect(formatDuration(1500, units)).toBe("1.5 秒");
    expect(formatDuration(2000, units)).toBe("2 秒");
    expect(formatDuration(125000, units)).toBe("2 分 5 秒");
    expect(formatDuration(-1, units)).toBe("—");
    expect(formatDuration(Number.NaN, units)).toBe("—");
    expect(formatDuration(null, units)).toBe("—");
  });
});

describe("displayStatusKey", () => {
  it("displayStatusKey", () => {
    expect(displayStatusKey("idle", { type: "requires_action" })).toBe("requiresAction");
    expect(displayStatusKey("idle", { type: "end_turn" })).toBe("idle");
    expect(displayStatusKey("running", null)).toBe("running");
  });
});
