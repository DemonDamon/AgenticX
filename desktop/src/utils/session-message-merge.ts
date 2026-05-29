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
      continue;
    }
    out.push(row);
  }
  return out;
}
