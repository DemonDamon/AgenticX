import { describe, expect, it } from "vitest";
import { visibleWorkItemActions } from "./GroupWorkItemList";

describe("visibleWorkItemActions", () => {
  it("shows accept and pause for submitted", () => {
    expect(visibleWorkItemActions("submitted")).toEqual(["accept", "pause"]);
  });

  it("shows only resume for paused", () => {
    expect(visibleWorkItemActions("paused")).toEqual(["resume"]);
  });

  it("shows only pause for open and in_progress", () => {
    expect(visibleWorkItemActions("open")).toEqual(["pause"]);
    expect(visibleWorkItemActions("in_progress")).toEqual(["pause"]);
  });

  it("hides actions for accepted and cancelled", () => {
    expect(visibleWorkItemActions("accepted")).toEqual([]);
    expect(visibleWorkItemActions("cancelled")).toEqual([]);
  });
});
