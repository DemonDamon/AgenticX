import { describe, expect, it } from "vitest";
import { serializeMessageMetadata } from "./sql-store";
import type { ChatMessage } from "@agenticx/core-api";

function baseMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "01HYAAAAAAAAAAAAAAAAAAAAAA",
    session_id: "01HYBBBBBBBBBBBBBBBBBBBBBB",
    tenant_id: "01HYCCCCCCCCCCCCCCCCCCCCCC",
    user_id: "01HYDDDDDDDDDDDDDDDDDDDDDD",
    role: "assistant",
    content: "hi",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("serializeMessageMetadata", () => {
  it("returns null when there is no metadata", () => {
    expect(serializeMessageMetadata(baseMessage())).toBeNull();
  });

  it("returns a JSON string for web_search_sources (MySQL JSON binding)", () => {
    const raw = serializeMessageMetadata(
      baseMessage({
        web_search_sources: [{ title: "T", url: "https://example.com", snippet: "s" }],
      }),
    );
    expect(typeof raw).toBe("string");
    expect(raw?.startsWith("{")).toBe(true);
    expect(JSON.parse(raw!)).toEqual({
      web_search_sources: [{ title: "T", url: "https://example.com", snippet: "s" }],
    });
  });
});
