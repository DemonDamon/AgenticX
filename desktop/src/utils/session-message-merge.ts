import type { Message } from "../store";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "./session-message-map";

const norm = (s: unknown) => String(s ?? "").trim();
const contentKey = (role: string, content: unknown) => `${role}::${norm(content)}`;

function overlayMemoryEnrichment(diskRow: Message, memory: Message): Message {
  return {
    ...diskRow,
    id: memory.id,
    timestamp:
      typeof diskRow.timestamp === "number" && diskRow.timestamp > 0
        ? diskRow.timestamp
        : memory.timestamp,
    attachments: memory.attachments ?? diskRow.attachments,
    toolStreamLines: memory.toolStreamLines ?? diskRow.toolStreamLines,
    suggestedQuestions: memory.suggestedQuestions ?? diskRow.suggestedQuestions,
    references: memory.references ?? diskRow.references,
    searchedQueries: memory.searchedQueries ?? diskRow.searchedQueries,
    toolStatus: memory.toolStatus ?? diskRow.toolStatus,
    toolElapsedSec: memory.toolElapsedSec ?? diskRow.toolElapsedSec,
    metadata: memory.metadata ?? diskRow.metadata,
  };
}

/**
 * Reconcile in-memory rows (uid ids, streaming enrichments) with disk history.
 * Output follows disk chronological order; unmatched in-memory tail rows append last.
 */
export function mergeSessionMessagesTail(
  existing: Message[],
  diskRows: LoadedSessionMessage[],
  sessionId: string
): Message[] {
  if (!diskRows.length) return existing;
  const mapped = diskRows.map((row, idx) => mapLoadedSessionMessage(row, sessionId, idx));
  if (!existing.length) return mapped;

  const memoryById = new Map(existing.map((m) => [m.id, m]));
  const consumedMemory = new Set<Message>();

  const findMemoryMatch = (diskRow: Message): Message | null => {
    const byId = memoryById.get(diskRow.id);
    if (byId && !consumedMemory.has(byId)) {
      consumedMemory.add(byId);
      return byId;
    }
    for (const memory of existing) {
      if (consumedMemory.has(memory)) continue;
      if (memory.role !== diskRow.role) continue;
      if (contentKey(memory.role, memory.content) !== contentKey(diskRow.role, diskRow.content)) continue;
      if (!norm(diskRow.content)) continue;
      consumedMemory.add(memory);
      return memory;
    }
    return null;
  };

  const out: Message[] = [];
  for (const diskRow of mapped) {
    const memory = findMemoryMatch(diskRow);
    out.push(memory ? overlayMemoryEnrichment(diskRow, memory) : diskRow);
  }

  for (const memory of existing) {
    if (!consumedMemory.has(memory)) {
      out.push(memory);
    }
  }

  return out;
}
