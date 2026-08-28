"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CollabRoomMessage } from "../../lib/collab-room/types";

export type RoomStreamStatus = "connecting" | "live" | "polling" | "revoked" | "error";

export type UseRoomStreamResult = {
  messages: CollabRoomMessage[];
  status: RoomStreamStatus;
  send: (content: string) => Promise<void>;
};

type Envelope<T> = { code?: string; data?: T; error?: { message?: string } };

export type RoomStreamSessionDeps = {
  roomId: string;
  fetchImpl?: typeof fetch;
  EventSourceImpl?: typeof EventSource;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
};

function maxSeq(messages: CollabRoomMessage[]): number {
  return messages.reduce((max, message) => {
    if (!Number.isFinite(message.seq) || message.seq >= Number.MAX_SAFE_INTEGER) return max;
    return Math.max(max, message.seq);
  }, 0);
}

function upsertMessage(list: CollabRoomMessage[], incoming: CollabRoomMessage): CollabRoomMessage[] {
  const idx = list.findIndex((item) => item.id === incoming.id);
  const next = idx >= 0 ? list.map((item, i) => (i === idx ? incoming : item)) : [...list, incoming];
  return next.slice().sort((a, b) => a.seq - b.seq);
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok) {
    throw new Error(body.error?.message || "请求失败");
  }
  return body.data as T;
}

export function createRoomStreamSession(deps: RoomStreamSessionDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const EventSourceImpl = deps.EventSourceImpl ?? EventSource;
  const setIntervalImpl = deps.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;

  let messages: CollabRoomMessage[] = [];
  let status: RoomStreamStatus = "connecting";
  let cursor = 0;
  let source: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const setStatus = (next: RoomStreamStatus) => {
    status = next;
    notify();
  };

  const applyBatch = (batch: CollabRoomMessage[]) => {
    if (batch.length === 0) return;
    for (const message of batch) messages = upsertMessage(messages, message);
    cursor = maxSeq(messages);
    notify();
  };

  const stopPoll = () => {
    if (pollTimer) {
      clearIntervalImpl(pollTimer);
      pollTimer = null;
    }
  };

  const stopSource = () => {
    source?.close();
    source = null;
  };

  const pollOnce = async () => {
    if (disposed || status === "revoked") return;
    const res = await fetchImpl(
      `/api/rooms/${deps.roomId}/messages?after_seq=${cursor}&limit=200`,
      { cache: "no-store" },
    );
    if (res.status === 403) {
      setStatus("revoked");
      stopPoll();
      stopSource();
      return;
    }
    const data = await readJson<{ messages: CollabRoomMessage[] }>(res);
    applyBatch(data.messages ?? []);
  };

  const startPolling = () => {
    if (disposed || status === "revoked" || pollTimer) return;
    setStatus("polling");
    void pollOnce();
    pollTimer = setIntervalImpl(() => {
      void pollOnce();
    }, 2000);
  };

  const connect = () => {
    if (disposed || status === "revoked") return;
    stopSource();
    source = new EventSourceImpl(`/api/rooms/${deps.roomId}/events?after_seq=${cursor}`);
    source.addEventListener("room_message", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { message: CollabRoomMessage };
        if (payload.message) applyBatch([payload.message]);
      } catch {
        /* ignore */
      }
    });
    source.addEventListener("room_closed", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { reason?: string };
        if (payload.reason === "gone") {
          setStatus("revoked");
          stopSource();
          stopPoll();
          return;
        }
        if (payload.reason === "timeout") {
          stopSource();
          connect();
        }
      } catch {
        /* ignore */
      }
    });
    source.onopen = () => {
      if (status !== "revoked") setStatus("live");
    };
    source.onerror = () => {
      stopSource();
      if (status !== "revoked") startPolling();
    };
  };

  return {
    getMessages: () => messages,
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      try {
        const res = await fetchImpl(`/api/rooms/${deps.roomId}/messages?limit=200`, {
          cache: "no-store",
        });
        if (res.status === 403) {
          setStatus("revoked");
          return;
        }
        const data = await readJson<{ messages: CollabRoomMessage[] }>(res);
        if (disposed) return;
        messages = data.messages ?? [];
        cursor = maxSeq(messages);
        notify();
        connect();
      } catch {
        if (!disposed) setStatus("error");
      }
    },
    async send(content: string) {
      const text = content.trim();
      if (!text) return;
      const tempId = `temp-${Date.now()}`;
      const optimistic: CollabRoomMessage = {
        id: tempId,
        room_id: deps.roomId,
        tenant_id: "",
        seq: Number.MAX_SAFE_INTEGER,
        sender_type: "human",
        sender_id: "self",
        sender_name: "",
        content: text,
        created_at: new Date().toISOString(),
      };
      messages = upsertMessage(messages, optimistic);
      notify();
      try {
        const res = await fetchImpl(`/api/rooms/${deps.roomId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        const data = await readJson<{ message: CollabRoomMessage }>(res);
        messages = upsertMessage(
          messages.filter((item) => item.id !== tempId),
          data.message,
        );
        cursor = Math.max(cursor, data.message.seq);
        notify();
      } catch (error) {
        messages = messages.filter((item) => item.id !== tempId);
        notify();
        throw error;
      }
    },
    dispose() {
      disposed = true;
      stopSource();
      stopPoll();
      listeners.clear();
    },
  };
}

export function useRoomStream(roomId: string): UseRoomStreamResult {
  const [messages, setMessages] = useState<CollabRoomMessage[]>([]);
  const [status, setStatus] = useState<RoomStreamStatus>("connecting");
  const sendRef = useRef<(content: string) => Promise<void>>(async () => {});

  useEffect(() => {
    const session = createRoomStreamSession({ roomId });
    sendRef.current = (content) => session.send(content);
    const unsub = session.subscribe(() => {
      setMessages(session.getMessages());
      setStatus(session.getStatus());
    });
    void session.start();
    return () => {
      unsub();
      session.dispose();
    };
  }, [roomId]);

  const send = useCallback((content: string) => sendRef.current(content), []);
  return { messages, status, send };
}
