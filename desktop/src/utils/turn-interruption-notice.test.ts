import { describe, expect, it } from "vitest";
import {
  isTurnInterruptionNoticeMessage,
  parseTurnInterruptionNotice,
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
});
