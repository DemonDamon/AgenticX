import { describe, expect, it } from "vitest";
import {
  chatListFollowRows,
  shouldApplyScrollPinFromEvent,
  shouldPinScrollOnPresentationEnter,
  shouldPinScrollOnUserSend,
} from "./chat-scroll-pin";

describe("shouldPinScrollOnUserSend", () => {
  it("pins a normal composer send", () => {
    expect(shouldPinScrollOnUserSend()).toBe(true);
    expect(shouldPinScrollOnUserSend({})).toBe(true);
  });

  it("does not steal scroll on auto-continue", () => {
    expect(
      shouldPinScrollOnUserSend({
        continuation: { reason: "stall", source: "desktop_auto_nudge" },
      }),
    ).toBe(false);
  });

  it("does not steal scroll when draining a queued follow-up", () => {
    expect(shouldPinScrollOnUserSend({ queueDrain: true })).toBe(false);
  });

  it("keeps auto-continue + queue drain unpinned", () => {
    expect(
      shouldPinScrollOnUserSend({
        continuation: { reason: "stall" },
        queueDrain: true,
      }),
    ).toBe(false);
  });
});

describe("shouldApplyScrollPinFromEvent", () => {
  it("applies pin from a real user scroll", () => {
    expect(shouldApplyScrollPinFromEvent(false)).toBe(true);
  });

  it("ignores programmatic scroll so a just-pinned send is not unpinned", () => {
    expect(shouldApplyScrollPinFromEvent(true)).toBe(false);
  });
});

describe("chatListFollowRows", () => {
  it("follows the sliced presentation rows, not the unchanged full session", () => {
    const live = [{ id: "full" }];
    const presented = [{ id: "turn-1" }];
    expect(chatListFollowRows(false, live, presented)).toBe(live);
    expect(chatListFollowRows(true, live, presented)).toBe(presented);
  });
});

describe("shouldPinScrollOnPresentationEnter", () => {
  it("re-pins only when presentation starts", () => {
    expect(shouldPinScrollOnPresentationEnter(false, true)).toBe(true);
    expect(shouldPinScrollOnPresentationEnter(true, true)).toBe(false);
    expect(shouldPinScrollOnPresentationEnter(true, false)).toBe(false);
    expect(shouldPinScrollOnPresentationEnter(false, false)).toBe(false);
  });
});
