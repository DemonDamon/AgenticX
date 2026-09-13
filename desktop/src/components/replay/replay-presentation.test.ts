import { describe, expect, it } from "vitest";
import {
  assistantTextStreamBeatType,
  bindMessagesToRun,
  canEnterPresentation,
  nextPresentationBeat,
  presentationAssistantStreamMs,
  presentationDwellMs,
  presentationSpeedForEnter,
  previousPresentationBeat,
  projectPresentedMessage,
  revealPresentedAssistantText,
  sliceMessagesForPresentation,
} from "./replay-presentation";
import type { ReplayEvent, ReplayRun } from "./replay-types";

function event(
  seq: number,
  type: string,
  overrides: Partial<ReplayEvent> = {},
): ReplayEvent {
  return {
    eventId: `event-${seq}`,
    runId: "run-1",
    seq,
    ts: 1_000 + seq * 10,
    type,
    agentId: "meta",
    title: type,
    summary: "",
    effectClass: "none",
    branchable: false,
    ...overrides,
  };
}

function run(status: ReplayRun["status"] = "completed"): ReplayRun {
  return {
    runId: "run-1",
    sessionId: "session-1",
    turnId: "turn-1",
    agentId: "meta",
    status,
    createdAt: 1_000,
    completedAt: 2_000,
    eventCount: 4,
    completeness: "complete",
  };
}

function msg(
  id: string,
  role: string,
  content = "",
  extras: Record<string, unknown> = {},
) {
  return { id, role, content, ...extras };
}

describe("presentation beats", () => {
  const events = [
    event(1, "run_started"),
    event(2, "user_message"),
    event(3, "round_started"),
    event(4, "tool_call", { toolCallId: "call-1" }),
    event(5, "tool_progress", { toolCallId: "call-1" }),
    event(6, "context_stats"),
    event(7, "tool_result", { toolCallId: "call-1" }),
    event(8, "assistant_output_completed"),
    event(9, "run_completed"),
  ];

  it("skips progress and stats when finding the next beat", () => {
    expect(nextPresentationBeat(events, 4)?.seq).toBe(7);
    expect(nextPresentationBeat(events, 7)?.seq).toBe(8);
    expect(nextPresentationBeat(events, 9)).toBeUndefined();
  });

  it("steps back to the previous beat", () => {
    expect(previousPresentationBeat(events, 7)?.seq).toBe(4);
    expect(previousPresentationBeat(events, 2)).toBeUndefined();
  });

  it("uses beat dwell, not wall-clock, and halves assistant text at 2x", () => {
    expect(presentationDwellMs("assistant_output_completed", 1)).toBe(1_200);
    expect(presentationDwellMs("assistant_output_completed", 2)).toBe(600);
    expect(presentationDwellMs("user_message", 1)).toBe(300);
    expect(presentationDwellMs("tool_call", 1)).toBe(400);
    expect(presentationDwellMs("error", 1)).toBe(1_500);
    expect(presentationDwellMs("assistant_output_completed", "instant")).toBe(80);
  });

  it("keeps the chosen presentation speed instead of forcing 2x", () => {
    expect(presentationSpeedForEnter(1)).toBe(1);
    expect(presentationSpeedForEnter(2)).toBe(2);
    expect(presentationSpeedForEnter("instant")).toBe("instant");
    expect(presentationSpeedForEnter(0.5)).toBe(0.5);
  });

  it("sizes assistant typewriter by character count, not the 600ms beat dwell", () => {
    expect(presentationAssistantStreamMs(1, 2)).toBe(600);
    expect(presentationAssistantStreamMs(684, 2)).toBe(684 * 18);
    expect(presentationAssistantStreamMs(400, 1)).toBe(400 * 36);
    expect(presentationAssistantStreamMs(684, 2)).toBeGreaterThan(8_000);
  });
});

describe("bindMessagesToRun + slice", () => {
  const events = [
    event(1, "run_started"),
    event(2, "user_message", { title: "查参数", payload: { text: "查参数" } }),
    event(3, "tool_call", { toolCallId: "call-1" }),
    event(4, "tool_progress", { toolCallId: "call-1" }),
    event(5, "tool_result", { toolCallId: "call-1" }),
    event(6, "assistant_output_started"),
    event(7, "assistant_output_completed"),
    event(8, "run_completed"),
  ];

  const messages = [
    msg("prev-user", "user", "上一轮问题"),
    msg("prev-asst", "assistant", "上一轮回答"),
    msg("cur-user", "user", "查参数"),
    msg("cur-tool", "tool", "ok", { toolCallId: "call-1", toolStatus: "done" }),
    msg("cur-asst", "assistant", "昇腾 950DT 表格"),
    msg("next-user", "user", "下一轮"),
  ];

  it("keeps earlier turns, reveals the current run by seq, and hides later turns", () => {
    const binding = bindMessagesToRun(messages, events);
    expect(binding.canPresent).toBe(true);
    expect(sliceMessagesForPresentation(messages, binding, 2, 8).map((item) => item.id))
      .toEqual(["prev-user", "prev-asst", "cur-user"]);
    expect(sliceMessagesForPresentation(messages, binding, 5, 8).map((item) => item.id))
      .toEqual(["prev-user", "prev-asst", "cur-user", "cur-tool"]);
    expect(sliceMessagesForPresentation(messages, binding, 8, 8).map((item) => item.id))
      .toEqual(["prev-user", "prev-asst", "cur-user", "cur-tool", "cur-asst"]);
  });

  it("shows a calling tool card until the result beat, and streams assistant text on the completed beat", () => {
    const binding = bindMessagesToRun(messages, events);
    const calling = projectPresentedMessage(messages[3], binding, 3);
    expect(calling.toolStatus).toBe("running");
    const done = projectPresentedMessage(messages[3], binding, 5);
    expect(done.toolStatus).toBe("done");
    const writing = projectPresentedMessage(messages[4], binding, 6);
    expect(writing.content).toBe("");
    expect(writing.presentationHoldDeliverables).toBe(true);
    const mid = projectPresentedMessage(messages[4], binding, 7, {
      elapsedMs: 300,
      durationMs: 1_200,
    });
    expect(mid.content).toBe("昇腾 ");
    expect(mid.blocks).toBeUndefined();
    expect(mid.presentationHoldDeliverables).toBe(true);
    const finished = projectPresentedMessage(messages[4], binding, 7, {
      elapsedMs: 1_200,
      durationMs: 1_200,
    });
    expect(finished.content).toBe("昇腾 950DT 表格");
    expect(finished.presentationHoldDeliverables).toBeUndefined();
    const after = projectPresentedMessage(messages[4], binding, 8);
    expect(after.content).toBe("昇腾 950DT 表格");
    expect(after.presentationHoldDeliverables).toBeUndefined();
    const stepped = projectPresentedMessage(messages[4], binding, 7, {
      elapsedMs: 0,
      durationMs: 1_200,
      snapFull: true,
    });
    expect(stepped.content).toBe("昇腾 950DT 表格");
    expect(stepped.presentationHoldDeliverables).toBeUndefined();
  });

  it("reveals assistant text by elapsed ratio and only streams on the text beat", () => {
    expect(revealPresentedAssistantText("你好世界", 0, 1_000)).toBe("");
    expect(revealPresentedAssistantText("你好世界", 250, 1_000)).toBe("你");
    expect(revealPresentedAssistantText("你好世界", 500, 1_000)).toBe("你好");
    expect(revealPresentedAssistantText("你好世界", 1_000, 1_000)).toBe("你好世界");
    expect(assistantTextStreamBeatType(events, 6)).toBe("");
    expect(assistantTextStreamBeatType(events, 7)).toBe("assistant_output_completed");
    expect(assistantTextStreamBeatType([
      event(1, "user_message"),
      event(2, "assistant_output_started"),
      event(3, "run_completed"),
    ], 2)).toBe("assistant_output_started");
  });

  it("holds unmatched in-run rows until the last seq", () => {
    const extra = [...messages.slice(0, 5), msg("orphan", "assistant", "对不上的旁注")];
    const binding = bindMessagesToRun(extra, events);
    expect(sliceMessagesForPresentation(extra, binding, 7, 8).map((item) => item.id))
      .not.toContain("orphan");
    expect(sliceMessagesForPresentation(extra, binding, 8, 8).map((item) => item.id))
      .toContain("orphan");
  });

  it("refuses a running run or a chat that cannot align a user/assistant row", () => {
    const binding = bindMessagesToRun(messages, events);
    expect(canEnterPresentation(run("running"), binding).ok).toBe(false);
    expect(canEnterPresentation(run("completed"), binding).ok).toBe(true);
    expect(canEnterPresentation(run("completed"), bindMessagesToRun([], events)).ok).toBe(false);
    expect(canEnterPresentation(run("failed"), binding).ok).toBe(true);
  });
});
