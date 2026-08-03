import type { ChatMessage } from "@agenticx/core-api";
import { describe, expect, it } from "vitest";
import {
  cleanChatShareContent,
  expandChatShareTurnSelection,
  normalizeChatShareMessage,
  toChatShareMessage,
  type ChatShareMessage,
} from "./chat-share-types";

const baseMessage: ChatMessage = {
  id: "01SHAREAAAAAAAAAAAAAAAAAAAA",
  session_id: "01SESSIONAAAAAAAAAAAAAAAAAA",
  tenant_id: "01TENANTAAAAAAAAAAAAAAAAAA",
  user_id: "01USERAAAAAAAAAAAAAAAAAAAA",
  role: "assistant",
  content: "",
  created_at: "2026-08-03T00:00:00.000Z",
};

function shareMessage(id: string, role: "user" | "assistant", content: string): ChatShareMessage {
  return {
    id,
    role,
    content,
    created_at: "2026-08-03T00:00:00.000Z",
  };
}

describe("chat share content", () => {
  it("removes think blocks and raw search citation markers", () => {
    const thinkOpen = "<" + "think" + ">";
    const thinkClose = "<" + "/" + "think" + ">";
    expect(cleanChatShareContent(`${thinkOpen}内部推理${thinkClose}\n答案 [10]`, true)).toBe("答案");
  });

  it("cleans assistant messages before storing a share snapshot", () => {
    const message = toChatShareMessage({
      ...baseMessage,
      content: "<think>reasoning</think>正文",
      web_search_sources: [{ title: "Source", url: "https://example.com", snippet: "" }],
    });
    expect(message?.content).toBe("正文");
  });

  it("normalizes snapshots created before sanitization", () => {
    const message = normalizeChatShareMessage({
      ...shareMessage("a1", "assistant", "<think>reasoning</think>正文 [1]"),
      web_search_sources: [{ title: "Source", url: "https://example.com", snippet: "" }],
    });
    expect(message?.content).toBe("正文");
  });
});

describe("chat share turn selection", () => {
  const messages = [
    shareMessage("u1", "user", "问题一"),
    shareMessage("a1", "assistant", "回答一"),
    shareMessage("u2", "user", "问题二"),
    shareMessage("a2", "assistant", "回答二"),
  ];

  it("selects the answer together with a shared user question", () => {
    expect(expandChatShareTurnSelection(messages, "u1")).toEqual(["u1", "a1"]);
  });

  it("selects the preceding question when sharing an assistant message", () => {
    expect(expandChatShareTurnSelection(messages, "a2")).toEqual(["u2", "a2"]);
  });
});
