import { describe, expect, it } from "vitest";
import { applyToolStepToState, emptyPaneGraphState, type ToolStep } from "./graph-types";

function step(overrides?: Partial<ToolStep>): ToolStep {
  return {
    callId: "call_1",
    toolName: "web_search",
    phase: "calling",
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("applyToolStepToState", () => {
  it("updates phase in place for the same callId", () => {
    let s = emptyPaneGraphState();
    s = applyToolStepToState(s, "agent:a1", step({ phase: "calling", updatedAt: 1000 }));
    s = applyToolStepToState(s, "agent:a1", step({ phase: "done", updatedAt: 2000 }));
    const rows = s.toolStepsByNode["agent:a1"];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phase).toBe("done");
    expect(rows[0]?.startedAt).toBe(1000);
    expect(rows[0]?.updatedAt).toBe(2000);
  });

  it("appends distinct callIds even with the same toolName", () => {
    let s = emptyPaneGraphState();
    s = applyToolStepToState(s, "agent:a1", step({ callId: "c1", phase: "done" }));
    s = applyToolStepToState(s, "agent:a1", step({ callId: "c2", phase: "calling", updatedAt: 1500 }));
    expect(s.toolStepsByNode["agent:a1"]).toHaveLength(2);
    expect(s.toolStepsByNode["agent:a1"]?.map((r) => r.callId)).toEqual(["c1", "c2"]);
  });

  it("returns the same state for empty nodeId or callId", () => {
    const s = emptyPaneGraphState();
    expect(applyToolStepToState(s, "", step())).toBe(s);
    expect(applyToolStepToState(s, "agent:a1", step({ callId: "" }))).toBe(s);
  });
});
