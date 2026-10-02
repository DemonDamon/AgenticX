import { describe, expect, it } from "vitest";
import { shouldDeferAutoReport } from "./auto-report-gate";

describe("shouldDeferAutoReport", () => {
  const now = 1_000_000;
  it("defers while another sub-agent of the same session is running", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [
          { sessionId: "s1", status: "completed" },
          { sessionId: "s1", status: "running" },
        ],
        oldestQueuedAt: now - 1000,
        now,
      }),
    ).toBe(true);
  });

  it("does not defer when everything in the session has finished", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [
          { sessionId: "s1", status: "completed" },
          { sessionId: "s1", status: "failed" },
        ],
        oldestQueuedAt: now - 1000,
        now,
      }),
    ).toBe(false);
  });

  it("ignores active sub-agents of other sessions", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [{ sessionId: "s2", status: "running" }],
        oldestQueuedAt: now,
        now,
      }),
    ).toBe(false);
  });

  it("releases after the max defer window", () => {
    expect(
      shouldDeferAutoReport({
        sessionId: "s1",
        subAgents: [{ sessionId: "s1", status: "running" }],
        oldestQueuedAt: now - 11 * 60 * 1000,
        now,
      }),
    ).toBe(false);
  });
});
