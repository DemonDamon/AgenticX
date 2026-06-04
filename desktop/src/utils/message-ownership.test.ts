import { describe, expect, it } from "vitest";
import {
  messageBelongsToSession,
  visibleMessagesForSession,
} from "./message-ownership";

describe("messageBelongsToSession", () => {
  it("shows a message stamped with the same session", () => {
    expect(messageBelongsToSession({ ownerSessionId: "A" }, "A")).toBe(true);
  });

  it("hides a message stamped with a different session (cross-session leak)", () => {
    expect(messageBelongsToSession({ ownerSessionId: "A" }, "B")).toBe(false);
  });

  it("shows an untagged message (legacy / in-flight, never vanish)", () => {
    expect(messageBelongsToSession({}, "B")).toBe(true);
    expect(messageBelongsToSession({ ownerSessionId: "" }, "B")).toBe(true);
  });

  it("never filters when the pane has no bound session", () => {
    expect(messageBelongsToSession({ ownerSessionId: "A" }, "")).toBe(true);
    expect(messageBelongsToSession({ ownerSessionId: "A" }, undefined)).toBe(true);
  });

  it("trims whitespace on both sides before comparing", () => {
    expect(messageBelongsToSession({ ownerSessionId: " A " }, "A")).toBe(true);
  });
});

describe("visibleMessagesForSession", () => {
  const msgs = [
    { id: "1", ownerSessionId: "A" },
    { id: "2", ownerSessionId: "B" },
    { id: "3" }, // untagged
    { id: "4", ownerSessionId: "A" },
  ];

  it("keeps only same-session + untagged rows, preserving order", () => {
    const out = visibleMessagesForSession(msgs, "A");
    expect(out.map((m) => m.id)).toEqual(["1", "3", "4"]);
  });

  it("hides the foreign-session row when showing B", () => {
    const out = visibleMessagesForSession(msgs, "B");
    expect(out.map((m) => m.id)).toEqual(["2", "3"]);
  });

  it("returns a copy (no mutation) and shows all when no session bound", () => {
    const out = visibleMessagesForSession(msgs, "");
    expect(out).toEqual(msgs);
    expect(out).not.toBe(msgs);
  });
});
