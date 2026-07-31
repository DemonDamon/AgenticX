import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "@agenticx/core-api";

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    appendMessages: vi.fn().mockResolvedValue(undefined),
    replaceMessages: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn(),
    patchSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    pinSession: vi.fn(),
  }),
  ChatHistoryHttpError: class ChatHistoryHttpError extends Error {
    status = 500;
  },
}));

import { useChatStore } from "./store";

function session(id: string, title: string, activeModel = "model-a"): ChatSession {
  const ts = "2026-05-03T00:00:00.000Z";
  return {
    id,
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    title,
    message_count: 0,
    created_at: ts,
    updated_at: ts,
    active_model: activeModel,
  };
}

describe("switchModel idempotency", () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [session("A", "chat", "model-a")],
      activeSessionId: "A",
      messages: [],
      hydrated: true,
      historyLoading: false,
      historyError: null,
      sessionMessagesLoading: false,
      status: "idle",
      activeModel: "model-a",
      activeRequestId: null,
      streamingSessionId: null,
      streamStateBySessionId: {},
      errorMessage: null,
      draftSessionId: null,
    });
  });

  it("does not rewrite sessions when model is already active", () => {
    const before = useChatStore.getState();
    const sessionsBefore = before.sessions;
    const updatedAtBefore = before.sessions[0]?.updated_at;

    useChatStore.getState().switchModel("model-a");
    useChatStore.getState().switchModel("model-a");

    const after = useChatStore.getState();
    expect(after.activeModel).toBe("model-a");
    expect(after.sessions).toBe(sessionsBefore);
    expect(after.sessions[0]?.updated_at).toBe(updatedAtBefore);
  });

  it("updates once when switching to a different model", () => {
    const updatedAtBefore = useChatStore.getState().sessions[0]?.updated_at;
    useChatStore.getState().switchModel("model-b");
    const after = useChatStore.getState();
    expect(after.activeModel).toBe("model-b");
    expect(after.sessions[0]?.active_model).toBe("model-b");
    expect(after.sessions[0]?.updated_at).not.toBe(updatedAtBefore);
  });
});
