import { describe, expect, it } from "vitest";
import {
  canStopCurrentRun,
  shouldShowStopButton,
  shouldShowStopForExecutionState,
} from "./streaming-stop-policy";

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
