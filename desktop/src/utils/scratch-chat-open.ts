/**
 * Open a workspace scratch chat from a session object.
 *
 * Author: Damon Li
 */

import { scratchSourceKey, type ScratchChatDraft } from "./scratch-chat";

export function clipScratchTitleSnippet(text: string, max = 24): string {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function hashScratchSnippet(text: string): string {
  const s = String(text ?? "").trim();
  let hash = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function buildMessageScratchDraft(input: {
  messageId: string;
  quotedContent: string;
  selectedText?: string;
  title: string;
}): ScratchChatDraft {
  const messageId = String(input.messageId ?? "").trim() || "unknown";
  const title = String(input.title ?? "").trim();
  const selected = String(input.selectedText ?? "").trim();
  if (selected) {
    return {
      title,
      sourceKind: "selection",
      sourceKey: scratchSourceKey("selection", messageId, hashScratchSnippet(selected)),
      quotedContent: selected,
    };
  }
  return {
    title,
    sourceKind: "message",
    sourceKey: scratchSourceKey("message", messageId),
    quotedContent: String(input.quotedContent ?? ""),
  };
}
