import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChunk, ChatClient, ChatRequest, SendMessageResult } from "@agenticx/sdk-ts";
import type { ChatSession } from "@agenticx/core-api";

const { appendMessages, createSession } = vi.hoisted(() => ({
  appendMessages: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn(),
}));

vi.mock("./history-client", () => ({
  createPortalChatHistoryClient: () => ({
    listSessions: vi.fn().mockResolvedValue([]),
    listSessionsPage: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
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
  activeRunReconnectUrl: (runId: string) =>
    `/api/chat/deep-research/runs/${encodeURIComponent(runId)}/stream`,
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
    return { requestId: `req-${this.seq}`, traceId: `01TESTTRACEID0000000000${String(this.seq).padStart(2, "0")}` };
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

  it("sends a draft only once when sendMessage is repeated before promotion", async () => {
    let resolveCreate!: (created: ChatSession) => void;
    createSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const onAccepted = vi.fn();
    useChatStore.setState({
      sessions: [],
      activeSessionId: "draft-A",
      draftSessionId: "draft-A",
      messages: [],
      hydrated: true,
      historyListLoaded: true,
      streamStateBySessionId: {},
      status: "idle",
    });
    const client = new CapturingClient();
    const first = useChatStore.getState().sendMessage(
      client,
      { content: "hello once", deepResearch: true },
      { onAccepted },
    );
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    await useChatStore.getState().sendMessage(client, { content: "hello once", deepResearch: true });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(client.requests).toHaveLength(0);

    resolveCreate({ ...session("real-A", "hello once"), active_model: "test-model" });
    await first;
    expect(onAccepted).toHaveBeenCalledWith("real-A");
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.sessionId).toBe("real-A");
  });

  it("keeps the first draft answer on its session after the user switches away", async () => {
    let resolveCreate!: (created: ChatSession) => void;
    createSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const onAccepted = vi.fn();
    useChatStore.setState({
      sessions: [],
      activeSessionId: "draft-A",
      draftSessionId: "draft-A",
      messages: [],
      hydrated: true,
      historyListLoaded: true,
      streamStateBySessionId: {},
      status: "idle",
    });
    const client = new CapturingClient();
    const first = useChatStore.getState().sendMessage(
      client,
      { content: "stay on A", deepResearch: true },
      { onAccepted },
    );
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    useChatStore.setState((prev) => ({
      sessions: [...prev.sessions, session("B", "other")],
      activeSessionId: "B",
    }));
    resolveCreate({ ...session("real-A", "stay on A"), active_model: "test-model" });
    await first;

    expect(onAccepted).toHaveBeenCalledWith("real-A");
    expect(useChatStore.getState().activeSessionId).toBe("B");
    expect(client.requests[0]?.sessionId).toBe("real-A");
    expect(useChatStore.getState().messages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({ session_id: "real-A", content: "stay on A" }),
    ]);
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

describe("chat store report continuation", () => {
  it("opens a continuation run, hides the control turn from history, and reconnects that run", async () => {
    appendMessages.mockClear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/chat/deep-research/continue")) {
        expect(JSON.parse(String(init?.body))).toEqual({ runId: "source-run" });
        return new Response(JSON.stringify({
          code: "00000",
          data: { runId: "next-run", traceId: "trace-next", sessionId: "A" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("hydrate=1")) {
        expect(url).toContain("runId=next-run");
        return new Response(JSON.stringify({ data: { latest: null } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/runs/next-run/stream")) {
        const frame = JSON.stringify({
          agenticx_deep_research_event: { type: "run_started", runId: "next-run" },
        });
        return new Response(`data: ${frame}\n\ndata: [DONE]\n\n`, { status: 200 });
      }
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    useChatStore.setState({
      sessions: [session("A", "deep research")],
      activeSessionId: "A",
      hydrated: true,
      status: "idle",
      activeRequestId: null,
      streamingSessionId: null,
      streamStateBySessionId: {},
      errorMessage: null,
      messages: [{
        id: "01J0000000000000000000000A",
        session_id: "A",
        tenant_id: "01J00000000000000000000001",
        user_id: "01J00000000000000000000004",
        role: "assistant",
        content: "部分报告",
        created_at: "2026-10-20T00:00:00.000Z",
        model: "saved-model",
        deep_research: {
          runId: "source-run",
          status: "failed",
          events: [{
            type: "report_resume_available",
            runId: "source-run",
            nextRunId: "next-run",
            completedSections: 2,
            totalSections: 4,
          }],
        },
      }],
    });
    try {
      await useChatStore.getState().attachReportContinuation("A", "source-run");
      const messages = useChatStore.getState().messages;
      expect(messages.some((message) => message.control === "continue_report" && message.content === "继续完成报告")).toBe(true);
      const assistant = messages.find((message) => message.deep_research?.runId === "next-run");
      expect(assistant?.trace_id).toBe("trace-next");
      expect(assistant?.model).toBe("saved-model");
      expect(assistant?.deep_research?.events.some((event) => event.type === "run_started")).toBe(true);
      const persisted = appendMessages.mock.calls.flatMap((call) => call[1] as Array<{ content?: string }>);
      expect(persisted.some((message) => message.content === "继续完成报告")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
