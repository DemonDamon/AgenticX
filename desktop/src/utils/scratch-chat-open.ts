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

export function fileLabelFromPath(path: string): string {
  const normalized = String(path ?? "").replace(/\\/g, "/").trim();
  return normalized.split("/").filter(Boolean).pop() || normalized || "file";
}

export function buildPathScratchDraft(input: {
  kind: "file" | "artifact" | "change" | "reference";
  path: string;
  title: string;
  quotedContent?: string;
}): ScratchChatDraft {
  const abs = String(input.path ?? "").trim() || "unknown";
  const quoted = String(input.quotedContent ?? "").trim();
  return {
    title: String(input.title ?? "").trim(),
    sourceKind: input.kind,
    sourceKey: scratchSourceKey(input.kind, abs),
    ...(quoted ? { quotedContent: quoted } : {}),
    contextFiles: [{ path: abs, sourcePath: abs }],
  };
}

export function buildQuotedScratchDraft(input: {
  kind: "terminal" | "browser" | "todo" | "reference";
  rawKey: string;
  quotedContent: string;
  title: string;
}): ScratchChatDraft {
  const quoted = String(input.quotedContent ?? "").trim();
  const rawKey = String(input.rawKey ?? "").trim() || "unknown";
  const hashed = input.kind === "terminal" || input.kind === "browser";
  return {
    title: String(input.title ?? "").trim(),
    sourceKind: input.kind,
    sourceKey: hashed
      ? scratchSourceKey(input.kind, rawKey, hashScratchSnippet(quoted))
      : scratchSourceKey(input.kind, rawKey),
    quotedContent: quoted,
  };
}

export function buildPreviewScratchDraft(input: {
  absolutePath: string;
  snippet?: string;
  title: string;
}): ScratchChatDraft {
  const abs = String(input.absolutePath ?? "").trim() || "unknown";
  const snippet = String(input.snippet ?? "").trim();
  const title = String(input.title ?? "").trim();
  if (!snippet) {
    return buildPathScratchDraft({ kind: "file", path: abs, title });
  }
  return {
    title,
    sourceKind: "file",
    sourceKey: scratchSourceKey("file", abs, hashScratchSnippet(snippet)),
    quotedContent: snippet,
    contextFiles: [{ path: abs, sourcePath: abs }],
  };
}
