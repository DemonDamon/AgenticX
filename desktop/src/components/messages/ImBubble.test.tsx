import { describe, expect, it } from "vitest";
import { shouldShowAssistantFollowups, shouldShowAssistantIconButtons } from "../../utils/im-bubble-actions";

const baseVisible = {
  hideActions: false,
  isUser: false,
  isStreaming: false,
  isGroupTyping: false,
  isMetaPendingWork: false,
  hasBody: true,
  sessionBusy: false,
  isLastAssistantInPane: false,
};

describe("shouldShowAssistantIconButtons", () => {
  it("shows actions for a normal assistant message", () => {
    expect(shouldShowAssistantIconButtons(baseVisible)).toBe(true);
  });

  it("hides actions while streaming placeholder is active", () => {
    expect(shouldShowAssistantIconButtons({ ...baseVisible, isStreaming: true })).toBe(false);
  });

  it("suppresses last assistant actions when session is busy", () => {
    expect(
      shouldShowAssistantIconButtons({
        ...baseVisible,
        sessionBusy: true,
        isLastAssistantInPane: true,
      })
    ).toBe(false);
  });

  it("keeps historical assistant actions when session is busy", () => {
    expect(
      shouldShowAssistantIconButtons({
        ...baseVisible,
        sessionBusy: true,
        isLastAssistantInPane: false,
      })
    ).toBe(true);
  });

  it("restores last assistant actions when session is idle", () => {
    expect(
      shouldShowAssistantIconButtons({
        ...baseVisible,
        sessionBusy: false,
        isLastAssistantInPane: true,
      })
    ).toBe(true);
  });
});

const baseFollowups = {
  isUser: false,
  isStreaming: false,
  isGroupTyping: false,
  omitSuggestedQuestions: false,
  hasBody: true,
  hasSuggestedQuestions: true,
  hasFollowupHandler: true,
  sessionBusy: false,
  isLastAssistantInPane: false,
};

describe("shouldShowAssistantFollowups", () => {
  it("shows followups for a completed assistant message", () => {
    expect(shouldShowAssistantFollowups(baseFollowups)).toBe(true);
  });

  it("hides followups while streaming placeholder is active", () => {
    expect(shouldShowAssistantFollowups({ ...baseFollowups, isStreaming: true })).toBe(false);
  });

  it("suppresses last assistant followups when session is busy", () => {
    expect(
      shouldShowAssistantFollowups({
        ...baseFollowups,
        sessionBusy: true,
        isLastAssistantInPane: true,
      })
    ).toBe(false);
  });

  it("keeps historical assistant followups when session is busy", () => {
    expect(
      shouldShowAssistantFollowups({
        ...baseFollowups,
        sessionBusy: true,
        isLastAssistantInPane: false,
      })
    ).toBe(true);
  });

  it("hides followups when assistant body is empty", () => {
    expect(shouldShowAssistantFollowups({ ...baseFollowups, hasBody: false })).toBe(false);
  });
});
