import type { QueuedMessage } from "../store";
import { readScopedLocalStorage, scopedKey } from "./backend-scope";

export const PENDING_MESSAGE_QUEUE_STORAGE_KEY = "agx-pending-message-queues-v1";

const STORAGE_VERSION = 1;

type PendingMessageCollection = {
  version: typeof STORAGE_VERSION;
  queues: Record<string, QueuedMessage[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function normalizeMessage(value: unknown): QueuedMessage | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, 256);
  const sessionId = boundedString(value.sessionId, 256).trim();
  const timestamp = Number(value.timestamp);
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.filter(isRecord).slice(0, 24) as QueuedMessage["attachments"]
    : [];
  const contextFiles = Array.isArray(value.contextFiles)
    ? value.contextFiles.filter(isRecord).slice(0, 64) as QueuedMessage["contextFiles"]
    : [];
  if (
    !id ||
    !sessionId ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }
  const text = typeof value.text === "string" ? value.text : "";
  if (!text.trim() && attachments.length === 0 && contextFiles.length === 0) return null;
  return {
    id,
    sessionId,
    text,
    attachments,
    contextFiles,
    timestamp,
  };
}

export function parsePendingMessageQueues(
  raw: string | null | undefined,
): Record<string, QueuedMessage[]> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !isRecord(parsed.queues)) {
      return {};
    }
    const queues: Record<string, QueuedMessage[]> = {};
    for (const [rawPaneId, rawMessages] of Object.entries(parsed.queues)) {
      const paneId = boundedString(rawPaneId, 256).trim();
      if (!paneId || !Array.isArray(rawMessages)) continue;
      const messages = rawMessages
        .map((message) => normalizeMessage(message))
        .filter((message): message is QueuedMessage => message !== null);
      if (messages.length > 0) queues[paneId] = messages;
    }
    return queues;
  } catch {
    return {};
  }
}

export function serializePendingMessageQueues(
  queues: Record<string, QueuedMessage[]>,
): string {
  const boundedQueues: Record<string, QueuedMessage[]> = {};
  for (const [rawPaneId, messages] of Object.entries(queues)) {
    const paneId = boundedString(rawPaneId, 256).trim();
    if (!paneId || !Array.isArray(messages)) continue;
    const normalized = messages
      .map((message) => normalizeMessage(message))
      .filter((message): message is QueuedMessage => message !== null);
    if (normalized.length > 0) boundedQueues[paneId] = normalized;
  }
  return JSON.stringify({ version: STORAGE_VERSION, queues: boundedQueues } satisfies PendingMessageCollection);
}

export function loadPendingMessageQueues(): Record<string, QueuedMessage[]> {
  return parsePendingMessageQueues(readScopedLocalStorage(PENDING_MESSAGE_QUEUE_STORAGE_KEY));
}

export function savePendingMessageQueues(queues: Record<string, QueuedMessage[]>): boolean {
  const raw = serializePendingMessageQueues(queues);
  try {
    window.localStorage.setItem(scopedKey(PENDING_MESSAGE_QUEUE_STORAGE_KEY), raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return only queued follow-ups owned by the session currently shown in a pane.
 *
 * A pane can retain queued messages while the user navigates between sessions;
 * callers must never render or trigger a continuation from another session.
 */
export function queuedMessagesForSession(
  messages: readonly QueuedMessage[],
  sessionId: string | undefined | null,
): QueuedMessage[] {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return [];
  return messages.filter((message) => String(message.sessionId ?? "").trim() === sid);
}

/** Count messages that belong to another session without exposing their text. */
export function countQueuedMessagesForOtherSessions(
  messages: readonly QueuedMessage[],
  sessionId: string | undefined | null,
): number {
  const sid = String(sessionId ?? "").trim();
  return messages.filter((message) => {
    const owner = String(message.sessionId ?? "").trim();
    return owner.length > 0 && owner !== sid;
  }).length;
}
