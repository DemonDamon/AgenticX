import { describe, expect, it } from "vitest";
import { summarizeAgentActivity } from "./agent-activity";

describe("summarizeAgentActivity", () => {
  it("counts running/pending, awaiting_confirm and awaiting_input", () => {
    const s = summarizeAgentActivity([
      { status: "running" },
      { status: "pending" },
      { status: "awaiting_confirm" },
      { status: "awaiting_input" },
    ]);
    expect(s).toEqual({ running: 2, awaitingConfirm: 1, awaitingInput: 1, active: 4 });
  });

  it("ignores finished and paused agents", () => {
    const s = summarizeAgentActivity([
      { status: "completed" },
      { status: "failed" },
      { status: "cancelled" },
      { status: "paused" },
    ]);
    expect(s.active).toBe(0);
  });

  it("returns zero for empty input", () => {
    expect(summarizeAgentActivity([]).active).toBe(0);
  });
});
