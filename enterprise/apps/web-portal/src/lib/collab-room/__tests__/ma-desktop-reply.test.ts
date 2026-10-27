import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { maNotices } from "../ma-agent-reply";
import { isManagedDesktopEligible, maDesktopNotices, runManagedDesktopReply } from "../ma-desktop-reply";
import type { MaDesktopRoutingConfig, MaRuntimeConfig } from "../ma-runtime-client";
import type { CollabRoomMessage, CollabRoomStore } from "../types";

vi.mock("../../observability/logger", () => ({
  log: vi.fn(),
}));

const ROOM = "room-1";
const SID = "01SESSION0DDDDDDDDDDDDDDDD";
const TOOL = "01TOOLUSE0DDDDDDDDDDDDDDDD";
const T0 = "2026-10-25T00:00:00.000Z";
const T2 = "2026-10-25T00:00:02.000Z";

const session: AuthContext = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "alice@example.com",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const agent: EnterpriseAgent = {
  id: "01AGENT00DDDDDDDDDDDDDDDDD",
  tenantId: session.tenantId,
  slug: "desk-bot",
  displayName: "桌面助手",
  description: null,
  systemPrompt: "在员工电脑上执行。",
  model: "demo/desk-model",
  runtime: "desktop_worker",
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
const desktopConfig: MaDesktopRoutingConfig = { replyTimeoutMs: 5000, claimNoticeMs: 15_000 };

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

const trigger = msg({ id: "01MSG0DDDDDDDDDDDDDDDDDD", seq: 2, content: "@desk-bot 在工作目录写 hello.txt" });

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

function delayedBody(events: Array<Record<string, unknown>>, delayMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(encoder.encode(`: ping\n\n${events.map(encodeFrame).join("")}`));
      controller.close();
    },
  });
}

function pauseAfter(
  head: Array<Record<string, unknown>>,
  tail: Array<Record<string, unknown>>,
  delayMs: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`: ping\n\n${head.map(encodeFrame).join("")}`));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (tail.length > 0) controller.enqueue(encoder.encode(tail.map(encodeFrame).join("")));
      controller.close();
    },
  });
}

type RuntimeRoutes = {
  create?: () => Response;
  post?: (body: { events: Array<{ type: string }> }) => Response;
  stream?: (url: URL, init?: RequestInit) => Response;
  archive?: () => Response;
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
    if (method === "POST" && /\/ma\/v1\/sessions\/[^/]+\/archive$/.test(parsed.pathname)) {
      return routes.archive ? routes.archive() : jsonResponse({}, 200);
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
    { id: "e3", seq: 3, type: "span.model_request_start", created_at: T0 },
    {
      id: TOOL,
      seq: 4,
      type: "agent.tool_use",
      name: "file_write",
      input: { path: "hello.txt" },
      created_at: T0,
    },
    {
      id: "e5",
      seq: 5,
      type: "agent.tool_result",
      tool_use_id: TOOL,
      content: [{ type: "text", text: "secret-output" }],
      is_error: false,
      created_at: T2,
    },
    { id: "e6", seq: 6, type: "span.model_request_end", created_at: T2 },
    { id: "e7", seq: 7, type: "agent.message", content: [{ type: "text", text: "桌面回复" }], created_at: T2 },
    { id: "e8", seq: 8, type: "session.usage", created_at: T2 },
    { id: "e9", seq: 9, type: "session.status_idle", stop_reason: { type: "end_turn", event_ids: [] }, created_at: T2 },
  ];
}

function streamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function successFetch(events: Array<Record<string, unknown>> = standardEvents()) {
  return runtimeFetch({
    create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
    post: (body) =>
      jsonResponse(
        { events: [{ id: "e-post", seq: body.events[0]?.type === "user.interrupt" ? 20 : 1, type: body.events[0]?.type ?? "user.message" }] },
        200,
      ),
    stream: () => streamResponse(sseBody(events)),
  });
}

function archiveCalls(fetchImpl: { calls: Array<{ url: string }> }): Array<{ url: string }> {
  return fetchImpl.calls.filter((call) => call.url.includes("/archive"));
}

function interruptCalls(fetchImpl: { calls: Array<{ url: string; init?: RequestInit }> }) {
  return fetchImpl.calls.filter((call) => {
    if (!call.init?.body) return false;
    const body = JSON.parse(String(call.init.body)) as { events?: Array<{ type?: string }> };
    return body.events?.[0]?.type === "user.interrupt";
  });
}

async function runDesktop(options: {
  fetchImpl: typeof fetch;
  append?: ReturnType<typeof vi.fn>;
  desktop?: MaDesktopRoutingConfig;
}) {
  const append = options.append ?? vi.fn(async () => ({ id: "saved" }));
  const outcome = await runManagedDesktopReply({
    ctx: { tenantId: session.tenantId, userId: session.userId },
    roomId: ROOM,
    session,
    agent,
    trigger,
    history: [trigger],
    deps: {
      config: runtimeConfig,
      desktop: options.desktop ?? desktopConfig,
      fetchImpl: options.fetchImpl,
      appendMessage: append as unknown as CollabRoomStore["appendMessage"],
    },
  });
  return { outcome, append };
}

describe("managed desktop reply", () => {
  it("isManagedDesktopEligible", () => {
    expect(isManagedDesktopEligible(agent)).toBe(true);
    expect(isManagedDesktopEligible({ ...agent, runtime: "cloud" })).toBe(false);
  });

  it("posts the worker reply with desktop metadata", async () => {
    const fetchImpl = successFetch();
    const { outcome, append } = await runDesktop({ fetchImpl });
    expect(outcome).toEqual({ kind: "handled" });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "agent",
        senderId: agent.id,
        content: "桌面回复",
        model: agent.model,
        metadata: {
          agent_slug: "desk-bot",
          runtime: "desktop_worker",
          reply_to: trigger.id,
          ma_session_id: SID,
          agent_version: 2,
          tool_steps: [{ tool: "file_write", server: "builtin", ok: true, durationMs: 2000 }],
        },
      }),
    );
    const saved = append.mock.calls[0]?.[2] as { metadata?: Record<string, unknown> };
    expect(JSON.stringify(saved.metadata)).not.toContain("secret-output");
    const created = fetchImpl.calls.find((call) => new URL(call.url).pathname === "/ma/v1/sessions");
    expect(JSON.parse(String(created?.init?.body))).toEqual({
      agent_id: agent.id,
      source: "portal",
      title: "协作房间 room-1",
    });
    expect(archiveCalls(fetchImpl)).toHaveLength(0);
  });

  it("falls back when the runtime has no desktop environment", async () => {
    const missing = runtimeFetch({
      create: () => jsonResponse({ error: { code: "environment_not_found", message: "environment not found" } }, 404),
    });
    const denied = await runDesktop({ fetchImpl: missing });
    expect(denied.outcome).toEqual({ kind: "fallback", reason: "create_failed:404" });
    expect(denied.append).not.toHaveBeenCalled();
    expect(archiveCalls(missing)).toHaveLength(0);

    const unavailable = runtimeFetch({
      create: () => jsonResponse({ error: { code: "invalid_request", message: "not available" } }, 400),
    });
    const rejected = await runDesktop({ fetchImpl: unavailable });
    expect(rejected.outcome).toEqual({ kind: "fallback", reason: "create_failed:400" });
    expect(rejected.append).not.toHaveBeenCalled();
    expect(archiveCalls(unavailable)).toHaveLength(0);
  });

  it("archives and falls back when posting fails", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ error: { code: "conflict", message: "conflict" } }, 409),
    });
    const { outcome, append } = await runDesktop({ fetchImpl });
    expect(outcome).toEqual({ kind: "fallback", reason: "post_failed:409" });
    expect(append).not.toHaveBeenCalled();
    expect(archiveCalls(fetchImpl)).toHaveLength(1);
    expect(archiveCalls(fetchImpl)[0]?.url).toContain(SID);

    const brokenArchive = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ error: { code: "conflict", message: "conflict" } }, 409),
      archive: () => jsonResponse({ error: { code: "internal_error", message: "archive failed" } }, 500),
    });
    const archived = await runDesktop({ fetchImpl: brokenArchive });
    expect(archived.outcome).toEqual({ kind: "fallback", reason: "post_failed:409" });
    expect(archiveCalls(brokenArchive)).toHaveLength(1);
  });

  it("posts one queued notice when nobody claims in time", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: () => streamResponse(delayedBody(standardEvents(), 100)),
    });
    const { outcome, append } = await runDesktop({
      fetchImpl,
      desktop: { replyTimeoutMs: 2000, claimNoticeMs: 30 },
    });
    expect(outcome).toEqual({ kind: "handled" });
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[2]).toMatchObject({
      senderType: "system",
      content: "当前没有在线的桌面执行端，任务已排队",
    });
    expect(append.mock.calls[0]?.[2]).toMatchObject({ content: maDesktopNotices.queued });
    expect(append.mock.calls[1]?.[2]).toMatchObject({ senderType: "agent", content: "桌面回复" });
  });

  it("does not post the queued notice once running is seen", async () => {
    const events = standardEvents();
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: () => streamResponse(pauseAfter([events[0]!], events.slice(1), 100)),
    });
    const { outcome, append } = await runDesktop({
      fetchImpl,
      desktop: { replyTimeoutMs: 2000, claimNoticeMs: 50 },
    });
    expect(outcome).toEqual({ kind: "handled" });
    const notices = append.mock.calls.filter((call) => (call[2] as { senderType?: string }).senderType === "system");
    expect(notices).toHaveLength(0);
    expect(append).toHaveBeenCalledWith(expect.anything(), ROOM, expect.objectContaining({ senderType: "agent", content: "桌面回复" }));
  });

  it("archives unclaimed sessions on timeout", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: () => streamResponse(sseBody([], { hang: true })),
    });
    const started = Date.now();
    const { outcome, append } = await runDesktop({
      fetchImpl,
      desktop: { replyTimeoutMs: 50, claimNoticeMs: 1000 },
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(outcome).toEqual({ kind: "handled" });
    expect(archiveCalls(fetchImpl)).toHaveLength(1);
    expect(interruptCalls(fetchImpl)).toHaveLength(0);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「桌面助手」没有桌面执行端接单，本次任务已取消",
      }),
    );
  });

  it("interrupts running sessions on timeout", async () => {
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: (body) =>
        jsonResponse(
          { events: [{ id: "e-post", seq: body.events[0]?.type === "user.interrupt" ? 20 : 1, type: body.events[0]?.type ?? "user.message" }] },
          200,
        ),
      stream: () => streamResponse(sseBody([{ id: "e2", seq: 2, type: "session.status_running", created_at: T0 }], { hang: true })),
    });
    const { outcome, append } = await runDesktop({
      fetchImpl,
      desktop: { replyTimeoutMs: 80, claimNoticeMs: 1000 },
    });
    expect(outcome).toEqual({ kind: "handled" });
    expect(interruptCalls(fetchImpl)).toHaveLength(1);
    expect(JSON.parse(String(interruptCalls(fetchImpl)[0]?.init?.body))).toEqual({ events: [{ type: "user.interrupt" }] });
    expect(archiveCalls(fetchImpl)).toHaveLength(0);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: "智能体「桌面助手」处理超时，请稍后再试",
      }),
    );
  });

  it("interrupts when the worker asks for confirmation", async () => {
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
              tool_use_id: TOOL,
              content: [{ type: "text", text: "secret-output" }],
              is_error: true,
              created_at: T2,
            },
            { id: "e7", seq: 7, type: "session.status_idle", stop_reason: { type: "end_turn", event_ids: [] }, created_at: T2 },
          ]);
          close?.();
          return jsonResponse({ events: [{ id: "e-int", seq: 20, type: "user.interrupt" }] }, 200);
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
                id: TOOL,
                seq: 4,
                type: "agent.tool_use",
                name: "file_write",
                input: { path: "hello.txt" },
                created_at: T0,
              },
              {
                id: "e5",
                seq: 5,
                type: "session.status_idle",
                stop_reason: { type: "requires_action", event_ids: [TOOL] },
                created_at: T0,
              },
            ];
            ctrl.enqueue(encoder.encode(`: ping\n\n${first.map(encodeFrame).join("")}`));
          },
        });
        push = (events) => controller?.enqueue(encoder.encode(events.map(encodeFrame).join("")));
        close = () => controller?.close();
        return streamResponse(stream);
      },
    });
    const { outcome, append } = await runDesktop({ fetchImpl });
    expect(outcome).toEqual({ kind: "handled" });
    expect(interruptCalls(fetchImpl)).toHaveLength(1);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: maNotices.needsConfirmation(agent.displayName),
      }),
    );
    const saved = append.mock.calls[0]?.[2] as { senderType?: string };
    expect(saved.senderType).not.toBe("agent");
  });

  it("maps stop reasons without text", async () => {
    const cases = [
      {
        stop: "retries_exhausted",
        notice: maNotices.unavailable(agent.displayName),
        events: [
          { id: "err", seq: 2, type: "session.error", error: { type: "worker_lost" }, created_at: T0 },
          {
            id: "idle",
            seq: 3,
            type: "session.status_idle",
            stop_reason: { type: "retries_exhausted", event_ids: [] },
            created_at: T0,
          },
        ],
      },
      {
        stop: "budget_exceeded",
        notice: maNotices.budgetExceeded(agent.displayName),
        events: [
          {
            id: "idle",
            seq: 2,
            type: "session.status_idle",
            stop_reason: { type: "budget_exceeded", event_ids: [] },
            created_at: T0,
          },
        ],
      },
      {
        stop: "policy_blocked",
        notice: maNotices.policyBlocked(agent.displayName),
        events: [
          {
            id: "idle",
            seq: 2,
            type: "session.status_idle",
            stop_reason: { type: "policy_blocked", event_ids: [] },
            created_at: T0,
          },
        ],
      },
    ] as const;
    for (const item of cases) {
      const fetchImpl = successFetch([...item.events]);
      const { outcome, append } = await runDesktop({ fetchImpl });
      expect(outcome).toEqual({ kind: "handled" });
      expect(append).toHaveBeenCalledWith(
        expect.anything(),
        ROOM,
        expect.objectContaining({ senderType: "system", content: item.notice }),
      );
      expect(item.notice).toContain(
        item.stop === "retries_exhausted" ? "暂时不可用" : item.stop === "budget_exceeded" ? "本次用量已达上限" : "触发合规拦截",
      );
    }
  });

  it("reconnects from the last seen seq", async () => {
    let streams = 0;
    const fetchImpl = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: (url) => {
        streams += 1;
        const events =
          streams === 1
            ? standardEvents().filter((event) => Number(event.seq) <= 4)
            : standardEvents().filter((event) => Number(event.seq) >= 5);
        if (streams === 2) expect(url.searchParams.get("after_seq")).toBe("4");
        return streamResponse(sseBody(events));
      },
    });
    const recovered = await runDesktop({ fetchImpl });
    expect(recovered.outcome).toEqual({ kind: "handled" });
    expect(streams).toBe(2);
    expect(recovered.append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({ senderType: "agent", content: "桌面回复" }),
    );

    let closed = 0;
    const failing = runtimeFetch({
      create: () => jsonResponse({ id: SID, agent_version: 2 }, 201),
      post: () => jsonResponse({ events: [{ id: "e-user", seq: 1, type: "user.message" }] }, 200),
      stream: () => {
        closed += 1;
        return streamResponse(sseBody([{ id: "e2", seq: 2, type: "session.status_running", created_at: T0 }]));
      },
    });
    const givenUp = await runDesktop({ fetchImpl: failing });
    expect(closed).toBe(3);
    expect(givenUp.outcome).toEqual({ kind: "handled" });
    expect(givenUp.append).toHaveBeenCalledWith(
      expect.anything(),
      ROOM,
      expect.objectContaining({
        senderType: "system",
        content: maNotices.unavailable(agent.displayName),
      }),
    );
  });
});
