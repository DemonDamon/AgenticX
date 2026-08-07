import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk, ChatClient, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";
import type { ChatSession } from "@agenticx/core-api";

const { appendMessages } = vi.hoisted(() => ({
  appendMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    appendMessages,
    replaceMessages: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn(),
    patchSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    pinSession: vi.fn(),
  }),
  ChatHistoryHttpError: class ChatHistoryHttpError extends Error {
    status = 500;
  },
}));

vi.mock("./utils/deep-research-active-run", () => ({
  fetchActiveDeepResearchRuns: vi.fn().mockResolvedValue([]),
}));

import { useChatStore } from "./store";

function session(id: string, title: string): ChatSession {
  const ts = "2026-05-03T00:00:00.000Z";
  return {
    id,
    tenant_id: "01J00000000000000000000001",
    user_id: "01J00000000000000000000004",
    title,
    message_count: 0,
    created_at: ts,
    updated_at: ts,
  };
}

class CapturingClient implements ChatClient {
  public readonly requests: ChatRequest[] = [];
  private seq = 0;
  public streamChunks: ChatChunk[] | null = null;

  async sendMessage(req: ChatRequest): Promise<SendMessageResult> {
    this.requests.push(req);
    this.seq += 1;
    return { requestId: `req-${this.seq}` };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    if (this.streamChunks) {
      for (const chunk of this.streamChunks) {
        yield { ...chunk, requestId };
      }
      return;
    }
    yield { requestId, done: false, delta: "ok" };
    yield { requestId, done: true };
  }

  async cancel(_requestId: string): Promise<void> {
    // no-op
  }
}

describe("chat store deepResearch request wiring", () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [session("A", "deep research")],
      activeSessionId: "A",
      messages: [],
      hydrated: true,
      historyLoading: false,
      historyError: null,
      sessionMessagesLoading: false,
      status: "idle",
      activeModel: "test-model",
      activeRequestId: null,
      streamingSessionId: null,
      streamStateBySessionId: {},
      errorMessage: null,
      sessionTokens: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        lastInputTokens: 0,
        lastOutputTokens: 0,
        lastUpdatedAt: null,
      },
      sessionTokensBySessionId: {},
      draftSessionId: null,
      responseVersionsByUserMessageId: {},
      pendingMessages: [],
      lastWebSearchBySessionId: {},
      lastDeepResearchBySessionId: {},
    });
  });

  it("forwards deepResearch=true on sendMessage", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "research please", deepResearch: true });
    expect(client.requests[0]?.deepResearch).toBe(true);
    expect(useChatStore.getState().lastDeepResearchBySessionId.A).toBe(true);
  });

  it("persists deep-research user+assistant shell before stream ends (refresh survival)", async () => {
    appendMessages.mockClear();

    const client = new CapturingClient();
    let releaseStream!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    client.streamChunks = null;
    client.stream = async function* stream(requestId: string) {
      yield {
        requestId,
        done: false,
        deepResearchEvent: { type: "run_started", runId: "run-early" },
      };
      await gate;
      yield { requestId, done: true };
    };

    const sendPromise = useChatStore.getState().sendMessage(client, {
      content: "long research",
      deepResearch: true,
    });
    // Early shell persist is fire-and-forget right after optimistic UI.
    await vi.waitFor(() => {
      expect(appendMessages.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    const firstBatch = appendMessages.mock.calls[0]![1] as Array<{
      role: string;
      deep_research?: { runId?: string };
    }>;
    expect(firstBatch.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(firstBatch[1]?.deep_research?.runId).toBe("pending");

    releaseStream();
    await sendPromise;
  });

  it("omits deepResearch when toggle is off", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "no research", deepResearch: false });
    expect(client.requests[0]?.deepResearch).toBeUndefined();
    expect(useChatStore.getState().lastDeepResearchBySessionId.A).toBe(false);
  });

  it("keeps deepResearch=true on regenerateAssistantResponse", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, { content: "deep topic", deepResearch: true });

    const assistantId = useChatStore.getState().messages.find((m) => m.role === "assistant")?.id;
    expect(assistantId).toBeTruthy();

    await useChatStore.getState().regenerateAssistantResponse(client, assistantId!);
    expect(client.requests.length).toBeGreaterThanOrEqual(2);
    expect(client.requests.at(-1)?.deepResearch).toBe(true);
  });

  it("applies deepResearchEvent into message.deep_research without polluting content", async () => {
    const client = new CapturingClient();
    client.streamChunks = [
      {
        requestId: "req-1",
        done: false,
        deepResearchEvent: { type: "run_started", runId: "run-1" },
      },
      {
        requestId: "req-1",
        done: false,
        deepResearchEvent: {
          type: "phase",
          phase: "plan",
          message: "正在规划研究路径…",
        },
      },
      { requestId: "req-1", done: false, delta: "报告正文" },
      { requestId: "req-1", done: true },
    ];

    await useChatStore.getState().sendMessage(client, { content: "research", deepResearch: true });
    const assistant = useChatStore.getState().messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("报告正文");
    expect(assistant?.content).not.toContain("正在规划");
    expect(assistant?.deep_research?.runId).toBe("run-1");
    expect(assistant?.deep_research?.events.some((e) => e.type === "phase")).toBe(true);
  });

  it("research_plan proposed → awaiting_clarify so plan_first UI can edit", async () => {
    const client = new CapturingClient();
    client.streamChunks = [
      {
        requestId: "req-1",
        done: false,
        deepResearchEvent: { type: "run_started", runId: "run-plan" },
      },
      {
        requestId: "req-1",
        done: false,
        deepResearchEvent: {
          type: "research_plan",
          runId: "run-plan",
          action: "proposed",
          version: 1,
          plan: {
            version: 1,
            objective: "主题",
            scope: [],
            subQuestions: [{ id: "sq1", title: "子问题" }],
            sourceStrategy: [],
            deliverables: [],
            assumptions: [],
          },
        },
      },
      // Stream stays open while backend waits on the plan gate — no done yet.
    ];

    // Hang the generator after emitting plan so we can assert mid-gate status.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const chunks = client.streamChunks;
    client.streamChunks = null;
    client.stream = async function* stream(requestId: string) {
      for (const chunk of chunks!) {
        yield { ...chunk, requestId };
      }
      await gate;
      yield { requestId, done: true };
    };

    const sendPromise = useChatStore.getState().sendMessage(client, {
      content: "research",
      deepResearch: true,
    });
    await vi.waitFor(() => {
      const assistant = useChatStore.getState().messages.find((m) => m.role === "assistant");
      expect(assistant?.deep_research?.status).toBe("awaiting_clarify");
    });
    release();
    await sendPromise;
  });

  it("narrative while plan still proposed keeps awaiting_clarify", async () => {
    const client = new CapturingClient();
    client.streamChunks = [
      {
        requestId: "req-1",
        done: false,
        deepResearchEvent: { type: "run_started", runId: "run-plan-2" },
      },
      {
        requestId: "req-1",
        done: false,
        deepResearchEvent: {
          type: "research_plan",
          runId: "run-plan-2",
          action: "proposed",
          version: 1,
          plan: {
            version: 1,
            objective: "主题",
            scope: [],
            subQuestions: [{ id: "sq1", title: "子问题" }],
            sourceStrategy: [],
            deliverables: [],
            assumptions: [],
          },
        },
      },
      {
        requestId: "req-1",
        done: false,
        deepResearchEvent: {
          type: "narrative",
          text: "确认或修改前不会自动开始检索。",
        },
      },
    ];

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const chunks = client.streamChunks;
    client.streamChunks = null;
    client.stream = async function* stream(requestId: string) {
      for (const chunk of chunks!) {
        yield { ...chunk, requestId };
      }
      await gate;
      yield { requestId, done: true };
    };

    const sendPromise = useChatStore.getState().sendMessage(client, {
      content: "research",
      deepResearch: true,
    });
    await vi.waitFor(() => {
      const assistant = useChatStore.getState().messages.find((m) => m.role === "assistant");
      expect(assistant?.deep_research?.status).toBe("awaiting_clarify");
      expect(
        assistant?.deep_research?.events.some(
          (e) => e.type === "research_plan" && e.action === "proposed",
        ),
      ).toBe(true);
    });
    release();
    await sendPromise;
  });
});
