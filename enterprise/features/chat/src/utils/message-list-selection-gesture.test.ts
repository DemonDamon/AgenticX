import { describe, expect, it } from "vitest";
import {
  hasActiveTextSelection,
  shouldCancelLongPressOnMove,
  shouldStartLongPress,
} from "./message-list-selection-gesture";

describe("message-list-selection-gesture", () => {
  it("starts long press only for touch pointers", () => {
    expect(shouldStartLongPress("touch")).toBe(true);
    expect(shouldStartLongPress("mouse")).toBe(false);
    expect(shouldStartLongPress("pen")).toBe(false);
  });

  it("cancels long press when pointer moves beyond threshold", () => {
    expect(shouldCancelLongPressOnMove(0, 0, 0, 9)).toBe(true);
    expect(shouldCancelLongPressOnMove(0, 0, 4, 4)).toBe(false);
  });

  it("detects active text selection", () => {
    expect(hasActiveTextSelection("hello")).toBe(true);
    expect(hasActiveTextSelection("  ")).toBe(false);
    expect(hasActiveTextSelection("")).toBe(false);
    expect(hasActiveTextSelection(null)).toBe(false);
  });
});
