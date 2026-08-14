import { describe, expect, it } from "vitest";
import type { DeepResearchEvent } from "@agenticx/core-api";
import { appendDeepResearchEvent } from "./deep-research-events";

function snapshot(text: string, done = false): DeepResearchEvent {
  return {
    type: "reasoning",
    id: "section-core",
    phase: "synthesize",
    title: "核心结论",
    text,
    kind: "reasoning",
    ...(done ? { done: true } : {}),
  };
}

describe("appendDeepResearchEvent", () => {
  it("replaces a stage snapshot without moving it past later events", () => {
    const current: DeepResearchEvent[] = [
      { type: "phase", phase: "synthesize", message: "正在撰写核心结论" },
      snapshot("第一版"),
      { type: "artifact", id: "a1", path: "memo.md", title: "备忘", kind: "memo", bytes: 1 },
    ];
    const next = appendDeepResearchEvent(current, snapshot("最终版", true), 200);
    expect(next).toHaveLength(3);
    expect(next[1]).toMatchObject({ type: "reasoning", text: "最终版", done: true });
    expect(next[2]?.type).toBe("artifact");
  });

  it("retains the normal bounded append behavior for durable events", () => {
    const next = appendDeepResearchEvent(
      [{ type: "run_started", runId: "r1" }],
      { type: "phase", phase: "plan", message: "规划中" },
      1,
    );
    expect(next).toEqual([{ type: "phase", phase: "plan", message: "规划中" }]);
  });
});
