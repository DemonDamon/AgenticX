import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { dispatchAgentMention } from "../agent-reply";
import type { CollabRoomMessage } from "../types";

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";

const session: AuthContext = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "alice@example.com",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const agent: EnterpriseAgent = {
  id: "01AGENT0AAAAAAAAAAAAAAAAAA",
  tenantId: session.tenantId,
  slug: "report-bot",
  displayName: "验收助手",
  description: null,
  systemPrompt: "只回答和报表有关的问题。",
  model: "demo/reply-model",
  runtime: "cloud",
  capabilityIds: [],
  assignmentKeys: ["all"],
  workerKeys: [],
  status: "active",
  lifecycle: "published",
  origin: "enterprise",
  ownerUserId: null,
  localAvatarId: null,
  metadata: {},
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

function msg(partial: Partial<CollabRoomMessage> & Pick<CollabRoomMessage, "seq" | "content">): CollabRoomMessage {
  return {
    id: `id-${partial.seq}`,
    room_id: ROOM,
    tenant_id: session.tenantId,
    sender_type: "human",
    sender_id: session.userId,
    sender_name: "Alice",
    client_msg_id: null,
    created_at: "2026-10-14T00:00:00.000Z",
    ...partial,
  };
}

const trigger = msg({ id: "01MSG0AAAAAAAAAAAAAAAAAAAA", seq: 2, content: "@report-bot 介绍你自己" });

const SID = "01SESSION0AAAAAAAAAAAAAAAA";
const T0 = "2026-10-25T00:00:00.000Z";
const T1 = "2026-10-25T00:00:01.500Z";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sseBody(events: Array<Record<string, unknown>>, opts?: { hang?: boolean }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = `: ping\n\n${events
    .map((event) => `id: ${String(event.seq)}\nevent: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("")}`;
  const bytes = encoder.encode(text);
  if (!opts?.hang) {
    return new ReadableStream({
      start(controller) {
        if (bytes.byteLength > 0) controller.enqueue(bytes);
        controller.close();
      },
    });
  }
  let rejectHang: ((error: Error) => void) | undefined;
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
    },
    pull() {
      return new Promise((_, reject) => {
        rejectHang = reject;
      });
    },
    cancel(reason) {
      const error = reason instanceof Error ? reason : new DOMException("This operation was aborted", "AbortError");
      rejectHang?.(error);
      rejectHang = undefined;
    },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function runtimeFetch(routes: {
  create?: () => Response;
  post?: (body: { events: Array<{ type: string }> }) => Response;
  stream?: (url: URL, init?: RequestInit) => Response;
}): typeof fetch & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    calls.push({ url, init });
    const parsed = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && parsed.pathname === "/ma/v1/sessions") {
      return routes.create ? routes.create() : new Response("not found", { status: 404 });
    }
    if (method === "GET" && /\/ma\/v1\/sessions\/[^/]+\/events\/stream$/.test(parsed.pathname)) {
      return routes.stream ? routes.stream(parsed, init) : new Response("not found", { status: 404 });
    }
    if (method === "POST" && /\/ma\/v1\/sessions\/[^/]+\/events$/.test(parsed.pathname)) {
      const body = init?.body ? (JSON.parse(String(init.body)) as { events: Array<{ type: string }> }) : { events: [] };
      return routes.post ? routes.post(body) : new Response("not found", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
  return Object.assign(impl, { calls });
}

function standardEvents(): Array<Record<string, unknown>> {
  return [
    { id: "e2", seq: 2, type: "session.status_running", created_at: T0 },
    { id: "e3", seq: 3, type: "span.model_request_start", model: "demo/reply-model", created_at: T0 },
    {
      id: "01TOOLUSE0AAAAAAAAAAAAAAAA",
      seq: 4,
      type: "agent.tool_use",
      name: "bash_exec",
      input: { command: "echo secret-output" },
      evaluated_policy: "always_allow",
      created_at: T0,
    },
    {
      id: "e5",
      seq: 5,
      type: "agent.tool_result",
      tool_use_id: "01TOOLUSE0AAAAAAAAAAAAAAAA",
      content: [{ type: "text", text: "secret-output" }],
      is_error: false,
      created_at: T1,
    },
    { id: "e6", seq: 6, type: "span.model_request_end", created_at: T1 },
    { id: "e7", seq: 7, type: "agent.message", content: [{ type: "text", text: "托管回复" }], created_at: T1 },
    { id: "e8", seq: 8, type: "session.usage", created_at: T1 },
    { id: "e9", seq: 9, type: "session.status_idle", stop_reason: { type: "end_turn", event_ids: [] }, created_at: T1 },
  ];
}

describe("dispatchAgentMention", () => {
  beforeEach(() => {
    vi.stubEnv("MA_RUNTIME_ENABLED", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the agent prompt and writes an agent message on success", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "我是验收助手" } }] }), {
        status: 200,
      }),
    );
    const append = vi.fn();
    await dispatchAgentMention({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, agent, trigger, {
      listMessages: async () => [
        msg({
          seq: 1,
          content: "上一句",
          sender_type: "agent",
          sender_id: agent.id,
          sender_name: agent.displayName,
        }),
        trigger,
      ],
      appendMessage: append,
      getAccessToken: async () => "tok",
      gatewayUrl: "http://gateway.test/v1/chat/completions",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-agenticx-agent-id"]).toBe(agent.id);
    expect(headers["x-agenticx-provider"]).toBe("demo");
    expect(headers["x-agenticx-trace-stage"]).toBe("room.agent");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("reply-model");
    expect(body).not.toHaveProperty("tools");
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain(agent.systemPrompt);
    expect(body.messages[0]?.content).toContain("协作房间里的智能体「验收助手」");
    expect(body.messages.find((item) => item.role === "assistant")?.content).toBe("上一句");
    expect(body.messages.find((item) => item.role === "user")?.content).toBe("Alice：@report-bot 介绍你自己");
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.displayName,
        content: "我是验收助手",
        model: agent.model,
        metadata: { agent_slug: "report-bot", runtime: "cloud", reply_to: trigger.id },
      }),
    );
  });

  it("writes a system notice when the gateway returns 403", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const append = vi.fn();
    await dispatchAgentMention({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, agent, trigger, {
      listMessages: async () => [trigger],
      appendMessage: append,
      getAccessToken: async () => "tok",
      gatewayUrl: "http://gateway.test/v1/chat/completions",
      fetchImpl,
    });
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「验收助手」使用的模型对你不可用，请联系管理员",
      }),
    );
  });

  it("queues a desktop worker task and notices when nobody is online", async () => {
    const fetchImpl = vi.fn();
    const append = vi.fn();
    const enqueueAgentTask = vi.fn(async () => ({ id: "task-1" }));
    const hasOnlineWorker = vi.fn(async () => false);
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, runtime: "desktop_worker" },
      trigger,
      {
        listMessages: async () => [
          msg({
            seq: 1,
            content: "上一句",
            sender_type: "agent",
            sender_id: agent.id,
            sender_name: agent.displayName,
          }),
          trigger,
        ],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        enqueueAgentTask,
        hasOnlineWorker,
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(enqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: session.tenantId,
        agentId: agent.id,
        roomId: ROOM,
        triggerMessageId: trigger.id,
        requestedBy: session.userId,
        input: {
          instruction: trigger.content,
          messages: [
            { role: "assistant", name: agent.displayName, content: "上一句" },
            { role: "user", name: "Alice", content: trigger.content },
          ],
        },
      }),
    );
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "当前没有在线的桌面执行端，任务已排队",
      }),
    );
  });

  it("does not write a queue notice when a desktop worker is online", async () => {
    const append = vi.fn();
    const enqueueAgentTask = vi.fn(async () => ({ id: "task-1" }));
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, runtime: "desktop_worker" },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl: vi.fn(),
        enqueueAgentTask,
        hasOnlineWorker: async () => true,
      },
    );
    expect(enqueueAgentTask).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
  });

  it("stores tool step summaries when the cloud agent calls a bound tool", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            method?: string;
            tools?: unknown;
            messages?: Array<{ role?: string }>;
          })
        : {};
      if (url.includes("/streamable-http") && body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/streamable-http") && body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { content: [{ type: "text", text: "hello-acp05" }] },
          }),
          { status: 200 },
        );
      }
      const hasTool = body.messages?.some((item) => item.role === "tool") ?? false;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: hasTool
                ? { content: "回显 hello-acp05" }
                : {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: { name: "diag-echo__echo", arguments: "{\"message\":\"hello-acp05\"}" },
                      },
                    ],
                  },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const append = vi.fn();
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, capabilityIds: ["mcp:01ARZ3NDEKTSV4RRFFQ69G5FAV"] },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        loadMcpServers: async () => [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "diag-echo" }],
      },
    );
    const saved = append.mock.calls[0]?.[2] as { content?: string; metadata?: Record<string, unknown> };
    expect(saved.content).toBe("回显 hello-acp05");
    const steps = saved.metadata?.tool_steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(Object.keys(steps[0] ?? {}).sort()).toEqual(["durationMs", "ok", "server", "tool"]);
    expect(steps[0]).toMatchObject({ tool: "echo", server: "diag-echo", ok: true });
    expect(JSON.stringify(saved.metadata)).not.toContain("hello-acp05");
  });

  it("routes eligible cloud agents to the managed runtime", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: () => new Response(sseBody(standardEvents()), { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const append = vi.fn();
    await dispatchAgentMention({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, agent, trigger, {
      listMessages: async () => [trigger],
      appendMessage: append,
      getAccessToken: async () => "tok",
      gatewayUrl: "http://gateway.test/v1/chat/completions",
      fetchImpl,
      maRuntime: { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }, // gitleaks:allow
      listAvailableModels: async () => ["demo/reply-model"],
    });
    expect(fetchImpl.calls.some((call) => call.url.includes("gateway.test"))).toBe(false);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "agent",
        content: "托管回复",
        metadata: expect.objectContaining({ ma_session_id: SID }),
      }),
    );
  });

  it("falls back to the gateway loop when the runtime rejects the agent", async () => {
    const inner = runtimeFetch({
      create: () => jsonResponse({ error: { code: "agent_version_not_found", message: "agent version not found" } }, 404),
    });
    const fetchImpl = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes("gateway.test")) {
          inner.calls.push({ url, init });
          return jsonResponse({ choices: [{ message: { content: "我是验收助手" } }] }, 200);
        }
        return inner(input, init);
      },
      { calls: inner.calls },
    );
    const append = vi.fn();
    await dispatchAgentMention({ tenantId: session.tenantId, userId: session.userId }, ROOM, session, agent, trigger, {
      listMessages: async () => [trigger],
      appendMessage: append,
      getAccessToken: async () => "tok",
      gatewayUrl: "http://gateway.test/v1/chat/completions",
      fetchImpl,
      maRuntime: { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }, // gitleaks:allow
      listAvailableModels: async () => ["demo/reply-model"],
    });
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        content: "我是验收助手",
        metadata: { agent_slug: "report-bot", runtime: "cloud", reply_to: trigger.id },
      }),
    );
  });

  it("keeps MCP-bound agents on the gateway loop", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
    });
    const append = vi.fn();
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, capabilityIds: ["mcp:01ARZ3NDEKTSV4RRFFQ69G5FAV"] },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        loadMcpServers: async () => [],
        maRuntime: { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }, // gitleaks:allow
        listAvailableModels: async () => ["demo/reply-model"],
      },
    );
    expect(fetchImpl.calls.some((call) => call.url.includes("http://rt"))).toBe(false);
  });

  it("desktop worker agents still enqueue legacy tasks", async () => {
    const fetchImpl = runtimeFetch({});
    const enqueueAgentTask = vi.fn(async () => ({ id: "task-1" }));
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, runtime: "desktop_worker" },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: vi.fn(),
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        enqueueAgentTask,
        hasOnlineWorker: async () => true,
        maRuntime: { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }, // gitleaks:allow
      },
    );
    expect(enqueueAgentTask).toHaveBeenCalledTimes(1);
    expect(fetchImpl.calls.some((call) => call.url.includes("http://rt"))).toBe(false);
  });

  it("routes desktop worker agents to the managed runtime when desktop routing is on", async () => {
    const desktopSid = "01SESSION0DDDDDDDDDDDDDDDD";
    const toolId = "01TOOLUSE0DDDDDDDDDDDDDDDD";
    const started = "2026-10-25T00:00:00.000Z";
    const finished = "2026-10-25T00:00:02.000Z";
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: desktopSid, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: () =>
        new Response(
          sseBody([
            { id: "e2", seq: 2, type: "session.status_running", created_at: started },
            { id: "e3", seq: 3, type: "span.model_request_start", created_at: started },
            { id: toolId, seq: 4, type: "agent.tool_use", name: "file_write", input: { path: "hello.txt" }, created_at: started },
            {
              id: "e5",
              seq: 5,
              type: "agent.tool_result",
              tool_use_id: toolId,
              content: [{ type: "text", text: "secret-output" }],
              is_error: false,
              created_at: finished,
            },
            { id: "e6", seq: 6, type: "span.model_request_end", created_at: finished },
            { id: "e7", seq: 7, type: "agent.message", content: [{ type: "text", text: "桌面回复" }], created_at: finished },
            { id: "e8", seq: 8, type: "session.usage", created_at: finished },
            { id: "e9", seq: 9, type: "session.status_idle", stop_reason: { type: "end_turn", event_ids: [] }, created_at: finished },
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });
    const append = vi.fn();
    const enqueueAgentTask = vi.fn(async () => ({ id: "task-1" }));
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, runtime: "desktop_worker" },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        enqueueAgentTask,
        hasOnlineWorker: async () => false,
        maRuntime: { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }, // gitleaks:allow
        maDesktop: { replyTimeoutMs: 5000, claimNoticeMs: 1000 },
      },
    );
    expect(enqueueAgentTask).not.toHaveBeenCalled();
    const saved = append.mock.calls.find((call) => (call[2] as { senderType?: string }).senderType === "agent")?.[2] as {
      metadata?: { runtime?: string; ma_session_id?: string };
    };
    expect(saved.metadata?.runtime).toBe("desktop_worker");
    expect(saved.metadata?.ma_session_id).toBe(desktopSid);
  });

  it("falls back to the legacy desktop queue when the runtime rejects the session", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ error: { code: "invalid_request", message: "not available" } }, 400),
    });
    const append = vi.fn();
    const enqueueAgentTask = vi.fn(async () => ({ id: "task-1" }));
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, runtime: "desktop_worker" },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: append,
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        enqueueAgentTask,
        hasOnlineWorker: async () => false,
        maRuntime: { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }, // gitleaks:allow
        maDesktop: { replyTimeoutMs: 5000, claimNoticeMs: 1000 },
      },
    );
    expect(enqueueAgentTask).toHaveBeenCalledTimes(1);
    expect(enqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: agent.id, triggerMessageId: trigger.id }),
    );
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "当前没有在线的桌面执行端，任务已排队",
      }),
    );
  });

  it("keeps desktop worker agents on the legacy queue when desktop routing is off", async () => {
    const fetchImpl = runtimeFetch({});
    const enqueueAgentTask = vi.fn(async () => ({ id: "task-1" }));
    await dispatchAgentMention(
      { tenantId: session.tenantId, userId: session.userId },
      ROOM,
      session,
      { ...agent, runtime: "desktop_worker" },
      trigger,
      {
        listMessages: async () => [trigger],
        appendMessage: vi.fn(),
        getAccessToken: async () => "tok",
        gatewayUrl: "http://gateway.test/v1/chat/completions",
        fetchImpl,
        enqueueAgentTask,
        hasOnlineWorker: async () => true,
        maRuntime: { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }, // gitleaks:allow
        maDesktop: null,
      },
    );
    expect(fetchImpl.calls.some((call) => call.url.includes("http://rt"))).toBe(false);
    expect(enqueueAgentTask).toHaveBeenCalledTimes(1);
  });
});
