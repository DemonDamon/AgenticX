import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";

describe("setReportPendingSessions", () => {
  beforeEach(() => {
    useAppStore.getState().setReportPendingSessions([]);
  });

  it("dedupes, trims and drops empty ids", () => {
    useAppStore.getState().setReportPendingSessions(["b", " a ", "b", ""]);
    expect(useAppStore.getState().reportPendingSessionIds).toEqual(["a", "b"]);
  });

  it("keeps the same state reference when nothing changes", () => {
    useAppStore.getState().setReportPendingSessions(["a"]);
    const before = useAppStore.getState().reportPendingSessionIds;
    useAppStore.getState().setReportPendingSessions(["a"]);
    expect(useAppStore.getState().reportPendingSessionIds).toBe(before);
  });

  it("clears when the queue is empty", () => {
    useAppStore.getState().setReportPendingSessions(["a"]);
    useAppStore.getState().setReportPendingSessions([]);
    expect(useAppStore.getState().reportPendingSessionIds).toEqual([]);
  });
});
