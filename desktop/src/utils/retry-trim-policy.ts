import type { LoadedSessionMessage } from "./session-message-map";
import type { Message, MsgRole } from "../store";

type DeletableMessage = Pick<Message, "role" | "content" | "timestamp" | "agentId">;
type PersistedMessage = Pick<LoadedSessionMessage, "role" | "content" | "timestamp" | "agent_id">;

function toDeleteSignature(
  role: MsgRole,
  content: string,
  timestamp: number | undefined,
  agentId: string | undefined
): string {
  const ts = typeof timestamp === "number" && Number.isFinite(timestamp) ? String(timestamp) : "";
  return `${role}\u0001${agentId ?? ""}\u0001${ts}\u0001${content}`;
}

export function filterPersistedMessagesForDeletion(
  pending: readonly DeletableMessage[],
  persisted: readonly PersistedMessage[]
): DeletableMessage[] {
  if (pending.length === 0 || persisted.length === 0) return [];

  const persistedCounts = new Map<string, number>();
  for (const row of persisted) {
    const key = toDeleteSignature(
      row.role,
      String(row.content ?? ""),
      typeof row.timestamp === "number" ? row.timestamp : undefined,
      typeof row.agent_id === "string" ? row.agent_id : undefined
    );
    persistedCounts.set(key, (persistedCounts.get(key) ?? 0) + 1);
  }

  const out: DeletableMessage[] = [];
  for (const msg of pending) {
    const key = toDeleteSignature(
      msg.role,
      String(msg.content ?? ""),
      typeof msg.timestamp === "number" ? msg.timestamp : undefined,
      typeof msg.agentId === "string" ? msg.agentId : undefined
    );
    const remain = persistedCounts.get(key) ?? 0;
    if (remain <= 0) continue;
    out.push(msg);
    persistedCounts.set(key, remain - 1);
  }
  return out;
}
