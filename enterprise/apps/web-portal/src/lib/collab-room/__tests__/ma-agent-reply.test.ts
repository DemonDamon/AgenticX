import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { buildRoomContextText, isManagedEligible, runManagedAgentReply } from "../ma-agent-reply";
import type { MaRuntimeConfig } from "../ma-runtime-client";
import type { CollabRoomMessage, CollabRoomStore } from "../types";

vi.mock("../../observability/logger", () => ({
  log: vi.fn(),
}));

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";
const SID = "01SESSION0AAAAAAAAAAAAAAAA";
const T0 = "2026-10-25T00:00:00.000Z";
const T1 = "2026-10-25T00:00:01.500Z";

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

const runtimeConfig: MaRuntimeConfig = { baseUrl: "http://rt", serviceToken: "agx-pat-svc", replyTimeoutMs: 5000 }; // gitleaks:allow

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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function encodeFrame(event: Record<string, unknown>): string {
  return `id: ${String(event.seq)}\nevent: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
}

function sseBody(events: Array<Record<string, unknown>>, opts?: { hang?: boolean }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(`: ping\n\n${events.map(encodeFrame).join("")}`);
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

type RuntimeRoutes = {
  create?: () => Response;
  post?: (body: { events: Array<{ type: string }> }) => Response;
  stream?: (url: URL, init?: RequestInit) => Response;
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function runtimeFetch(routes: RuntimeRoutes): typeof fetch & { calls: Array<{ url: string; init?: RequestInit }> } {
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
    { id: "e6", seq: 6, type: "span.model_request_end", model_usage: { input_tokens: 1 }, created_at: T1 },
    { id: "e7", seq: 7, type: "agent.message", content: [{ type: "text", text: "托管回复" }], created_at: T1 },
    { id: "e8", seq: 8, type: "session.usage", usage: { input_tokens: 1 }, created_at: T1 },
    { id: "e9", seq: 9, type: "session.status_idle", stop_reason: { type: "end_turn", event_ids: [] }, created_at: T1 },
  ];
}

function successFetch(events: Array<Record<string, unknown>> = standardEvents()) {
  return runtimeFetch({
    create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
    post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
    stream: () => new Response(sseBody(events), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
}

async function runReply(options: {
  fetchImpl: typeof fetch;
  append?: ReturnType<typeof vi.fn>;
  listAvailableModels?: (session: AuthContext) => Promise<string[]>;
  agent?: EnterpriseAgent;
  history?: CollabRoomMessage[];
  replyTimeoutMs?: number;
}) {
  const append = options.append ?? vi.fn(async () => ({ id: "saved" }));
  const outcome = await runManagedAgentReply({
    ctx: { tenantId: session.tenantId, userId: session.userId },
    roomId: ROOM,
    session,
    agent: options.agent ?? agent,
    trigger,
    history: options.history ?? [
      msg({ seq: 1, content: "上一句", sender_type: "agent", sender_id: agent.id, sender_name: agent.displayName }),
      trigger,
    ],
    deps: {
      config: { ...runtimeConfig, replyTimeoutMs: options.replyTimeoutMs ?? runtimeConfig.replyTimeoutMs },
      fetchImpl: options.fetchImpl,
      appendMessage: append as unknown as CollabRoomStore["appendMessage"],
      listAvailableModels: options.listAvailableModels ?? (async () => [agent.model]),
    },
  });
  return { outcome, append };
}

describe("managed agent reply", () => {
  it("isManagedEligible", () => {
    expect(isManagedEligible(agent)).toBe(true);
    expect(isManagedEligible({ ...agent, capabilityIds: ["mcp:01ARZ3NDEKTSV4RRFFQ69G5FAV"] })).toBe(false);
    expect(isManagedEligible({ ...agent, metadata: { knowledgeSearchUrl: "https://kb.example.com/search" } })).toBe(false);
    expect(isManagedEligible({ ...agent, runtime: "desktop_worker" })).toBe(false);
  });

  it("buildRoomContextText", () => {
    const history = [
      msg({ seq: 1, content: "上一句", sender_type: "agent", sender_id: agent.id, sender_name: agent.displayName }),
      trigger,
    ];
    expect(buildRoomContextText(agent, history, trigger)).toBe(
      [
        "[协作房间]",
        "你是协作房间里的智能体「验收助手」，房间里有多个成员，回复简洁并指明回应对象。",
        "[最近消息]",
        "你（验收助手）：上一句",
        "[需要你回复的消息]",
        "Alice：@report-bot 介绍你自己",
      ].join("\n"),
    );
    expect(buildRoomContextText(agent, [trigger], trigger)).toContain("[最近消息]\n（无）\n[需要你回复的消息]");

    const many = Array.from({ length: 35 }, (_, index) => msg({ id: `h-${index + 1}`, seq: index + 1, content: `h${index + 1}` }));
    const text = buildRoomContextText(agent, many, trigger);
    const recent = text.split("[最近消息]\n")[1]?.split("\n[需要你回复的消息]")[0]?.split("\n") ?? [];
    expect(recent).toHaveLength(30);
    expect(recent[0]).toBe("Alice：h6");
    expect(recent[29]).toBe("Alice：h35");
    expect(text).not.toContain("Alice：h5");

    const long = "a".repeat(4001);
    const clipped = buildRoomContextText(agent, [msg({ seq: 1, content: long })], trigger);
    expect(clipped).toContain(`Alice：${"a".repeat(4000)}…`);
    expect(clipped).not.toContain("a".repeat(4001));
  });

  it("posts the final agent message with managed metadata", async () => {
    const fetchImpl = successFetch();
    const { outcome, append } = await runReply({ fetchImpl });
    expect(outcome).toEqual({ kind: "handled" });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "agent",
        senderId: agent.id,
        senderName: agent.displayName,
        content: "托管回复",
        model: agent.model,
        metadata: {
          agent_slug: "report-bot",
          runtime: "cloud",
          reply_to: trigger.id,
          ma_session_id: SID,
          agent_version: 2,
          tool_steps: [{ tool: "bash_exec", server: "builtin", ok: true, durationMs: 1500 }],
        },
      }),
    );
    const saved = append.mock.calls[0]?.[2] as { metadata?: Record<string, unknown> };
    expect(JSON.stringify(saved.metadata)).not.toContain("secret-output");
    const posted = fetchImpl.calls.find((call) => call.url.endsWith("/events"));
    const body = JSON.parse(String(posted?.init?.body)) as { events: Array<{ content?: Array<{ text?: string }> }> };
    expect(body.events[0]?.content?.[0]?.text).toContain("[需要你回复的消息]");
  });

  it("denies models the user cannot see without calling the runtime", async () => {
    const fetchImpl = successFetch();
    const { outcome, append } = await runReply({
      fetchImpl,
      listAvailableModels: async () => ["other/model"],
    });
    expect(outcome).toEqual({ kind: "handled" });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「验收助手」使用的模型对你不可用，请联系管理员",
      }),
    );
  });

  it("falls back when the model check throws", async () => {
    const fetchImpl = successFetch();
    const { outcome, append } = await runReply({
      fetchImpl,
      listAvailableModels: async () => {
        throw new Error("db down");
      },
    });
    expect(outcome).toEqual({ kind: "fallback", reason: "model_check_failed" });
    expect(append).not.toHaveBeenCalled();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("falls back when the session cannot be created", async () => {
    const missing = runtimeFetch({
      create: () => jsonResponse({ error: { code: "agent_version_not_found", message: "agent version not found" } }, 404),
    });
    const denied = await runReply({ fetchImpl: missing });
    expect(denied.outcome).toEqual({ kind: "fallback", reason: "create_failed:404" });
    expect(denied.append).not.toHaveBeenCalled();

    const calls: string[] = [];
    const broken = Object.assign(
      async (input: RequestInfo | URL) => {
        calls.push(requestUrl(input));
        throw new TypeError("network down");
      },
      { calls: [] as Array<{ url: string; init?: RequestInit }> },
    );
    const offline = await runReply({ fetchImpl: broken });
    expect(offline.outcome).toEqual({ kind: "fallback", reason: "create_failed:0" });
    expect(offline.append).not.toHaveBeenCalled();
  });

  it("falls back when posting the message fails", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ error: { code: "conflict", message: "conflict" } }, 409),
    });
    const { outcome, append } = await runReply({ fetchImpl });
    expect(outcome).toEqual({ kind: "fallback", reason: "post_failed:409" });
    expect(append).not.toHaveBeenCalled();
  });

  it("interrupts sessions that require action", async () => {
    let push: ((events: Array<Record<string, unknown>>) => void) | null = null;
    let close: (() => void) | null = null;
    const encoder = new TextEncoder();
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: (body) => {
        if (body.events[0]?.type === "user.interrupt") {
          push?.([
            {
              id: "e6",
              seq: 6,
              type: "agent.tool_result",
              tool_use_id: "01TOOLUSE0AAAAAAAAAAAAAAAA",
              content: [{ type: "text", text: "secret-output" }],
              is_error: true,
              created_at: T1,
            },
            { id: "e7", seq: 7, type: "session.status_idle", stop_reason: { type: "end_turn", event_ids: [] }, created_at: T1 },
          ]);
          close?.();
          return jsonResponse({ events: [{ id: "e-int", seq: 10, type: "user.interrupt" }] }, 200);
        }
        return jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200);
      },
      stream: () => {
        let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            controller = ctrl;
            const first = [
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
                type: "session.status_idle",
                stop_reason: { type: "requires_action", event_ids: ["01TOOLUSE0AAAAAAAAAAAAAAAA"] },
                created_at: T0,
              },
            ];
            ctrl.enqueue(encoder.encode(`: ping\n\n${first.map(encodeFrame).join("")}`));
          },
        });
        push = (events) => controller?.enqueue(encoder.encode(events.map(encodeFrame).join("")));
        close = () => controller?.close();
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const { outcome, append } = await runReply({ fetchImpl });
    expect(outcome).toEqual({ kind: "handled" });
    const interrupts = fetchImpl.calls.filter((call) => {
      if (!call.init?.body) return false;
      const body = JSON.parse(String(call.init.body)) as { events?: Array<{ type?: string }> };
      return body.events?.[0]?.type === "user.interrupt";
    });
    expect(interrupts).toHaveLength(1);
    expect(JSON.parse(String(interrupts[0]?.init?.body))).toEqual({ events: [{ type: "user.interrupt" }] });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「验收助手」需要人工确认才能继续，协作房间暂不支持确认，本次回复已中止",
      }),
    );
  });

  it("times out, interrupts and notices", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: (body) => jsonResponse({ events: [{ id: "e-post", seq: body.events[0]?.type === "user.interrupt" ? 10 : 1, type: body.events[0]?.type ?? "user.message" }] }, 200),
      stream: () => new Response(sseBody([], { hang: true }), { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const started = Date.now();
    const { outcome, append } = await runReply({ fetchImpl, replyTimeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(outcome).toEqual({ kind: "handled" });
    const interrupts = fetchImpl.calls.filter((call) => String(call.init?.body ?? "").includes("user.interrupt"));
    expect(interrupts).toHaveLength(1);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「验收助手」处理超时，请稍后再试",
      }),
    );
  });

  it("reconnects from the last seen seq", async () => {
    let streams = 0;
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: (url) => {
        streams += 1;
        const events = streams === 1 ? standardEvents().filter((event) => Number(event.seq) <= 4) : standardEvents().filter((event) => Number(event.seq) >= 5);
        if (streams === 2) expect(url.searchParams.get("after_seq")).toBe("4");
        return new Response(sseBody(events), { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const { outcome, append } = await runReply({ fetchImpl });
    expect(outcome).toEqual({ kind: "handled" });
    expect(streams).toBe(2);
    expect(append).toHaveBeenCalledWith(expect.anything(), ROOM, expect.objectContaining({ senderType: "agent", content: "托管回复" }));
  });

  it("gives up after two reconnects", async () => {
    let streams = 0;
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: () => {
        streams += 1;
        return new Response(sseBody([{ id: "e2", seq: 2, type: "session.status_running", created_at: T0 }]), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const { outcome, append } = await runReply({ fetchImpl });
    expect(streams).toBe(3);
    expect(outcome).toEqual({ kind: "handled" });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「验收助手」暂时不可用，请稍后再试",
      }),
    );
  });

  it("maps stop reasons without text to notices", async () => {
    const cases = [
      ["policy_blocked", "智能体「验收助手」的请求触发合规拦截"],
      ["budget_exceeded", "智能体「验收助手」本次用量已达上限，请联系管理员"],
      ["retries_exhausted", "智能体「验收助手」暂时不可用，请稍后再试"],
    ] as const;
    for (const [stop, notice] of cases) {
      const fetchImpl = successFetch([
        { id: "e2", seq: 2, type: "session.status_idle", stop_reason: { type: stop, event_ids: [] }, created_at: T0 },
      ]);
      const { outcome, append } = await runReply({ fetchImpl });
      expect(outcome).toEqual({ kind: "handled" });
      expect(append).toHaveBeenCalledWith(expect.anything(), ROOM, expect.objectContaining({ senderType: "system", content: notice }));
    }

    const fetchImpl = successFetch([
      { id: "e2", seq: 2, type: "agent.message", content: [{ type: "text", text: "托管回复" }], created_at: T0 },
      { id: "e3", seq: 3, type: "session.status_idle", stop_reason: { type: "max_tool_rounds", event_ids: [] }, created_at: T1 },
    ]);
    const { outcome, append } = await runReply({ fetchImpl });
    expect(outcome).toEqual({ kind: "handled" });
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({ senderType: "agent", content: "托管回复", model: agent.model }),
    );
    const saved = append.mock.calls[0]?.[2] as { senderType?: string };
    expect(saved.senderType).toBe("agent");
  });
});
