import { describe, expect, it } from "vitest";
import {
  applyPinnedAutoExpand,
  COLLAPSED_SUMMARY_SECTIONS,
  contentDrivenOpenSections,
  exclusiveOpenSections,
} from "./summary-sections";

describe("exclusiveOpenSections", () => {
  it("opens only the focused section", () => {
    expect(exclusiveOpenSections("changes")).toEqual({
      ...COLLAPSED_SUMMARY_SECTIONS,
      changes: true,
    });
    expect(exclusiveOpenSections("artifacts")).toEqual({
      ...COLLAPSED_SUMMARY_SECTIONS,
      artifacts: true,
    });
  });
});

describe("contentDrivenOpenSections", () => {
  it("mirrors content flags for the overview", () => {
    expect(
      contentDrivenOpenSections({
        todo: true,
        artifacts: true,
        changes: false,
        spawns: true,
        refs: false,
        members: false,
      }),
    ).toEqual({
      todo: true,
      artifacts: true,
      changes: false,
      spawns: true,
      refs: false,
      members: false,
    });
  });
});

describe("applyPinnedAutoExpand", () => {
  it("does not auto-open sibling sections while 变更 is pinned", () => {
    const pinned = exclusiveOpenSections("changes");
    expect(applyPinnedAutoExpand(pinned, "todo", true, "changes")).toBe(pinned);
    expect(applyPinnedAutoExpand(pinned, "spawns", true, "changes")).toBe(pinned);
    expect(applyPinnedAutoExpand(pinned, "refs", true, "changes")).toBe(pinned);
    expect(applyPinnedAutoExpand(pinned, "artifacts", true, "changes")).toBe(pinned);
  });

  it("keeps the pinned section open even when its content disappears", () => {
    const pinned = exclusiveOpenSections("changes");
    expect(applyPinnedAutoExpand(pinned, "changes", false, "changes")).toBe(pinned);
  });

  it("opens the pinned section if it was collapsed", () => {
    const next = applyPinnedAutoExpand(COLLAPSED_SUMMARY_SECTIONS, "artifacts", true, "artifacts");
    expect(next.artifacts).toBe(true);
    expect(next.changes).toBe(false);
  });

  it("without a pin, follows content arrival", () => {
    const opened = applyPinnedAutoExpand(COLLAPSED_SUMMARY_SECTIONS, "todo", true, null);
    expect(opened.todo).toBe(true);
    const closed = applyPinnedAutoExpand(opened, "todo", false, null);
    expect(closed.todo).toBe(false);
  });
});
