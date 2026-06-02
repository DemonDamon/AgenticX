import type { Message } from "../store";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "./session-message-map";

/** Append disk tail messages without overwriting enriched in-memory rows. */
export function mergeSessionMessagesTail(
  existing: Message[],
  diskRows: LoadedSessionMessage[],
  sessionId: string
): Message[] {
  if (!diskRows.length) return existing;
  const mapped = diskRows.map((row, idx) => mapLoadedSessionMessage(row, sessionId, idx));
  if (!existing.length) return mapped;
  const byId = new Map(existing.map((m) => [m.id, m]));
  // Disk rows use positional ids (`${sid}-i{index}`) while live in-memory rows
  // committed during streaming use random `uid()`. A pure id-keyed append can
  // therefore re-append a disk row that already exists in memory under a
  // different id, producing the duplicate "拼接" of an old reply onto a new one.
  // Track a consumable (role + normalized content) multiset of in-memory rows so
  // an id-mismatched disk row that duplicates an existing row is skipped.
  const norm = (s: unknown) => String(s ?? "").trim();
  const contentKey = (role: string, content: unknown) => `${role}::${norm(content)}`;
  const unconsumedByKey = new Map<string, number>();
  for (const m of existing) {
    const k = contentKey(m.role, m.content);
    unconsumedByKey.set(k, (unconsumedByKey.get(k) ?? 0) + 1);
  }
  const out = [...existing];
  for (const row of mapped) {
    const prior = byId.get(row.id);
    if (prior) {
      const idx = out.findIndex((m) => m.id === row.id);
      if (idx >= 0) {
        out[idx] = {
          ...row,
          timestamp:
            typeof row.timestamp === "number" && row.timestamp > 0
              ? row.timestamp
              : prior.timestamp,
          toolStreamLines: prior.toolStreamLines ?? row.toolStreamLines,
          suggestedQuestions: prior.suggestedQuestions ?? row.suggestedQuestions,
          references: prior.references ?? row.references,
          searchedQueries: prior.searchedQueries ?? row.searchedQueries,
          toolStatus: prior.toolStatus ?? row.toolStatus,
          toolElapsedSec: prior.toolElapsedSec ?? row.toolElapsedSec,
        };
      }
      const matchedKey = contentKey(row.role, row.content);
      unconsumedByKey.set(matchedKey, Math.max(0, (unconsumedByKey.get(matchedKey) ?? 0) - 1));
      continue;
    }
    // No id match: if an in-memory row with the same role+content is still
    // unconsumed, this disk row duplicates a live-committed message — skip it.
    const k = contentKey(row.role, row.content);
    const remaining = unconsumedByKey.get(k) ?? 0;
    if (norm(row.content) && remaining > 0) {
      unconsumedByKey.set(k, remaining - 1);
      continue;
    }
    out.push(row);
  }
  return out;
}
