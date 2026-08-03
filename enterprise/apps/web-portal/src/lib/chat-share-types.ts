import type { ChatMessage, ChatMessageRole, WebSearchSource } from "@agenticx/core-api";

/**
 * A deliberately small, immutable representation of a shared message.
 * Attachments and deep-research state are not copied into a share snapshot so
 * a share link cannot expose binary data or internal workspace paths.
 */
export type ChatShareMessage = {
  id: string;
  role: Extract<ChatMessageRole, "user" | "assistant">;
  content: string;
  model?: string;
  web_search_sources?: WebSearchSource[];
  created_at: string;
};

export type ChatShareSnapshot = {
  token: string;
  session_id: string;
  title: string;
  messages: ChatShareMessage[];
  created_at: string;
};

export function toChatShareMessage(message: ChatMessage): ChatShareMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  if (!message.content.trim()) return null;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model,
    web_search_sources: message.web_search_sources,
    created_at: message.created_at,
  };
}
