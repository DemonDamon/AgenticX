import { describe, expect, it } from "vitest";
import type { MaWireEvent } from "./ma-types";
import {
  applyMaEvents,
  applyMaPreview,
  createMaTranscript,
  pendingMaApprovals,
  reconcilePendingUserRows,
  type MaAdapterOptions,
} from "./ma-event-adapter";

const SID = "01HMASESSION0000000000000A";
const T1 = "01HMATOOLUSE0000000000001A";
const T2 = "01HMATOOLUSE0000000000002A";
const T3 = "01HMATOOLUSE0000000000003A";

const labels: MaAdapterOptions["labels"] = {
  retries: "本轮执行失败，已停止重试",
  refusal: "模型拒绝了本次请求",
  policy: "本轮内容触发企业合规策略，已停止",
  terminated: "会话已结束",
  customToolPending: "等待业务系统处理",
  rounds: "已达到最大工具调用轮数",
  budget: "本轮已超出托管用量上限",
  confirmQuestion: (tool: string) => `允许执行「${tool}」？`,
};

const opts: MaAdapterOptions = { assistantName: "报告助手", labels };

function ev(seq: number, id: string, type: string, extra: Record<string, unknown> = {}): MaWireEvent {
  return { id, seq, type, created_at: "2026-10-25T00:00:00.000Z", ...extra };
}

describe("ma event adapter", () => {
  it("maps user and agent messages", () => {
    const transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMAUSERMSG00000000000001A", "user.message", { content: [{ type: "text", text: "你好" }] }),
      ev(2, "01HMATHINKING0000000000002A", "agent.thinking", { content: [{ type: "text", text: "先看一下" }] }),
      ev(3, "01HMAAGENTMSG0000000000003A", "agent.message", { content: [{ type: "text", text: "好的" }] }),
    ], opts);
    expect(transcript.rows).toHaveLength(2);
    expect(transcript.rows[1]).toMatchObject({
      role: "assistant",
      content: "好的",
      reasoning: "先看一下",
      avatarName: "报告助手",
    });
    expect(transcript.lastSeq).toBe(3);
  });

  it("skips events at or below lastSeq", () => {
    const batch = [
      ev(1, "01HMAUSERMSG00000000000001A", "user.message", { content: [{ type: "text", text: "a" }] }),
      ev(2, "01HMAAGENTMSG0000000000002A", "agent.message", { content: [{ type: "text", text: "b" }] }),
    ];
    const once = applyMaEvents(createMaTranscript(SID), batch, opts);
    const twice = applyMaEvents(once, batch, opts);
    expect(twice.rows).toHaveLength(once.rows.length);
    const unordered = applyMaEvents(createMaTranscript(SID), [batch[1], batch[0]], opts);
    expect(unordered.rows).toHaveLength(1);
    expect(unordered.rows[0]?.content).toBe("b");
    expect(unordered.lastSeq).toBe(2);
  });

  it("maps tool_use and tool_result like ChatPane", () => {
    let transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, T1, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_allow" }),
    ], opts);
    expect(transcript.rows[0]).toMatchObject({
      role: "tool",
      content: '{"command":"ls"}',
      toolCallId: T1,
      toolStatus: "running",
    });
    transcript = applyMaEvents(transcript, [
      ev(2, "01HMATOOLRES00000000000002A", "agent.tool_result", {
        tool_use_id: T1,
        content: [{ type: "text", text: "a\n b" }],
      }),
    ], opts);
    expect(transcript.rows[0]).toMatchObject({
      content: "a\n b",
      toolStatus: "done",
      toolResultPreview: "a b",
      toolStreamLines: [],
    });
    transcript = applyMaEvents(transcript, [
      ev(3, "01HMATOOLRES00000000000003A", "agent.tool_result", {
        tool_use_id: T1,
        content: [{ type: "text", text: "nope" }],
        is_error: true,
      }),
    ], opts);
    expect(transcript.rows[0]?.toolStatus).toBe("error");
    transcript = applyMaEvents(transcript, [
      ev(4, "01HMATOOLRES00000000000004A", "agent.tool_result", {
        tool_use_id: T1,
        content: [{ type: "text", text: "CANCELLED: x" }],
      }),
    ], opts);
    expect(transcript.rows[0]?.toolStatus).toBe("cancelled");
  });

  it("consecutive tools share toolGroupId", () => {
    const transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, T1, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_allow" }),
      ev(2, T2, "agent.tool_use", { name: "bash_exec", input: { command: "pwd" }, evaluated_policy: "always_allow" }),
      ev(3, "01HMAAGENTMSG0000000000003A", "agent.message", { content: [{ type: "text", text: "done" }] }),
      ev(4, T3, "agent.tool_use", { name: "bash_exec", input: { command: "whoami" }, evaluated_policy: "always_allow" }),
    ], opts);
    expect(transcript.rows[0]?.toolGroupId).toBe(transcript.rows[1]?.toolGroupId);
    expect(transcript.rows[3]?.toolGroupId).not.toBe(transcript.rows[0]?.toolGroupId);
  });

  it("maps mcp and custom tool uses", () => {
    let transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, T1, "agent.mcp_tool_use", {
        mcp_server: "github",
        name: "get_issue",
        input: { number: 1 },
        evaluated_policy: "always_allow",
      }),
      ev(2, T2, "agent.custom_tool_use", { name: "crm_lookup", input: { id: "c1" } }),
    ], opts);
    expect(transcript.rows[0]?.toolName).toBe("github/get_issue");
    expect(transcript.rows[1]).toMatchObject({
      toolStatus: "pending",
      toolResultPreview: "等待业务系统处理",
    });
    expect(transcript.rows[1]?.metadata?.maCustomTool).toBe(true);
    transcript = applyMaEvents(transcript, [
      ev(3, "01HMACUSTOMRES000000000003A", "user.custom_tool_result", {
        custom_tool_use_id: T2,
        content: [{ type: "text", text: "found" }],
      }),
    ], opts);
    expect(transcript.rows[1]).toMatchObject({ content: "found", toolStatus: "done" });
  });

  it("requires_action adds inline confirm and pending approvals", () => {
    let transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, T1, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_ask" }),
      ev(2, "01HMAIDLE00000000000000002A", "session.status_idle", {
        stop_reason: { type: "requires_action", event_ids: [T1] },
      }),
    ], opts);
    expect(transcript.status).toBe("requires_action");
    expect(transcript.rows[0]?.inlineConfirm?.requestId).toBe(T1);
    expect(transcript.rows[0]?.inlineConfirm?.context?.maManaged).toBe(true);
    expect(transcript.rows[0]?.inlineConfirm?.context && "tool" in transcript.rows[0].inlineConfirm.context).toBe(false);
    expect(pendingMaApprovals(transcript)).toHaveLength(1);
    transcript = applyMaEvents(transcript, [
      ev(3, "01HMACONFIRM00000000000003A", "user.tool_confirmation", { tool_use_id: T1, result: "allow" }),
      ev(4, "01HMARUNNING0000000000004A", "session.status_running"),
    ], opts);
    expect(transcript.rows[0]?.inlineConfirm).toBeUndefined();
    expect(pendingMaApprovals(transcript)).toEqual([]);
  });

  it("deny marks cancelled and interrupt cancels running tools", () => {
    const denied = applyMaEvents(createMaTranscript(SID), [
      ev(1, T1, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_ask" }),
      ev(2, "01HMAIDLE00000000000000002A", "session.status_idle", {
        stop_reason: { type: "requires_action", event_ids: [T1] },
      }),
      ev(3, "01HMACONFIRM00000000000003A", "user.tool_confirmation", { tool_use_id: T1, result: "deny" }),
    ], opts);
    expect(denied.rows[0]?.toolStatus).toBe("cancelled");

    const interrupted = applyMaEvents(createMaTranscript(SID), [
      ev(1, T1, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_allow" }),
      ev(2, "01HMAINTERRUPT000000000002A", "user.interrupt"),
      ev(3, "01HMAIDLE00000000000000003A", "session.status_idle", { stop_reason: { type: "end_turn" } }),
    ], opts);
    expect(interrupted.rows[0]?.toolStatus).toBe("cancelled");
  });

  it("appends stop notices", () => {
    const rounds = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMAIDLE00000000000000001A", "session.status_idle", { stop_reason: { type: "max_tool_rounds" } }),
    ], opts);
    expect(rounds.rows.at(-1)?.noticeKind).toBe("rounds_exhausted");
    expect(rounds.rows.at(-1)?.systemNotice).toBe(true);
    expect(rounds.rows.at(-1)?.content).toBe(labels.rounds);

    const budget = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMAIDLE00000000000000001A", "session.status_idle", { stop_reason: { type: "budget_exceeded" } }),
    ], opts);
    expect(budget.rows.at(-1)?.noticeKind).toBe("budget_exceeded");
    expect(budget.rows.at(-1)?.budgetSource).toBe("managed");
    expect(budget.rows.at(-1)?.systemNotice).toBe(true);

    const policy = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMAIDLE00000000000000001A", "session.status_idle", { stop_reason: { type: "policy_blocked" } }),
    ], opts);
    expect(policy.rows.at(-1)?.systemNotice).toBe(true);
    expect(policy.rows.at(-1)?.content).toBe(labels.policy);

    const endTurn = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMAAGENTMSG0000000000001A", "agent.message", { content: [{ type: "text", text: "ok" }] }),
      ev(2, "01HMAIDLE00000000000000002A", "session.status_idle", { stop_reason: { type: "end_turn" } }),
    ], opts);
    expect(endTurn.rows).toHaveLength(1);
  });

  it("session.error renders a system notice", () => {
    const transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMAERROR000000000000001A", "session.error", {
        error: { type: "upstream", message: "超时", retry_status: { type: "retrying" } },
      }),
    ], opts);
    expect(transcript.rows[0]).toMatchObject({
      systemNotice: true,
      content: "正在重试：超时",
    });
    expect(transcript.rows[0]?.metadata).toMatchObject({ maErrorType: "upstream", retry: "retrying" });
  });

  it("dangling thinking flushes at idle", () => {
    const transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMATHINKING0000000000001A", "agent.thinking", { content: [{ type: "text", text: "还在想" }] }),
      ev(2, "01HMAIDLE00000000000000002A", "session.status_idle", { stop_reason: { type: "end_turn" } }),
    ], opts);
    expect(transcript.rows).toHaveLength(1);
    expect(transcript.rows[0]).toMatchObject({ role: "assistant", content: "", reasoning: "还在想" });
  });

  it("preview frames build liveText and reset on message", () => {
    let transcript = createMaTranscript(SID);
    transcript = applyMaPreview(transcript, { type: "event_start", event: { type: "agent.message" } });
    transcript = applyMaPreview(transcript, { type: "event_delta", event_type: "agent.message", content_delta: "He" });
    transcript = applyMaPreview(transcript, { type: "event_delta", event_type: "agent.message", content_delta: "llo" });
    expect(transcript.liveText).toBe("Hello");
    transcript = applyMaEvents(transcript, [
      ev(1, "01HMAAGENTMSG0000000000001A", "agent.message", { content: [{ type: "text", text: "Hello" }] }),
    ], opts);
    expect(transcript.liveText).toBe("");
  });

  it("ignores events with thread_id", () => {
    const transcript = applyMaEvents(createMaTranscript(SID), [
      ev(1, "01HMAAGENTMSG0000000000001A", "agent.message", {
        thread_id: "X",
        content: [{ type: "text", text: "hidden" }],
      }),
    ], opts);
    expect(transcript.rows).toHaveLength(0);
    expect(transcript.lastSeq).toBe(1);
  });

  it("reconcilePendingUserRows drops echoed rows FIFO", () => {
    const pending = [
      { id: "p1", role: "user" as const, content: "a" },
      { id: "p2", role: "user" as const, content: "a" },
      { id: "p3", role: "user" as const, content: "b" },
    ];
    const rows = [{ id: "s1", role: "user" as const, content: "a" }];
    expect(reconcilePendingUserRows(pending, rows).map((row) => row.content)).toEqual(["a", "b"]);
  });

  it("returns new objects", () => {
    const base = applyMaEvents(createMaTranscript(SID), [
      ev(1, T1, "agent.tool_use", { name: "bash_exec", input: { command: "ls" }, evaluated_policy: "always_allow" }),
    ], opts);
    const originalRows = base.rows;
    const originalRow = base.rows[0];
    const next = applyMaEvents(base, [
      ev(2, "01HMATOOLRES00000000000002A", "agent.tool_result", {
        tool_use_id: T1,
        content: [{ type: "text", text: "ok" }],
      }),
    ], opts);
    expect(base.rows).toBe(originalRows);
    expect(base.rows).toHaveLength(1);
    expect(next.rows[0]).not.toBe(originalRow);
    expect(originalRow?.toolStatus).toBe("running");
  });
});
