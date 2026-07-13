import { describe, expect, it } from "vitest";
import { normalizeChatMessageOrder, pairedMessageTimestamps } from "./chat-message-order";

describe("normalizeChatMessageOrder", () => {
  it("keeps correct user → assistant order", () => {
    const messages = [
      { id: "01A", role: "user", created_at: "2026-07-13T15:00:00.000Z", content: "q" },
      { id: "01B", role: "assistant", created_at: "2026-07-13T15:00:00.001Z", content: "a" },
    ];
    expect(normalizeChatMessageOrder(messages).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("repairs inverted assistant → user with near-equal timestamps", () => {
    const messages = [
      {
        id: "01KXE2KV23QD0RQXSDHJG8VV01",
        role: "assistant",
        created_at: "2026-07-13T15:47:59.171Z",
        content: "answer",
      },
      {
        id: "01KXE19S6PT5HNHJ90GXP0X85Y",
        role: "user",
        created_at: "2026-07-13T15:47:59.172Z",
        content: "query",
      },
    ];
    expect(normalizeChatMessageOrder(messages).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(normalizeChatMessageOrder(messages).map((m) => m.content)).toEqual(["query", "answer"]);
  });

  it("repairs same-millisecond pairs when assistant ULID sorts first", () => {
    const messages = [
      { id: "01AAA", role: "assistant", created_at: "2026-07-13T15:00:00.000Z", content: "a" },
      { id: "01BBB", role: "user", created_at: "2026-07-13T15:00:00.000Z", content: "q" },
    ];
    expect(normalizeChatMessageOrder(messages).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("does not swap turns separated by more than 2s", () => {
    const messages = [
      { id: "01A", role: "assistant", created_at: "2026-07-13T15:00:00.000Z", content: "old" },
      { id: "01B", role: "user", created_at: "2026-07-13T15:00:05.000Z", content: "new" },
    ];
    expect(normalizeChatMessageOrder(messages).map((m) => m.content)).toEqual(["old", "new"]);
  });
});

describe("pairedMessageTimestamps", () => {
  it("makes assistant created_at exactly 1ms after user", () => {
    const pair = pairedMessageTimestamps(1_700_000_000_000);
    expect(Date.parse(pair.assistantCreatedAt) - Date.parse(pair.userCreatedAt)).toBe(1);
  });
});
