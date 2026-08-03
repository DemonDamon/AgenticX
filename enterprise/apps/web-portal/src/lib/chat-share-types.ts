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

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";

function stripThinkBlocks(raw: string): string {
  let text = raw.replaceAll(THINK_OPEN, "<think>").replaceAll(THINK_CLOSE, "</think>");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const openIndex = text.toLowerCase().indexOf("<think>");
  if (openIndex >= 0) text = text.slice(0, openIndex);
  return text;
}

/** Remove model-internal reasoning while preserving citation markers for the rich share view. */
export function cleanChatShareContent(
  raw: string,
  options: { stripCitationMarkers?: boolean } = {},
): string {
  let text = stripThinkBlocks(raw ?? "")
    .replace(/<\s*citations?\s*>/gi, "")
    .replace(/<\s*\/\s*citations?\s*>/gi, "");
  if (options.stripCitationMarkers) text = text.replace(/\[(?:\d{1,3}|N)\]/gi, "");
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toChatShareMessage(message: ChatMessage): ChatShareMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const content = cleanChatShareContent(message.content);
  if (!content) return null;
  return {
    id: message.id,
    role: message.role,
    content,
    model: message.model,
    web_search_sources: message.web_search_sources,
    created_at: message.created_at,
  };
}

/** Normalize snapshots created before share-content sanitization was added. */
export function normalizeChatShareMessage(message: ChatShareMessage): ChatShareMessage | null {
  const content = cleanChatShareContent(message.content);
  return content ? { ...message, content } : null;
}

/** Select a complete conversation turn when sharing from an individual message. */
export function expandChatShareTurnSelection(messages: ChatShareMessage[], selectedId: string): string[] {
  const index = messages.findIndex((message) => message.id === selectedId);
  if (index < 0) return [];

  let start = index;
  if (messages[index]?.role === "assistant") {
    while (start > 0 && messages[start - 1]?.role !== "user") start -= 1;
    if (messages[start - 1]?.role === "user") start -= 1;
  }

  let end = index + 1;
  if (messages[index]?.role === "user") {
    while (end < messages.length && messages[end]?.role !== "user") end += 1;
  }
  return messages.slice(start, end).map((message) => message.id);
}
