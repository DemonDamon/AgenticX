import { describe, expect, it } from "vitest";
import {
  isTurnInterruptionNoticeMessage,
  parseTurnInterruptionNotice,
  shouldAutoResumeTruncationInterruption,
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
});
