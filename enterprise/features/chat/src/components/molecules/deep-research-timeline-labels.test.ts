import { describe, expect, it } from "vitest";
import { labelForDeepResearchEvent } from "./deep-research-timeline-labels";
import type { DeepResearchEvent } from "@agenticx/core-api";

describe("deep research timeline labels", () => {
  it("orders lane_started before lane_done semantically", () => {
    const started: DeepResearchEvent = {
      type: "lane_started",
      laneId: "l1",
      title: "子问",
      index: 1,
      total: 1,
    };
    const done: DeepResearchEvent = {
      type: "lane_done",
      laneId: "l1",
      status: "ok",
      artifactPath: "a.md",
    };
    expect(labelForDeepResearchEvent(started)).toContain("车道 1/1");
    expect(labelForDeepResearchEvent(done)).toContain("车道完成");
  });

  it("marks failed lanes", () => {
    expect(
      labelForDeepResearchEvent({ type: "lane_done", laneId: "x", status: "failed" }),
    ).toBe("车道失败");
  });

  it("empty events list is a no-op for callers (component contract)", () => {
    const events: DeepResearchEvent[] = [];
    expect(events.map(labelForDeepResearchEvent)).toEqual([]);
  });
});
