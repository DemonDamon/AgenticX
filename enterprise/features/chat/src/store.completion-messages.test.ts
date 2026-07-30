import { describe, expect, it } from "vitest";
import { filterMessagesForCompletion } from "./store";
import type { ChatMessage } from "@agenticx/core-api";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "role" | "content">): ChatMessage {
  return {
    id: partial.id ?? "id",
    session_id: partial.session_id ?? "s1",
    tenant_id: partial.tenant_id ?? "t1",
    user_id: partial.user_id ?? "u1",
    role: partial.role,
    content: partial.content,
    created_at: partial.created_at ?? "2026-07-30T00:00:00.000Z",
  };
}

describe("filterMessagesForCompletion", () => {
  it("excludes empty assistant placeholders from upstream payload", () => {
    const out = filterMessagesForCompletion([
      msg({ role: "user", content: "hello" }),
      msg({ role: "assistant", content: "" }),
    ]);
    expect(out.map((m) => m.role)).toEqual(["user"]);
  });

  it("keeps completed assistant replies", () => {
    const out = filterMessagesForCompletion([
      msg({ role: "user", content: "hello" }),
      msg({ role: "assistant", content: "hi" }),
      msg({ role: "user", content: "again" }),
      msg({ role: "assistant", content: "" }),
    ]);
    expect(out.map((m) => m.content)).toEqual(["hello", "hi", "again"]);
  });
});
