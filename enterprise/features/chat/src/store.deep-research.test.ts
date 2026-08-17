import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk, ChatClient, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";
import type { ChatSession } from "@agenticx/core-api";

const { createSession, appendMessages } = vi.hoisted(() => ({
  createSession: vi.fn(),
  appendMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    createSession,
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
  public onStreamStart?: (requestId: string) => void;

  async sendMessage(req: ChatRequest): Promise<SendMessageResult> {
    this.requests.push(req);
    this.seq += 1;
    return { requestId: `req-${this.seq}`, traceId: `01TESTTRACEID0000000000${String(this.seq).padStart(2, "0")}` };
  }

  async *stream(requestId: string): AsyncIterable<ChatChunk> {
    this.onStreamStart?.(requestId);
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
      lastDeepResearchAutoBySessionId: {},
      planChatRevising: false,
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

  it("keeps automatic deep research enabled on regenerate", async () => {
    const client = new CapturingClient();
    await useChatStore.getState().sendMessage(client, {
      content: "research when needed",
      deepResearch: false,
      deepResearchAuto: true,
    });

    expect(client.requests[0]?.deepResearch).toBeUndefined();
    expect(client.requests[0]?.deepResearchAuto).toBe(true);
    expect(useChatStore.getState().lastDeepResearchAutoBySessionId.A).toBe(true);

    const assistantId = useChatStore.getState().messages.find((m) => m.role === "assistant")?.id;
    expect(assistantId).toBeTruthy();
    await useChatStore.getState().regenerateAssistantResponse(client, assistantId!);
    expect(client.requests.at(-1)?.deepResearchAuto).toBe(true);
  });

  it("forwards the selected interaction policy in automatic deep research mode", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "card_first"),
      setItem: vi.fn(),
    });
    const client = new CapturingClient();

    await useChatStore.getState().sendMessage(client, {
      content: "research when needed",
      deepResearch: false,
      deepResearchAuto: true,
    });

    expect(client.requests[0]?.deepResearchInteraction).toBe("card_first");
  });

  it("keeps a queued manual activation forced after the composer switches to auto", async () => {
    const client = new CapturingClient();
    useChatStore.setState({
      streamStateBySessionId: {
        A: { status: "streaming", activeRequestId: "req-active" },
      },
      lastDeepResearchBySessionId: { A: false },
      lastDeepResearchAutoBySessionId: { A: true },
    });

    await useChatStore.getState().sendMessage(client, {
      content: "这条需要强制深度研究",
      deepResearch: true,
      deepResearchAuto: false,
    });

    const queued = useChatStore.getState().pendingMessages[0];
    expect(queued).toMatchObject({
      deepResearch: true,
      deepResearchAuto: false,
    });

    // The UI changes the persistent chip to automatic immediately after the
    // manual turn is accepted. Dispatch must still use this message's snapshot.
    useChatStore.setState({
      streamStateBySessionId: {},
      lastDeepResearchBySessionId: { A: false },
      lastDeepResearchAutoBySessionId: { A: true },
    });
    await useChatStore.getState().sendQueuedMessageNow(client, queued!.id);

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.deepResearch).toBe(true);
    expect(client.requests[0]?.deepResearchAuto).toBeUndefined();
  });

  it("does not acknowledge a manual turn when draft-session creation fails", async () => {
    const client = new CapturingClient();
    const onAccepted = vi.fn();
    createSession.mockRejectedValueOnce(new Error("create failed"));
    useChatStore.setState({
      sessions: [],
      activeSessionId: "draft-A",
      draftSessionId: "draft-A",
    });

    await useChatStore.getState().sendMessage(
      client,
      { content: "首条手动深度研究", deepResearch: true },
      { onAccepted },
    );

    expect(onAccepted).not.toHaveBeenCalled();
    expect(client.requests).toHaveLength(0);
    expect(useChatStore.getState().draftSessionId).toBe("draft-A");
  });

  it("acknowledges a promoted draft with its persisted session id", async () => {
    const client = new CapturingClient();
    const onAccepted = vi.fn();
    createSession.mockResolvedValueOnce({
      ...session("real-A", "首条手动深度研究"),
      active_model: "test-model",
    });
    useChatStore.setState({
      sessions: [],
      activeSessionId: "draft-A",
      draftSessionId: "draft-A",
    });

    await useChatStore.getState().sendMessage(
      client,
      { content: "首条手动深度研究", deepResearch: true },
      { onAccepted },
    );

    expect(onAccepted).toHaveBeenCalledWith("real-A");
    expect(client.requests[0]?.sessionId).toBe("real-A");
  });

  it("dispatches a queued manual turn to its own session after switching conversations", async () => {
    const client = new CapturingClient();
    useChatStore.setState({
      sessions: [
        { ...session("A", "research"), active_model: "model-A" },
        { ...session("B", "other"), active_model: "model-B" },
      ],
      activeSessionId: "B",
      activeModel: "model-B",
      pendingMessages: [
        {
          id: "queued-A",
          sessionId: "A",
          content: "A 会话中的手动深度研究",
          deepResearch: true,
          deepResearchAuto: false,
          timestamp: Date.now(),
        },
      ],
    });

    await useChatStore.getState().sendQueuedMessageNow(client, "queued-A");

    expect(client.requests[0]?.sessionId).toBe("A");
    expect(client.requests[0]?.model).toBe("model-A");
    expect(client.requests[0]?.deepResearch).toBe(true);
    expect(useChatStore.getState().activeSessionId).toBe("B");
    expect(
      useChatStore.getState().messages.filter((message) => message.session_id === "A"),
    ).toHaveLength(2);
  });

  it("uses the queued mode snapshot during automatic queue draining", async () => {
    const client = new CapturingClient();
    client.onStreamStart = () => {
      useChatStore.setState({ activeSessionId: "B", activeModel: "model-B" });
      client.onStreamStart = undefined;
    };
    useChatStore.setState({
      sessions: [
        { ...session("A", "research"), active_model: "model-A" },
        { ...session("B", "other"), active_model: "model-B" },
      ],
      pendingMessages: [
        {
          id: "queued-manual",
          sessionId: "A",
          content: "排队的手动深度研究",
          deepResearch: true,
          deepResearchAuto: false,
          timestamp: Date.now(),
        },
      ],
    });

    await useChatStore.getState().sendMessage(client, {
      content: "当前自动模式消息",
      deepResearch: false,
      deepResearchAuto: true,
    });
    await vi.waitFor(() => expect(client.requests).toHaveLength(2));

    expect(client.requests[0]?.deepResearchAuto).toBe(true);
    expect(client.requests[0]?.sessionId).toBe("A");
    expect(client.requests[1]?.deepResearch).toBe(true);
    expect(client.requests[1]?.deepResearchAuto).toBeUndefined();
    expect(client.requests[1]?.sessionId).toBe("A");
    expect(client.requests[1]?.model).toBe("model-A");
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
