import { describe, expect, it } from "vitest";
import { shouldClearMessagesOnSessionSwitch } from "./pane-session-switch";

describe("shouldClearMessagesOnSessionSwitch", () => {
  it("clears when switching between two distinct real sessions", () => {
    expect(shouldClearMessagesOnSessionSwitch("sess-a", "sess-b")).toBe(true);
  });

  it("does not clear when rebinding the same session id", () => {
    expect(shouldClearMessagesOnSessionSwitch("sess-a", "sess-a")).toBe(false);
  });

  it("does not clear on lazy-create (empty -> real id) so caller-set state survives", () => {
    expect(shouldClearMessagesOnSessionSwitch("", "sess-a")).toBe(false);
  });

  it("does not clear when unbinding to empty (new-topic path handles its own wipe)", () => {
    expect(shouldClearMessagesOnSessionSwitch("sess-a", "")).toBe(false);
  });

  it("treats whitespace-only ids as empty", () => {
    expect(shouldClearMessagesOnSessionSwitch("  ", "sess-a")).toBe(false);
    expect(shouldClearMessagesOnSessionSwitch("sess-a", "   ")).toBe(false);
  });

  it("ignores surrounding whitespace when comparing ids", () => {
    expect(shouldClearMessagesOnSessionSwitch("sess-a", " sess-a ")).toBe(false);
    expect(shouldClearMessagesOnSessionSwitch(" sess-a ", "sess-b")).toBe(true);
  });

  it("handles null / undefined inputs as empty", () => {
    expect(shouldClearMessagesOnSessionSwitch(null, "sess-a")).toBe(false);
    expect(shouldClearMessagesOnSessionSwitch(undefined, undefined)).toBe(false);
    expect(shouldClearMessagesOnSessionSwitch("sess-a", null)).toBe(false);
  });
});
