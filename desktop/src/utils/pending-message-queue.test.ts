import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import {
  countQueuedMessagesForOtherSessions,
  parsePendingMessageQueues,
  PENDING_MESSAGE_QUEUE_STORAGE_KEY,
  queuedMessagesForSession,
} from "./pending-message-queue";
import { scopedKey } from "./backend-scope";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("pending message queue session isolation", () => {
  const paneId = "pane-test";

  beforeEach(() => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      agenticxDesktop: { getBackendScopeSync: () => "local" },
    } as unknown as Window);
    useAppStore.setState((state) => ({
      ...state,
      pendingMessagesPersistenceFailed: false,
      pendingMessages: {
        [paneId]: [
          {
            id: "m1",
            text: "first",
            sessionId: "sess-a",
            attachments: [],
            contextFiles: [],
            timestamp: 1,
          },
          {
            id: "m2",
            text: "second",
            sessionId: "sess-b",
            attachments: [],
            contextFiles: [],
            timestamp: 2,
          },
          {
            id: "m3",
            text: "third",
            sessionId: "sess-a",
            attachments: [],
            contextFiles: [],
            timestamp: 3,
          },
        ],
      },
    }));
  });

  it("dequeues only messages matching target session", () => {
    const removed = useAppStore.getState().dequeuePaneMessageForSession(paneId, "sess-b");
    expect(removed?.id).toBe("m2");
    const remainingIds = (useAppStore.getState().pendingMessages[paneId] ?? []).map((m) => m.id);
    expect(remainingIds).toEqual(["m1", "m3"]);
  });

  it("shows only queued messages owned by the active session", () => {
    const queue = useAppStore.getState().pendingMessages[paneId] ?? [];
    expect(queuedMessagesForSession(queue, "sess-a").map((message) => message.id)).toEqual([
      "m1",
      "m3",
    ]);
    expect(queuedMessagesForSession(queue, "sess-b").map((message) => message.id)).toEqual([
      "m2",
    ]);
    expect(queuedMessagesForSession(queue, "")).toEqual([]);
    expect(countQueuedMessagesForOtherSessions(queue, "sess-a")).toBe(1);
    expect(countQueuedMessagesForOtherSessions(queue, "")).toBe(3);
  });

  it("keeps queue unchanged when session id is empty", () => {
    const removed = useAppStore.getState().dequeuePaneMessageForSession(paneId, " ");
    expect(removed).toBeUndefined();
    const remainingIds = (useAppStore.getState().pendingMessages[paneId] ?? []).map((m) => m.id);
    expect(remainingIds).toEqual(["m1", "m2", "m3"]);
  });

  it("shows only the queue owned by the active session", () => {
    const queue = useAppStore.getState().pendingMessages[paneId] ?? [];
    expect(queuedMessagesForSession(queue, "sess-a").map((item) => item.id)).toEqual([
      "m1",
      "m3",
    ]);
    expect(queuedMessagesForSession(queue, "sess-b").map((item) => item.id)).toEqual(["m2"]);
    expect(queuedMessagesForSession(queue, "")).toEqual([]);
  });

  it("mimics session switch auto-send without cross-session leak", () => {
    useAppStore.getState().clearPendingMessages(paneId);
    useAppStore.getState().enqueuePaneMessage(paneId, {
      id: "a1",
      text: "followup-a-1",
      sessionId: "sess-a",
      attachments: [],
      contextFiles: [],
      timestamp: 10,
    });
    useAppStore.getState().enqueuePaneMessage(paneId, {
      id: "b1",
      text: "followup-b-1",
      sessionId: "sess-b",
      attachments: [],
      contextFiles: [],
      timestamp: 11,
    });
    useAppStore.getState().enqueuePaneMessage(paneId, {
      id: "a2",
      text: "followup-a-2",
      sessionId: "sess-a",
      attachments: [],
      contextFiles: [],
      timestamp: 12,
    });

    // Session A completes one round: only A queue item may auto-send.
    const firstForA = useAppStore.getState().dequeuePaneMessageForSession(paneId, "sess-a");
    expect(firstForA?.id).toBe("a1");
    expect(firstForA?.text).toBe("followup-a-1");

    // User switches to Session B and it completes: only B queue item may auto-send.
    const firstForB = useAppStore.getState().dequeuePaneMessageForSession(paneId, "sess-b");
    expect(firstForB?.id).toBe("b1");
    expect(firstForB?.text).toBe("followup-b-1");

    // Back to Session A: remaining A queue item is still there.
    const secondForA = useAppStore.getState().dequeuePaneMessageForSession(paneId, "sess-a");
    expect(secondForA?.id).toBe("a2");
    expect(secondForA?.text).toBe("followup-a-2");

    const rest = useAppStore.getState().pendingMessages[paneId] ?? [];
    expect(rest).toHaveLength(0);
  });

  it("persists queued user text so a restart can restore it to the same pane", () => {
    useAppStore.getState().clearPendingMessages(paneId);
    const message = {
      id: "persisted-1",
      text: "生成pdf",
      sessionId: "sess-a",
      attachments: [],
      contextFiles: [],
      timestamp: Date.now(),
    };
    useAppStore.getState().enqueuePaneMessage(paneId, message);

    const raw = window.localStorage.getItem(scopedKey(PENDING_MESSAGE_QUEUE_STORAGE_KEY));
    expect(raw).toBeTruthy();
    expect(parsePendingMessageQueues(raw ?? "")[paneId]).toEqual([message]);
    expect(useAppStore.getState().pendingMessagesPersistenceFailed).toBe(false);
  });

  it("updates persisted queues when a message is edited or removed", () => {
    useAppStore.getState().clearPendingMessages(paneId);
    const message = {
      id: "persisted-2",
      text: "old text",
      sessionId: "sess-a",
      attachments: [],
      contextFiles: [],
      timestamp: Date.now(),
    };
    useAppStore.getState().enqueuePaneMessage(paneId, message);
    useAppStore.getState().editPendingMessage(paneId, message.id, "new text");

    const key = scopedKey(PENDING_MESSAGE_QUEUE_STORAGE_KEY);
    let restored = parsePendingMessageQueues(window.localStorage.getItem(key))[paneId];
    expect(restored).toHaveLength(1);
    expect(restored?.[0]?.text).toBe("new text");

    useAppStore.getState().removePendingMessage(paneId, message.id);
    restored = parsePendingMessageQueues(window.localStorage.getItem(key))[paneId];
    expect(restored).toBeUndefined();
  });
});
