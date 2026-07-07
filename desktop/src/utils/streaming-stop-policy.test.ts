import { describe, expect, it } from "vitest";
import {
  canStopCurrentRun,
  isDoubleEnterWithinWindow,
  isStreamRunActiveForQueue,
  resolveQueueSessionKey,
  shouldEnqueueOnResend,
  shouldInterruptOnResend,
  shouldShowSessionWorkInProgress,
  shouldShowStopButton,
  shouldShowStopForExecutionState,
} from "./streaming-stop-policy";
import type { Message } from "../store";

describe("shouldShowStopForExecutionState", () => {
  it("shows stop only when running", () => {
    expect(shouldShowStopForExecutionState("running")).toBe(true);
    expect(shouldShowStopForExecutionState("idle")).toBe(false);
    expect(shouldShowStopForExecutionState("interrupted")).toBe(false);
    expect(shouldShowStopForExecutionState(undefined)).toBe(false);
  });
});

describe("shouldShowStopButton", () => {
  it("prefers active SSE on current session", () => {
    expect(
      shouldShowStopButton({
        streaming: true,
        streamingSessionId: "s1",
        currentSessionId: "s1",
        executionState: "idle",
      })
    ).toBe(true);
  });

  it("shows stop when backend still running after SSE ended", () => {
    expect(
      shouldShowStopButton({
        streaming: false,
        streamingSessionId: "",
        currentSessionId: "s1",
        executionState: "running",
      })
    ).toBe(true);
  });

  it("keeps delegation fallback for avatar panes", () => {
    expect(
      shouldShowStopButton({
        streaming: false,
        streamingSessionId: "",
        currentSessionId: "s1",
        executionState: "idle",
        hasDelegation: true,
        isGroupPane: false,
      })
    ).toBe(true);
  });
});

describe("resolveQueueSessionKey", () => {
  it("falls back to in-flight session when current session is empty", () => {
    expect(
      resolveQueueSessionKey({
        currentSessionId: "",
        inFlightSessionId: "old-sess",
      })
    ).toBe("old-sess");
  });

  it("does not borrow in-flight session while awaiting fresh lazy session", () => {
    expect(
      resolveQueueSessionKey({
        currentSessionId: "",
        inFlightSessionId: "old-sess",
        awaitingFreshSession: true,
      })
    ).toBe("");
  });

  it("prefers current session when both are set", () => {
    expect(
      resolveQueueSessionKey({
        currentSessionId: "new-sess",
        inFlightSessionId: "old-sess",
      })
    ).toBe("new-sess");
  });
});

describe("isStreamRunActiveForQueue", () => {
  it("treats in-flight send lock as active even when stream ref cleared", () => {
    expect(
      isStreamRunActiveForQueue({
        sessionId: "s1",
        streamStateActive: false,
        sendInFlightForSession: true,
        executionState: "idle",
        currentSessionId: "s1",
      })
    ).toBe(true);
  });

  it("treats backend running state as active for current session", () => {
    expect(
      isStreamRunActiveForQueue({
        sessionId: "s1",
        streamStateActive: false,
        sendInFlightForSession: false,
        executionState: "running",
        currentSessionId: "s1",
      })
    ).toBe(true);
  });
});

describe("message queue resend policy", () => {
  it("enqueues by default while streaming", () => {
    expect(shouldEnqueueOnResend({ isStreamRunActive: true })).toBe(true);
    expect(shouldInterruptOnResend({ isStreamRunActive: true })).toBe(false);
  });

  it("force send interrupts instead of enqueueing", () => {
    expect(shouldEnqueueOnResend({ isStreamRunActive: true, forceSend: true })).toBe(false);
    expect(shouldInterruptOnResend({ isStreamRunActive: true, forceSend: true })).toBe(true);
  });

  it("queue drain sends without re-enqueueing or barge-in interrupt", () => {
    expect(shouldEnqueueOnResend({ isStreamRunActive: true, queueDrain: true })).toBe(false);
    expect(shouldInterruptOnResend({ isStreamRunActive: true, queueDrain: true })).toBe(false);
  });

  it("detects double-enter within window", () => {
    const now = 10_000;
    expect(isDoubleEnterWithinWindow(now - 200, now)).toBe(true);
    expect(isDoubleEnterWithinWindow(now - 500, now)).toBe(false);
  });
});

describe("canStopCurrentRun", () => {
  it("requires matching session ids", () => {
    expect(
      canStopCurrentRun({
        streaming: true,
        streamingSessionId: "a",
        currentSessionId: "b",
      })
    ).toBe(false);
  });
});

describe("shouldShowSessionWorkInProgress", () => {
  const userMsg: Message = { id: "u1", role: "user", content: "do task" };
  const toolMsg: Message = { id: "t1", role: "tool", toolName: "file_read", content: "ok" };

  it("shows for unattended session after tool without final assistant reply", () => {
    expect(
      shouldShowSessionWorkInProgress({
        isStreamingCurrentSession: false,
        executionState: "interrupted",
        sessionUnattended: true,
        unattendedGlobalEnabled: true,
        messages: [userMsg, toolMsg],
      })
    ).toBe(true);
  });

  it("hides when user stopped the session", () => {
    expect(
      shouldShowSessionWorkInProgress({
        isStreamingCurrentSession: false,
        executionState: "interrupted",
        sessionUnattended: true,
        unattendedGlobalEnabled: true,
        userStopped: true,
        messages: [userMsg, toolMsg],
      })
    ).toBe(false);
  });

  it("hides when todos are all completed", () => {
    const todoDone: Message = {
      id: "todo1",
      role: "tool",
      toolName: "todo_write",
      content: "🗂 任务清单更新\n[x] a\n[x] b\n(2/2 completed)",
    };
    expect(
      shouldShowSessionWorkInProgress({
        isStreamingCurrentSession: false,
        executionState: "idle",
        sessionUnattended: true,
        unattendedGlobalEnabled: true,
        messages: [userMsg, todoDone],
      })
    ).toBe(false);
  });

  it("shows stop when session work is in progress without local SSE", () => {
    expect(
      shouldShowStopButton({
        streaming: false,
        streamingSessionId: "",
        currentSessionId: "s1",
        executionState: "idle",
        sessionWorkInProgress: true,
      })
    ).toBe(true);
  });
});
