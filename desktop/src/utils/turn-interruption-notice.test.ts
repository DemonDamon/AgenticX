import { describe, expect, it } from "vitest";
import {
  findCurrentTurnTruncationAutoResume,
  isTurnInterruptionNoticeMessage,
  parseTurnInterruptionNotice,
  shouldAutoResumeTruncationInterruption,
  shouldShowTurnInterruptedSyncToast,
  TURN_INTERRUPTED_KIND,
} from "./turn-interruption-notice";

describe("turn-interruption-notice", () => {
  it("detects metadata kind", () => {
    const msg = {
      role: "tool" as const,
      content: "上一步工具执行后未收到模型最终响应。可点「恢复执行」继续。",
      metadata: { kind: TURN_INTERRUPTED_KIND, cause: "no_final" },
    };
    expect(isTurnInterruptionNoticeMessage(msg)).toBe(true);
    expect(parseTurnInterruptionNotice(msg)?.cause).toBe("no_final");
  });

  it("ignores normal tool rows", () => {
    expect(
      isTurnInterruptionNoticeMessage({
        role: "tool",
        content: "exit_code=0",
        metadata: {},
      }),
    ).toBe(false);
  });

  it("exposes failure_summary for runtime_failure", () => {
    const msg = {
      role: "tool" as const,
      content: "模型调用失败：API 调用参数有误，请检查文档。invalid input。可点「恢复执行」重试。",
      metadata: {
        kind: TURN_INTERRUPTED_KIND,
        cause: "runtime_failure",
        failure_summary: "API 调用参数有误，请检查文档。invalid input",
      },
    };
    const parsed = parseTurnInterruptionNotice(msg);
    expect(parsed?.cause).toBe("runtime_failure");
    expect(parsed?.failureSummary).toContain("invalid input");
  });

  it("preserves the suspected truncated final cause", () => {
    const parsed = parseTurnInterruptionNotice({
      role: "tool",
      content: "这条回答似乎没有说完。可点「继续」补全。",
      metadata: {
        kind: TURN_INTERRUPTED_KIND,
        cause: "suspected_truncated_final",
      },
    });

    expect(parsed?.cause).toBe("suspected_truncated_final");
  });

  it("does not auto-resume a historical truncation after a newer non-truncation interrupt", () => {
    const oldTruncation = {
      id: "old-trunc",
      role: "tool" as const,
      content: "本轮生成已取消，未收到模型最终响应。可点「恢复执行」继续。（原因：工具参数流式截断）",
      metadata: {
        kind: TURN_INTERRUPTED_KIND,
        cause: "cancelled",
        detector: "streamed_tool_call_truncated",
      },
    };
    const laterUser = { id: "u2", role: "user" as const, content: "看下 huggingface laya" };
    const laterNoFinal = {
      id: "later-nofinal",
      role: "tool" as const,
      content: "本轮生成已取消，未收到模型最终响应。可点「恢复执行」继续。",
      metadata: { kind: TURN_INTERRUPTED_KIND, cause: "no_final" },
    };
    const parked = {
      id: "a2",
      role: "assistant" as const,
      content: "无可自主推进的代码任务",
    };
    expect(
      findCurrentTurnTruncationAutoResume([
        { id: "u1", role: "user" as const, content: "先做 fan-out" },
        oldTruncation,
        laterUser,
        laterNoFinal,
        parked,
      ]),
    ).toBeNull();
  });

  it("auto-resumes only when the latest current-turn interrupt is a truncation", () => {
    const truncation = {
      id: "cur-trunc",
      role: "tool" as const,
      content: "本轮生成已取消…（原因：工具参数流式截断）",
      metadata: {
        kind: TURN_INTERRUPTED_KIND,
        cause: "cancelled",
        detector: "streamed_tool_call_truncated",
      },
    };
    expect(
      findCurrentTurnTruncationAutoResume([
        { id: "u1", role: "user" as const, content: "写脚本" },
        truncation,
      ])?.id,
    ).toBe("cur-trunc");
  });

  it("auto-resumes streamed tool truncation but not user interrupt", () => {
    expect(
      shouldAutoResumeTruncationInterruption({
        role: "tool",
        content: "本轮生成已取消…（原因：工具参数流式截断）",
        metadata: {
          kind: TURN_INTERRUPTED_KIND,
          cause: "cancelled",
          detector: "streamed_tool_call_truncated",
        },
      }),
    ).toBe(true);
    expect(
      shouldAutoResumeTruncationInterruption({
        role: "tool",
        content: "已按用户请求中断当前生成。可点「恢复执行」继续。",
        metadata: {
          kind: TURN_INTERRUPTED_KIND,
          cause: "user_interrupt",
        },
      }),
    ).toBe(false);
  });

  it("does not toast a completed group turn that never emits final", () => {
    expect(
      shouldShowTurnInterruptedSyncToast({
        aborted: false,
        receivedFinalEvent: false,
        isGroupPane: true,
        receivedGroupDone: true,
        receivedGroupTerminal: false,
      }),
    ).toBe(false);
    expect(
      shouldShowTurnInterruptedSyncToast({
        aborted: false,
        receivedFinalEvent: false,
        isGroupPane: true,
        receivedGroupDone: false,
        receivedGroupTerminal: true,
      }),
    ).toBe(false);
  });

  it("still toasts 1:1 streams that end without final", () => {
    expect(
      shouldShowTurnInterruptedSyncToast({
        aborted: false,
        receivedFinalEvent: false,
        isGroupPane: false,
        receivedGroupDone: false,
        receivedGroupTerminal: false,
      }),
    ).toBe(true);
  });
});
