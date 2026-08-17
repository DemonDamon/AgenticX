import { describe, expect, it } from "vitest";
import {
  labelForDeepResearchInteractionPref,
  normalizeDeepResearchInteractionPref,
} from "./deep-research-interaction-pref";

describe("normalizeDeepResearchInteractionPref", () => {
  it("maps legacy chat_first / plan_first → plan_chat", () => {
    expect(normalizeDeepResearchInteractionPref("chat_first")).toBe("plan_chat");
    expect(normalizeDeepResearchInteractionPref("plan_first")).toBe("plan_chat");
  });

  it("accepts the four current prefs", () => {
    expect(normalizeDeepResearchInteractionPref("auto")).toBe("auto");
    expect(normalizeDeepResearchInteractionPref("direct")).toBe("direct");
    expect(normalizeDeepResearchInteractionPref("card_first")).toBe("card_first");
    expect(normalizeDeepResearchInteractionPref("plan_chat")).toBe("plan_chat");
  });
});

describe("labelForDeepResearchInteractionPref", () => {
  it("returns the short Chinese chip label for each pref", () => {
    expect(labelForDeepResearchInteractionPref("auto")).toBe("自动");
    expect(labelForDeepResearchInteractionPref("direct")).toBe("直接开始");
    expect(labelForDeepResearchInteractionPref("card_first")).toBe("卡片确认");
    expect(labelForDeepResearchInteractionPref("plan_chat")).toBe("计划对齐");
  });
});
