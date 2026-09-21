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
  /** Formal pane session this scratch belongs to. Empty = not attached yet. */
  hostSessionId: string;
  messages: Message[];
  floating: boolean;
  /** Set when the tab is parked in workspace scratch history. */
  parkedAt?: number;
  /** Per-card override. Empty = inherit the host pane model. */
  modelProvider?: string;
  modelName?: string;
};

export const PARKED_SCRATCH_CAP = 20;

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

function withoutParkedAt(chat: ScratchChat): ScratchChat {
  const { parkedAt: _parkedAt, ...rest } = chat;
  return rest;
}

export function scratchBelongsToHost(
  chat: Pick<ScratchChat, "hostSessionId">,
  hostSessionId: string,
): boolean {
  return String(chat.hostSessionId ?? "").trim() === String(hostSessionId ?? "").trim();
}

export function filterScratchChatsForHost<T extends Pick<ScratchChat, "hostSessionId">>(
  chats: readonly T[],
  hostSessionId: string,
): T[] {
  const host = String(hostSessionId ?? "").trim();
  return chats.filter((chat) => String(chat.hostSessionId ?? "").trim() === host);
}

export function attachUnhostedScratchChats<T extends ScratchChat>(
  chats: readonly T[],
  hostSessionId: string,
): T[] {
  const host = String(hostSessionId ?? "").trim();
  if (!host) return [...chats];
  return chats.map((chat) =>
    String(chat.hostSessionId ?? "").trim() ? chat : { ...chat, hostSessionId: host },
  );
}

export function forgetScratchSessionIds(
  existing: Iterable<string>,
  remove: Iterable<string>,
): string[] {
  const drop = new Set(
    [...remove].map((id) => String(id ?? "").trim()).filter((id) => id.length > 0),
  );
  if (drop.size === 0) return rememberScratchSessionIds(existing, []);
  return [...existing]
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0 && !drop.has(id));
}

export function deleteScratchChatFromLists(
  open: ScratchChat[],
  parked: ScratchChat[],
  chatId: string,
): { open: ScratchChat[]; parked: ScratchChat[]; removed: ScratchChat | null } {
  const id = String(chatId ?? "").trim();
  const fromOpen = open.find((chat) => chat.id === id);
  if (fromOpen) {
    return { open: open.filter((chat) => chat.id !== id), parked, removed: fromOpen };
  }
  const fromParked = parked.find((chat) => chat.id === id);
  if (fromParked) {
    return { open, parked: parked.filter((chat) => chat.id !== id), removed: fromParked };
  }
  return { open, parked, removed: null };
}

export function clearScratchChatsForHost(
  open: ScratchChat[],
  parked: ScratchChat[],
  hostSessionId: string,
): { open: ScratchChat[]; parked: ScratchChat[]; removed: ScratchChat[] } {
  const removed = [...open, ...parked].filter((chat) => scratchBelongsToHost(chat, hostSessionId));
  return {
    open: open.filter((chat) => !scratchBelongsToHost(chat, hostSessionId)),
    parked: parked.filter((chat) => !scratchBelongsToHost(chat, hostSessionId)),
    removed,
  };
}

export function upsertScratchChatList(
  existing: ScratchChat[],
  draft: ScratchChatDraft,
  newId: string,
  parked: ScratchChat[] = [],
  hostSessionId = "",
): { chats: ScratchChat[]; parked: ScratchChat[]; chat: ScratchChat; reused: boolean } {
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
      parked,
      chat,
      reused: true,
    };
  }
  const parkedFound = parked.find((chat) => chat.sourceKey === key);
  if (parkedFound) {
    const chat: ScratchChat = {
      ...withoutParkedAt(parkedFound),
      title: title || parkedFound.title,
      quotedContent: draft.quotedContent ?? parkedFound.quotedContent,
      contextFiles: draft.contextFiles ?? parkedFound.contextFiles,
      floating: false,
    };
    return {
      chats: [...existing.map((item) => ({ ...item, floating: false })), chat],
      parked: parked.filter((item) => item.id !== parkedFound.id),
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
    hostSessionId: String(hostSessionId ?? "").trim(),
    messages: [],
    floating: false,
  };
  return {
    chats: [...existing.map((item) => ({ ...item, floating: false })), chat],
    parked,
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

export function shouldParkScratchChat(
  chat: Pick<ScratchChat, "sessionId" | "messages">
): boolean {
  return shouldConfirmCloseScratch(chat);
}

export function closeOrParkScratchChat(
  open: ScratchChat[],
  parked: ScratchChat[],
  chatId: string,
  now = Date.now(),
  cap = PARKED_SCRATCH_CAP,
): { open: ScratchChat[]; parked: ScratchChat[]; evicted: ScratchChat[] } {
  const id = String(chatId ?? "").trim();
  const chat = open.find((item) => item.id === id);
  const nextOpen = open.filter((item) => item.id !== id);
  if (!chat) return { open: nextOpen, parked, evicted: [] };
  if (!shouldParkScratchChat(chat)) {
    return { open: nextOpen, parked, evicted: [] };
  }
  const parkedChat: ScratchChat = { ...chat, floating: false, parkedAt: now };
  const merged = [parkedChat, ...parked.filter((item) => item.id !== id)];
  return {
    open: nextOpen,
    parked: merged.slice(0, cap),
    evicted: merged.slice(cap),
  };
}

export function restoreParkedScratchChat(
  open: ScratchChat[],
  parked: ScratchChat[],
  chatId: string,
): { open: ScratchChat[]; parked: ScratchChat[]; chat: ScratchChat | null } {
  const id = String(chatId ?? "").trim();
  const chat = parked.find((item) => item.id === id);
  if (!chat) return { open, parked, chat: null };
  const restored: ScratchChat = { ...withoutParkedAt(chat), floating: false };
  return {
    open: [...open.map((item) => ({ ...item, floating: false })), restored],
    parked: parked.filter((item) => item.id !== id),
    chat: restored,
  };
}

export function dismissParkedScratchChat(
  parked: ScratchChat[],
  chatId: string,
): { parked: ScratchChat[]; removed: ScratchChat | null } {
  const id = String(chatId ?? "").trim();
  const removed = parked.find((item) => item.id === id) ?? null;
  return {
    parked: parked.filter((item) => item.id !== id),
    removed,
  };
}

export function listSummaryScratchChats(
  open: ScratchChat[],
  parked: ScratchChat[],
): Array<ScratchChat & { isParked: boolean }> {
  const seen = new Set<string>();
  const out: Array<ScratchChat & { isParked: boolean }> = [];
  for (const chat of open) {
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    out.push({ ...chat, isParked: false });
  }
  for (const chat of parked) {
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    out.push({ ...chat, isParked: true });
  }
  return out;
}

export function scratchParkedPreview(
  chat: Pick<ScratchChat, "messages" | "quotedContent">
): string {
  const firstUser = (chat.messages ?? []).find((item) => item.role === "user");
  const text = String(firstUser?.content ?? chat.quotedContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 48);
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
  panes: Array<{ scratchChats?: ScratchChat[]; parkedScratchChats?: ScratchChat[] }>
): Set<string> {
  const ids = new Set<string>();
  for (const pane of panes) {
    for (const chat of [...(pane.scratchChats ?? []), ...(pane.parkedScratchChats ?? [])]) {
      const sid = String(chat.sessionId ?? "").trim();
      if (sid) ids.add(sid);
    }
  }
  return ids;
}

const HIDDEN_SCRATCH_SESSION_CAP = 500;

export function rememberScratchSessionIds(
  existing: Iterable<string>,
  incoming: Iterable<string>,
  cap = HIDDEN_SCRATCH_SESSION_CAP,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...incoming, ...existing]) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

export function normalizePersistedScratchSessionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return rememberScratchSessionIds([], raw);
}

export function scratchHistoryBlocklist(
  panes: Array<{ scratchChats?: ScratchChat[]; parkedScratchChats?: ScratchChat[] }>,
  hiddenIds: Iterable<string> = [],
): Set<string> {
  const ids = collectScratchSessionIds(panes);
  for (const raw of hiddenIds) {
    const id = String(raw ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

export function mergeHiddenScratchSessionIdsForPersist(
  existingPersisted: unknown,
  memoryHidden: Iterable<string>,
  panes: Array<{ scratchChats?: ScratchChat[]; parkedScratchChats?: ScratchChat[] }>,
): string[] {
  return rememberScratchSessionIds(
    rememberScratchSessionIds(
      normalizePersistedScratchSessionIds(existingPersisted),
      memoryHidden,
    ),
    collectScratchSessionIds(panes),
  );
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
    const parkedAt = Number(row.parkedAt);
    out.push({
      id,
      title,
      sourceKind: sourceKindRaw,
      sourceKey,
      quotedContent: quoted.trim() ? quoted : undefined,
      contextFiles: normalizeContextFiles(row.contextFiles),
      sessionId: String(row.sessionId ?? "").trim(),
      hostSessionId: String(row.hostSessionId ?? "").trim(),
      messages: normalizeMessages(row.messages),
      floating: false,
      ...(Number.isFinite(parkedAt) && parkedAt > 0 ? { parkedAt } : {}),
      ...(modelProvider ? { modelProvider } : {}),
      ...(modelName ? { modelName } : {}),
    });
  }
  return out;
}
