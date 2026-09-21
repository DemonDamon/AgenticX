/**
 * Workspace scratch-chat helpers (no React).
 *
 * Author: Damon Li
 */

import type { Message } from "../store";

export type ScratchChatSourceKind =
  | "message"
  | "selection"
  | "tool_result"
  | "artifact"
  | "change"
  | "reference"
  | "todo"
  | "file"
  | "terminal"
  | "browser";

export type ScratchChatContextFile = {
  path: string;
  sourcePath?: string;
};

export type ScratchChat = {
  id: string;
  title: string;
  sourceKind: ScratchChatSourceKind;
  sourceKey: string;
  quotedContent?: string;
  contextFiles?: ScratchChatContextFile[];
  sessionId: string;
  messages: Message[];
  floating: boolean;
  /** Per-card override. Empty = inherit the host pane model. */
  modelProvider?: string;
  modelName?: string;
};

export type ScratchChatDraft = {
  title: string;
  sourceKind: ScratchChatSourceKind;
  sourceKey: string;
  quotedContent?: string;
  contextFiles?: ScratchChatContextFile[];
};

const SOURCE_KINDS = new Set<ScratchChatSourceKind>([
  "message",
  "selection",
  "tool_result",
  "artifact",
  "change",
  "reference",
  "todo",
  "file",
  "terminal",
  "browser",
]);

export function scratchSourceKey(
  kind: ScratchChatSourceKind,
  raw: string,
  extra?: string
): string {
  const a = String(raw ?? "").trim();
  const b = String(extra ?? "").trim();
  return b ? `${kind}:${a}:${b}` : `${kind}:${a}`;
}

export function upsertScratchChatList(
  existing: ScratchChat[],
  draft: ScratchChatDraft,
  newId: string
): { chats: ScratchChat[]; chat: ScratchChat; reused: boolean } {
  const key = String(draft.sourceKey ?? "").trim();
  const title = String(draft.title ?? "").trim();
  const found = existing.find((chat) => chat.sourceKey === key);
  if (found) {
    const chat: ScratchChat = {
      ...found,
      title: title || found.title,
      quotedContent: draft.quotedContent ?? found.quotedContent,
      contextFiles: draft.contextFiles ?? found.contextFiles,
      floating: false,
    };
    return {
      chats: existing.map((item) =>
        item.id === found.id ? chat : { ...item, floating: false }
      ),
      chat,
      reused: true,
    };
  }
  const chat: ScratchChat = {
    id: String(newId ?? "").trim(),
    title,
    sourceKind: draft.sourceKind,
    sourceKey: key,
    quotedContent: draft.quotedContent,
    contextFiles: draft.contextFiles,
    sessionId: "",
    messages: [],
    floating: false,
  };
  return {
    chats: [...existing.map((item) => ({ ...item, floating: false })), chat],
    chat,
    reused: false,
  };
}

export function setScratchFloating(
  chats: ScratchChat[],
  chatId: string,
  floating: boolean
): ScratchChat[] {
  const id = String(chatId ?? "").trim();
  if (!floating) {
    return chats.map((chat) => (chat.id === id ? { ...chat, floating: false } : chat));
  }
  return chats.map((chat) => ({ ...chat, floating: chat.id === id }));
}

export function closeScratchChatList(chats: ScratchChat[], chatId: string): ScratchChat[] {
  const id = String(chatId ?? "").trim();
  return chats.filter((chat) => chat.id !== id);
}

export function patchScratchChatList(
  chats: ScratchChat[],
  chatId: string,
  patch: Partial<ScratchChat>
): ScratchChat[] {
  const id = String(chatId ?? "").trim();
  return chats.map((chat) => (chat.id === id ? { ...chat, ...patch, id: chat.id } : chat));
}

export function resolveScratchChatModel(
  chat: Pick<ScratchChat, "modelProvider" | "modelName">,
  pane: { modelProvider?: string; modelName?: string },
): { provider: string; model: string } {
  const provider = String(chat.modelProvider || pane.modelProvider || "").trim();
  const model = String(chat.modelName || pane.modelName || "").trim();
  return { provider, model };
}

export function withoutScratchContextFile(
  files: ScratchChatContextFile[] | undefined,
  path: string,
): ScratchChatContextFile[] | undefined {
  const target = String(path ?? "").trim();
  const next = (files ?? []).filter((file) => {
    const key = String(file.sourcePath || file.path || "").trim();
    return key !== target;
  });
  return next.length > 0 ? next : undefined;
}

export function shouldConfirmCloseScratch(
  chat: Pick<ScratchChat, "sessionId" | "messages">
): boolean {
  if (String(chat.sessionId ?? "").trim()) return true;
  return Array.isArray(chat.messages) && chat.messages.length > 0;
}

export function collectScratchSessionIds(
  panes: Array<{ scratchChats?: ScratchChat[] }>
): Set<string> {
  const ids = new Set<string>();
  for (const pane of panes) {
    for (const chat of pane.scratchChats ?? []) {
      const sid = String(chat.sessionId ?? "").trim();
      if (sid) ids.add(sid);
    }
  }
  return ids;
}

export function excludeScratchSessionsFromHistory<T extends { session_id: string }>(
  rows: T[],
  scratchIds: Iterable<string>
): T[] {
  const blocked = new Set(
    [...scratchIds].map((id) => String(id ?? "").trim()).filter((id) => id.length > 0)
  );
  if (blocked.size === 0) return rows;
  return rows.filter((row) => !blocked.has(String(row.session_id ?? "").trim()));
}

function normalizeContextFiles(raw: unknown): ScratchChatContextFile[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const files = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const path = String(row.path ?? "").trim();
      if (!path) return null;
      const sourcePath = String(row.sourcePath ?? "").trim();
      return sourcePath ? { path, sourcePath } : { path };
    })
    .filter((item): item is ScratchChatContextFile => !!item);
  return files.length > 0 ? files : undefined;
}

function normalizeMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Message => !!item && typeof item === "object");
}

export function normalizePersistedScratchChats(raw: unknown): ScratchChat[] {
  if (!Array.isArray(raw)) return [];
  const out: ScratchChat[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const title = String(row.title ?? "").trim();
    const sourceKey = String(row.sourceKey ?? "").trim();
    const sourceKindRaw = String(row.sourceKind ?? "").trim() as ScratchChatSourceKind;
    if (!id || !title || !sourceKey || !SOURCE_KINDS.has(sourceKindRaw)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const quoted = String(row.quotedContent ?? "");
    const modelProvider = String(row.modelProvider ?? "").trim();
    const modelName = String(row.modelName ?? "").trim();
    out.push({
      id,
      title,
      sourceKind: sourceKindRaw,
      sourceKey,
      quotedContent: quoted.trim() ? quoted : undefined,
      contextFiles: normalizeContextFiles(row.contextFiles),
      sessionId: String(row.sessionId ?? "").trim(),
      messages: normalizeMessages(row.messages),
      floating: false,
      ...(modelProvider ? { modelProvider } : {}),
      ...(modelName ? { modelName } : {}),
    });
  }
  return out;
}
