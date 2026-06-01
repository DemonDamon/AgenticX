import { describe, expect, it } from "vitest";
import type { Message } from "../store";
import { shouldHideStreamOverlay, shouldShowMidTurnStreamActivity } from "./stream-overlay-policy";

const assistant = (content: string): Message => ({
  id: "a1",
  role: "assistant",
  content,
});

const user = (content: string): Message => ({
  id: "u1",
  role: "user",
  content,
});

describe("shouldHideStreamOverlay", () => {
  it("shows empty stream before any assistant commit", () => {
    expect(shouldHideStreamOverlay(true, "", [user("hi")])).toBe(false);
  });

  it("hides empty stream after assistant text was committed for tool gap", () => {
    expect(
      shouldHideStreamOverlay(true, "", [user("记住"), assistant("已记入长期记忆。")]),
    ).toBe(true);
  });

  it("hides stream when text matches committed assistant", () => {
    expect(
      shouldHideStreamOverlay(true, "已记入长期记忆。", [
        user("记住"),
        assistant("已记入长期记忆。"),
      ]),
    ).toBe(true);
  });

  it("shows stream when new tokens differ from committed assistant", () => {
    expect(
      shouldHideStreamOverlay(true, "继续补充", [user("记住"), assistant("已记入长期记忆。")]),
    ).toBe(false);
  });
});

describe("shouldShowMidTurnStreamActivity", () => {
  it("is true when streaming with hidden overlay (tool gap)", () => {
    expect(shouldShowMidTurnStreamActivity(true, true)).toBe(true);
  });

  it("is false when stream overlay is visible", () => {
    expect(shouldShowMidTurnStreamActivity(true, false)).toBe(false);
  });

  it("is false when not streaming", () => {
    expect(shouldShowMidTurnStreamActivity(false, true)).toBe(false);
  });
});
