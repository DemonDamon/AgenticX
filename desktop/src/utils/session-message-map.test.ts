import { describe, expect, it } from "vitest";
import {
  continueMessageIdForRequest,
  mapLoadedSessionMessage,
  parseBranchLineage,
  parseConversationLineage,
} from "./session-message-map";

describe("mapLoadedSessionMessage turn usage", () => {
  it("maps persisted usage and model onto the Message", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "assistant",
        content: "done",
        provider: "moonshot",
        model: "kimi-k2.6",
        model_selection: "manual",
        usage: {
          input_tokens: 1200,
          output_tokens: 340,
          cached_tokens: 80,
          total_tokens: 1540,
        },
      },
      "sess-1",
      0,
    );
    expect(mapped.provider).toBe("moonshot");
    expect(mapped.model).toBe("kimi-k2.6");
    expect(mapped.modelSelection).toBe("manual");
    expect(mapped.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cachedTokens: 80,
      reasoningTokens: 0,
      totalTokens: 1540,
    });
  });

  it("leaves legacy rows without usage or model selection", () => {
    const mapped = mapLoadedSessionMessage(
      { role: "assistant", content: "old" },
      "sess-1",
      1,
    );
    expect(mapped.usage).toBeUndefined();
    expect(mapped.modelSelection).toBeUndefined();
  });
});

describe("branch lineage messages", () => {
  it("recognizes persisted branch lineage metadata", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "system",
        content: "",
        metadata: {
          branch_lineage: {
            parent_session_id: "source-session",
            parent_run_id: "run-a",
            requested_seq: 101,
            restored_seq: 100,
            source_event_id: "event-101",
          },
        },
      },
      "child-session",
      0,
    );
    expect(parseBranchLineage(mapped.metadata)).toEqual({
      parentSessionId: "source-session",
      parentRunId: "run-a",
      requestedSeq: 101,
      restoredSeq: 100,
      sourceEventId: "event-101",
    });
  });
});

describe("conversation lineage messages", () => {
  it("recognizes persisted conversation lineage metadata", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "system",
        content: "",
        metadata: {
          conversation_lineage: {
            kind: "conversation",
            parent_session_id: "source-session",
            source_message_id: "a1",
            workspace_mode: "shared_current",
            shared_write_prompted: false,
          },
        },
      },
      "child-session",
      0,
    );
    expect(parseConversationLineage(mapped.metadata)).toEqual({
      parentSessionId: "source-session",
      sourceMessageId: "a1",
      workspaceMode: "shared_current",
      sharedWritePrompted: false,
    });
  });

  it("rejects branch lineage rows without conversation kind", () => {
    expect(
      parseConversationLineage({
        branch_lineage: { parent_session_id: "s" },
      }),
    ).toBeNull();
    expect(parseConversationLineage(undefined)).toBeNull();
  });
});

describe("continueMessageIdForRequest", () => {
  const sid = "4d3ece4b-9ef0-4298-9a69-e34f6546442d";

  it("keeps a loaded session index id", () => {
    const assistant = {
      id: `${sid}-i1`,
      role: "assistant" as const,
      content: "你好，团长。我在。",
    };
    expect(continueMessageIdForRequest(sid, [
      { id: `${sid}-i0`, role: "user", content: "你好" },
      assistant,
    ], assistant)).toBe(`${sid}-i1`);
  });

  it("sends client_turn_id for a live user bubble", () => {
    const user = {
      id: "live-uid-user",
      role: "user" as const,
      content: "你好",
      metadata: { client_turn_id: "44f4e8df-791b-4a94-bd55-75b5bec7a71e" },
    };
    expect(continueMessageIdForRequest(sid, [
      user,
      { id: "live-uid-assistant", role: "assistant", content: "你好，团长。我在。" },
    ], user)).toBe("44f4e8df-791b-4a94-bd55-75b5bec7a71e");
  });

  it("synthesizes session-iN for a live assistant bubble", () => {
    const assistant = {
      id: "live-uid-assistant",
      role: "assistant" as const,
      content: "你好，团长。我在。",
    };
    expect(continueMessageIdForRequest(sid, [
      { id: "live-uid-user", role: "user", content: "你好" },
      assistant,
    ], assistant)).toBe(`${sid}-i1`);
  });
});
