import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../store";

describe("pending message queue session isolation", () => {
  const paneId = "pane-test";

  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      pendingMessages: {
        ...state.pendingMessages,
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

  it("keeps queue unchanged when session id is empty", () => {
    const removed = useAppStore.getState().dequeuePaneMessageForSession(paneId, " ");
    expect(removed).toBeUndefined();
    const remainingIds = (useAppStore.getState().pendingMessages[paneId] ?? []).map((m) => m.id);
    expect(remainingIds).toEqual(["m1", "m2", "m3"]);
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
});
