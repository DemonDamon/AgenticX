import { describe, expect, it } from "vitest";
import { shouldApplyScrollPinFromEvent, shouldPinScrollOnUserSend } from "./chat-scroll-pin";

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
