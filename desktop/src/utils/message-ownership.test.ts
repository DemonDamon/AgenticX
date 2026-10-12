import { describe, expect, it } from "vitest";
import {
  findLastOwnedMessageIndex,
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

  it("hides untagged assistants/tools when pane is bound to a session", () => {
    expect(messageBelongsToSession({}, "B")).toBe(false);
    expect(messageBelongsToSession({ ownerSessionId: "" }, "B")).toBe(false);
    expect(messageBelongsToSession({ role: "assistant" }, "B")).toBe(false);
  });

  it("shows an untagged user echo in the bound session", () => {
    expect(messageBelongsToSession({ role: "user" }, "B")).toBe(true);
    expect(messageBelongsToSession({ role: "user", ownerSessionId: "" }, "B")).toBe(true);
  });

  it("when pane has no bound session, hides rows bound to any real session", () => {
    expect(messageBelongsToSession({ ownerSessionId: "A" }, "")).toBe(false);
    expect(messageBelongsToSession({ ownerSessionId: "A" }, undefined)).toBe(false);
    expect(messageBelongsToSession({}, "")).toBe(true);
    expect(messageBelongsToSession({ ownerSessionId: "" }, undefined)).toBe(true);
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

  it("keeps only same-session rows, preserving order", () => {
    const out = visibleMessagesForSession(msgs, "A");
    expect(out.map((m) => m.id)).toEqual(["1", "4"]);
  });

  it("hides the foreign-session row when showing B", () => {
    const out = visibleMessagesForSession(msgs, "B");
    expect(out.map((m) => m.id)).toEqual(["2"]);
  });

  it("when no session bound, keeps only unbound rows", () => {
    const out = visibleMessagesForSession(msgs, "");
    expect(out.map((m) => m.id)).toEqual(["3"]);
  });

  it("keeps an untagged user echo while the pane is bound", () => {
    const out = visibleMessagesForSession(
      [
        { id: "u", role: "user", content: "刚才解析到哪了" },
        { id: "a", role: "assistant", content: "进度", ownerSessionId: "S" },
      ],
      "S",
    );
    expect(out.map((m) => m.id)).toEqual(["u", "a"]);
  });

  it("keeps two same-text user turns that have different client_turn_id", () => {
    const out = visibleMessagesForSession(
      [
        {
          id: "u1",
          role: "user",
          content: "刚才解析到哪了?",
          ownerSessionId: "S",
          metadata: { client_turn_id: "turn-1" },
        },
        {
          id: "u2",
          role: "user",
          content: "刚才解析到哪了?",
          ownerSessionId: "S",
          metadata: { client_turn_id: "turn-2" },
        },
        {
          id: "a1",
          role: "assistant",
          content: "第一轮进度",
          ownerSessionId: "S",
        },
        {
          id: "a2",
          role: "assistant",
          content: "第二轮进度",
          ownerSessionId: "S",
        },
      ],
      "S",
    );
    expect(out.map((m) => m.id)).toEqual(["u1", "u2", "a1", "a2"]);
  });

  it("still collapses an optimistic user row that races a disk copy of the same turn", () => {
    const out = visibleMessagesForSession(
      [
        {
          id: "optimistic",
          role: "user",
          content: "刚才解析到哪了?",
          ownerSessionId: "S",
          metadata: { client_turn_id: "turn-1" },
        },
        {
          id: "disk",
          role: "user",
          content: "刚才解析到哪了?",
          ownerSessionId: "S",
          metadata: { client_turn_id: "turn-1" },
        },
      ],
      "S",
    );
    expect(out.map((m) => m.id)).toEqual(["disk"]);
  });
});

describe("findLastOwnedMessageIndex", () => {
  const kobra = {
    role: "assistant",
    ownerSessionId: "cf861f94-acf6-4bbf-9c2f-3a31ee55595d",
    content: "团长，结论先给：kobra.systems",
  };
  const jevUser = {
    role: "user",
    ownerSessionId: "11da05da-cf24-40fb-bea7-85a8c16b9777",
    content: "啥情况",
  };
  const jev = {
    role: "assistant",
    ownerSessionId: "11da05da-cf24-40fb-bea7-85a8c16b9777",
    content: "团长，情况说明：",
  };

  it("returns the last assistant owned by the requested session", () => {
    expect(findLastOwnedMessageIndex([kobra, jevUser, jev], "assistant", jev.ownerSessionId)).toBe(2);
    expect(findLastOwnedMessageIndex([kobra, jevUser, jev], "assistant", kobra.ownerSessionId)).toBe(0);
  });

  it("does not let a late foreign stream patch the other session's last assistant", () => {
    expect(findLastOwnedMessageIndex([jev], "assistant", kobra.ownerSessionId)).toBe(-1);
  });

  it("skips systemNotice rows and untagged assistants when a session is specified", () => {
    const rows = [
      { role: "assistant", ownerSessionId: "A", content: "owned" },
      { role: "assistant", ownerSessionId: "A", content: "notice", systemNotice: true },
      { role: "assistant", content: "untagged" },
    ];
    expect(findLastOwnedMessageIndex(rows, "assistant", "A")).toBe(0);
  });

  it("returns -1 when the owner session is empty", () => {
    expect(findLastOwnedMessageIndex([jev], "assistant", "")).toBe(-1);
    expect(findLastOwnedMessageIndex([jev], "assistant", "   ")).toBe(-1);
  });
});
