import type { Message } from "../../store";
import { isViewImageInjectMessage } from "../../utils/view-image-inject";
import { parseReasoningContent } from "./reasoning-parser";

export type ReActBlockModel = {
  workMessages: Message[];
  /** When set, render as a full second assistant row with avatar (Manus-style). */
  finalAssistant: Message | null;
};

export type TopLevelChatRow =
  | { kind: "user"; message: Message }
  | { kind: "react"; block: ReActBlockModel };

/**
 * Split messages into user rows and ReAct blocks (assistant + tool between user boundaries).
 */
export function expandMessagesToTopLevelRows(messages: Message[]): TopLevelChatRow[] {
  const out: TopLevelChatRow[] = [];
  let buf: Message[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    out.push({ kind: "react", block: splitReActBlock(buf) });
    buf = [];
  };
  for (const m of messages) {
    if (m.role === "user" && !isViewImageInjectMessage(m)) {
      flush();
      out.push({ kind: "user", message: m });
    } else {
      buf.push(m);
    }
  }
  flush();
  return out;
}

/**
 * Optionally peel the last assistant message into `finalAssistant` when it qualifies (FR-0).
 */
export function splitReActBlock(block: Message[]): ReActBlockModel {
  // 始终保持在一个 ReAct 块中，不再分离 finalAssistant，避免流式输出过程中的闪烁和割裂感
  return { workMessages: block, finalAssistant: null };
}

/** Collect message ids that belong to one top-level row (user or ReAct block). */
export function collectRowMessageIds(row: TopLevelChatRow): string[] {
  if (row.kind === "user") return [row.message.id];
  const ids = row.block.workMessages.map((m) => m.id);
  if (row.block.finalAssistant) ids.push(row.block.finalAssistant.id);
  return ids;
}

/**
 * Resolve the full conversation-turn ids for a clicked message.
 * A turn = preceding user question + following ReAct/assistant block (Doubao-style pairing).
 */
export function collectTurnLinkedIds(
  message: Message,
  rows: TopLevelChatRow[] | null | undefined,
  visibleMessages: Message[],
): Set<string> {
  const linked = new Set<string>([message.id]);
  if (rows && rows.length > 0) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.kind === "user" && row.message.id === message.id) {
        linked.add(row.message.id);
        const next = rows[i + 1];
        if (next?.kind === "react") {
          for (const id of collectRowMessageIds(next)) linked.add(id);
        }
        return linked;
      }
      if (row.kind === "react") {
        const inBlock = collectRowMessageIds(row).includes(message.id);
        if (!inBlock) continue;
        for (const id of collectRowMessageIds(row)) linked.add(id);
        const prev = rows[i - 1];
        if (prev?.kind === "user") linked.add(prev.message.id);
        return linked;
      }
    }
    return linked;
  }

  // Fallback without ReAct rows: pair by user boundaries in the flat list.
  const idx = visibleMessages.findIndex((m) => m.id === message.id);
  if (idx < 0) return linked;
  let start = idx;
  while (start > 0 && visibleMessages[start]?.role !== "user") start -= 1;
  if (visibleMessages[start]?.role !== "user") start = idx;
  let end = start;
  while (end + 1 < visibleMessages.length && visibleMessages[end + 1]?.role !== "user") {
    end += 1;
  }
  for (let i = start; i <= end; i++) {
    const id = visibleMessages[i]?.id;
    if (id) linked.add(id);
  }
  return linked;
}

/**
 * Resolve full turn ids when toggling a ReAct block checkbox (include preceding user).
 */
export function collectTurnLinkedIdsForBlock(
  blockMessages: Message[],
  rows: TopLevelChatRow[] | null | undefined,
): Set<string> {
  const linked = new Set<string>(blockMessages.map((m) => m.id));
  if (!rows || rows.length === 0 || blockMessages.length === 0) return linked;
  const probe = new Set(blockMessages.map((m) => m.id));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "react") continue;
    const rowIds = collectRowMessageIds(row);
    if (!rowIds.some((id) => probe.has(id))) continue;
    for (const id of rowIds) linked.add(id);
    const prev = rows[i - 1];
    if (prev?.kind === "user") linked.add(prev.message.id);
    break;
  }
  return linked;
}

/**
 * Count selected conversation turns (not raw message / tool-call fragments).
 */
export function countSelectedConversationTurns(
  rows: TopLevelChatRow[] | null | undefined,
  selectedIds: Set<string>,
  visibleMessages: Message[],
): number {
  if (selectedIds.size === 0) return 0;
  if (rows && rows.length > 0) {
    let count = 0;
    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      if (row.kind === "user") {
        const ids = collectRowMessageIds(row);
        const next = rows[i + 1];
        if (next?.kind === "react") {
          ids.push(...collectRowMessageIds(next));
          i += 2;
        } else {
          i += 1;
        }
        if (ids.some((id) => selectedIds.has(id))) count += 1;
      } else {
        if (collectRowMessageIds(row).some((id) => selectedIds.has(id))) count += 1;
        i += 1;
      }
    }
    return count;
  }

  let count = 0;
  let i = 0;
  while (i < visibleMessages.length) {
    const start = i;
    let end = start;
    if (visibleMessages[start]?.role === "user") {
      while (end + 1 < visibleMessages.length && visibleMessages[end + 1]?.role !== "user") {
        end += 1;
      }
    }
    let hit = false;
    for (let j = start; j <= end; j++) {
      const id = visibleMessages[j]?.id;
      if (id && selectedIds.has(id)) {
        hit = true;
        break;
      }
    }
    if (hit) count += 1;
    i = end + 1;
  }
  return count;
}

/** Expand a selection set so every partially-selected turn becomes a full turn. */
export function expandSelectionToCompleteTurns(
  selectedIds: Set<string>,
  rows: TopLevelChatRow[] | null | undefined,
  visibleMessages: Message[],
): Set<string> {
  if (selectedIds.size === 0) return selectedIds;
  const next = new Set(selectedIds);
  if (rows && rows.length > 0) {
    let i = 0;
    while (i < rows.length) {
      const row = rows[i];
      if (row.kind === "user") {
        const ids = collectRowMessageIds(row);
        const nextRow = rows[i + 1];
        if (nextRow?.kind === "react") {
          ids.push(...collectRowMessageIds(nextRow));
          i += 2;
        } else {
          i += 1;
        }
        if (ids.some((id) => next.has(id))) {
          for (const id of ids) next.add(id);
        }
      } else {
        const ids = collectRowMessageIds(row);
        if (ids.some((id) => next.has(id))) {
          for (const id of ids) next.add(id);
          const prev = rows[i - 1];
          if (prev?.kind === "user") next.add(prev.message.id);
        }
        i += 1;
      }
    }
    return next;
  }

  for (const id of Array.from(selectedIds)) {
    const msg = visibleMessages.find((m) => m.id === id);
    if (!msg) continue;
    for (const linked of collectTurnLinkedIds(msg, null, visibleMessages)) {
      next.add(linked);
    }
  }
  return next;
}
