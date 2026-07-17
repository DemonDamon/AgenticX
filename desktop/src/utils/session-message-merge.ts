import type { Message } from "../store";
import { isOrphanFormattedToolResultMessage } from "./orphan-formatted-tool";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "./session-message-map";
import { assistantVisibleBodyForUi } from "./assistant-output";

const norm = (s: unknown) => String(s ?? "").trim();
const contentKey = (role: string, content: unknown) => `${role}::${norm(content)}`;

/**
 * Compare canonical visible bodies so live streamed rows (with think/followups
 * tags) reconcile with disk rows that already store the sanitized final body.
 */
const assistantBodyKey = (content: unknown) =>
  assistantVisibleBodyForUi(String(content ?? "")).trim();

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
    reasoning: memory.reasoning ?? diskRow.reasoning,
    reasoningSeconds: memory.reasoningSeconds ?? diskRow.reasoningSeconds,
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
    const diskBody =
      diskRow.role === "assistant" ? assistantBodyKey(diskRow.content) : "";
    for (const memory of existing) {
      if (consumedMemory.has(memory)) continue;
      if (memory.role !== diskRow.role) continue;
      const exactMatch =
        norm(diskRow.content).length > 0 &&
        contentKey(memory.role, memory.content) === contentKey(diskRow.role, diskRow.content);
      const bodyMatch =
        diskRow.role === "assistant" &&
        diskBody.length > 0 &&
        assistantBodyKey(memory.content) === diskBody;
      if (!exactMatch && !bodyMatch) continue;
      consumedMemory.add(memory);
      return memory;
    }
    return null;
  };

  const out: Message[] = [];
  const placedAssistantBodies = new Set<string>();
  for (const diskRow of mapped) {
    const memory = findMemoryMatch(diskRow);
    const row = memory ? overlayMemoryEnrichment(diskRow, memory) : diskRow;
    out.push(row);
    if (row.role === "assistant") {
      const body = assistantBodyKey(row.content);
      if (body) placedAssistantBodies.add(body);
    }
  }

  // Append in-memory rows that disk hasn't persisted yet (缺失自愈), but never
  // re-append an assistant row whose body already appears above — those are the
  // accumulated duplicate "思考了 N 秒" copies left by earlier failed merges.
  for (const memory of existing) {
    if (consumedMemory.has(memory)) continue;
    if (isOrphanFormattedToolResultMessage(memory)) continue;
    if (memory.role === "assistant") {
      const body = assistantBodyKey(memory.content);
      if (body && placedAssistantBodies.has(body)) continue;
      if (body) placedAssistantBodies.add(body);
    }
    out.push(memory);
  }

  return out;
}
