import { describe, expect, it } from "vitest";
import {
  chatListFollowRows,
  computeExpandedWorkBottomInset,
  isScrollNearBottom,
  resolvePinOnUserWheel,
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

describe("isScrollNearBottom", () => {
  it("returns true within threshold and false when scrolled up", () => {
    expect(isScrollNearBottom({ scrollTop: 420, clientHeight: 500, scrollHeight: 1000 }, 96)).toBe(true);
    expect(isScrollNearBottom({ scrollTop: 300, clientHeight: 500, scrollHeight: 1000 }, 96)).toBe(false);
  });
});

describe("resolvePinOnUserWheel", () => {
  it("unpins immediately on upward wheel and defers on downward/zero wheel", () => {
    expect(resolvePinOnUserWheel(-40)).toBe(false);
    expect(resolvePinOnUserWheel(0)).toBeNull();
    expect(resolvePinOnUserWheel(40)).toBeNull();
  });
});

describe("computeExpandedWorkBottomInset", () => {
  it("returns 0 when not expanded or height is non-positive", () => {
    expect(computeExpandedWorkBottomInset(false, 220)).toBe(0);
    expect(computeExpandedWorkBottomInset(true, 0)).toBe(0);
    expect(computeExpandedWorkBottomInset(true, -10)).toBe(0);
  });

  it("reserves composer height plus breathing gap when expanded", () => {
    expect(computeExpandedWorkBottomInset(true, 198.2)).toBe(207);
    expect(computeExpandedWorkBottomInset(true, 200, 12)).toBe(212);
  });
});
