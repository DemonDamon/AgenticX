import {
  appendRoomMessages,
  isCachedRoomMessage,
  listOutbox,
  markOutboxFailed,
  removeOutbox,
} from "./collab-cache";
import { sendMessage, type CollabRoomClientDeps } from "./collab-room-client";

export type OutboxFlushEvent =
  | { type: "outbox_sent"; client_msg_id: string; message: unknown }
  | { type: "outbox_failed"; client_msg_id: string; error: string };

export type OutboxFlushNotify = (roomId: string, event: OutboxFlushEvent) => void;

const FLUSH_INTERVAL_MS = 10_000;

type FailureKind = "client" | "unavailable";

let getDepsRef: (() => CollabRoomClientDeps | null) | null = null;
let notifyRef: OutboxFlushNotify | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let activeFlush: Promise<void> | null = null;

function failureKind(status: number | null): FailureKind {
  if (typeof status === "number" && status >= 400 && status < 500) return "client";
  return "unavailable";
}

async function flushWithDeps(deps: CollabRoomClientDeps, notify: OutboxFlushNotify): Promise<void> {
  const items = listOutbox().slice().sort((a, b) => a.created_at - b.created_at);
  for (const item of items) {
    const result = await sendMessage(deps, item.room_id, item.content, item.client_msg_id);
    if (result.ok) {
      removeOutbox(item.client_msg_id);
      if (isCachedRoomMessage(result.data.message)) {
        try {
          appendRoomMessages(item.room_id, [result.data.message]);
        } catch {
          /* ignore */
        }
      }
      notify(item.room_id, {
        type: "outbox_sent",
        client_msg_id: item.client_msg_id,
        message: result.data.message,
      });
      continue;
    }
    const kind = failureKind(result.status);
    switch (kind) {
      case "client":
        removeOutbox(item.client_msg_id);
        notify(item.room_id, {
          type: "outbox_failed",
          client_msg_id: item.client_msg_id,
          error: result.error,
        });
        continue;
      case "unavailable":
        markOutboxFailed(item.client_msg_id, result.error);
        return;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }
}

export function flushOutbox(args: {
  getDeps: () => CollabRoomClientDeps | null;
  notify: OutboxFlushNotify;
}): Promise<void> {
  if (activeFlush) return activeFlush;
  const deps = args.getDeps();
  if (!deps) return Promise.resolve();
  const run = flushWithDeps(deps, args.notify).finally(() => {
    activeFlush = null;
  });
  activeFlush = run;
  return run;
}

function runScheduledFlush(): void {
  if (!getDepsRef || !notifyRef) return;
  void flushOutbox({ getDeps: getDepsRef, notify: notifyRef });
}

export function startOutboxFlusher(
  getDeps: () => CollabRoomClientDeps | null,
  notify: OutboxFlushNotify,
): void {
  getDepsRef = getDeps;
  notifyRef = notify;
  if (timer) return;
  timer = setInterval(runScheduledFlush, FLUSH_INTERVAL_MS);
}

export function stopOutboxFlusher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function requestOutboxFlush(): void {
  runScheduledFlush();
}
