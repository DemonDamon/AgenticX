/**
 * SP7b unit tests — desktop-side copilot_chat dispatch (real agent replies).
 *
 * Covers the ONE new desktop entry (dispatchCopilotChat in
 * electron/browser-bridge.ts):
 *   - session resolution: explicit id, else GET /api/sessions recency
 *     (re-sorted by updated_at), else explicit errors — the SAME resolver
 *     and error mapping as dispatchInjectContext (postStudioChatTurn);
 *   - request body: a REAL user turn (no context_files placeholder), with
 *     the plan-mandated `[来自页面 <title>](<url>)` prefix when a page
 *     source is present;
 *   - SSE drain aggregation: multi-chunk token frames concatenated
 *     (agent_id defaulting to meta; "⏳" idle placeholder stripped;
 *     tool_call frames ignored), in-stream error frames surfaced;
 *   - 30s timeout → reply_timeout (the turn already reached the session —
 *     keep_runtime_after_disconnect keeps it running in Studio);
 *   - error mapping (session_not_found / studio_chat_5xx /
 *     studio_unreachable / no_active_session) identical to inject;
 *   - bridge wiring: NM copilot_chat row → dispatch →
 *     {type:"copilot_reply"} reply (fire-and-forget, no active_session
 *     push — a panel chat does not change the cached inject target).
 *
 * The SSE frame contract mirrors the real studio emitter
 * (agenticx/studio/server.py: `data: {"type":...,"data":{...}}\n\n`) and the
 * aggregation mirrors the ChatPane liveText consumer — NOT invented for
 * this test.
 *
 * electron is mocked (vitest runs under plain node), mirroring
 * browser-bridge-inject-context.test.ts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    ipcHandlers,
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) =>
        ipcHandlers.set(channel, fn),
      removeHandler: (channel: string) => ipcHandlers.delete(channel),
    },
    webContents: { fromId: () => null },
  };
});
vi.mock("electron", () => electronMock);

import { refreshAgxHomeCache } from "../electron/agx-home";
import {
  dispatchCopilotChat,
  startNearBrowserBridge,
  stopNearBrowserBridge,
  type InjectContextStudio,
  type NmChannel,
} from "../electron/browser-bridge";

describe("SP7b copilot_chat dispatch", () => {
  let tmpHome: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-bridge-sp7b-test-"));
    savedEnv = {
      AGX_HOME: process.env.AGX_HOME,
      AGENTICX_HOME: process.env.AGENTICX_HOME,
    };
    process.env.AGX_HOME = tmpHome;
    delete process.env.AGENTICX_HOME;
    refreshAgxHomeCache();
  });

  afterEach(() => {
    stopNearBrowserBridge();
    vi.useRealTimers();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    refreshAgxHomeCache();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("rejects early when no studio target is configured", async () => {
    const res = await dispatchCopilotChat(copilotRow(), undefined);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("copilot_not_configured");
  });

  it("rejects invalid payloads before any studio call", async () => {
    const studio = studioWith([]);
    const res = await dispatchCopilotChat(copilotRow({ text: "   " }), studio);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_copilot_payload");
    expect(studio.log).toHaveLength(0);
  });

  it("uses an explicit session_id verbatim without probing /api/sessions", async () => {
    const studio = studioWith([{ match: "/api/chat", respond: () => sseChatResponse([replyStream()]) }]);
    const res = await dispatchCopilotChat(copilotRow({ session_id: "s-explicit" }), studio);
    expect(res.ok).toBe(true);
    expect(res.session_id).toBe("s-explicit");
    expect(res.text).toBe("你好，世界");
    expect(studio.log).toHaveLength(1);
    expect(studio.log[0]?.url).toContain("/api/chat");
  });

  it("missing session_id resolves the latest-active session via GET /api/sessions", async () => {
    const studio = studioWith([
      {
        // list_sessions sorts pinned-first; dispatch must re-sort by
        // updated_at so the unpinned but fresher session wins (P1 rule).
        match: "/api/sessions",
        respond: () =>
          jsonResponse(200, {
            ok: true,
            sessions: [
              { session_id: "s-pinned", updated_at: 1000, pinned: true },
              { session_id: "s-latest", updated_at: 2000 },
              { session_id: "s-old", updated_at: 500 },
            ],
          }),
      },
      { match: "/api/chat", respond: () => sseChatResponse([replyStream()]) },
    ]);
    const res = await dispatchCopilotChat(copilotRow({ session_id: "" }), studio);
    expect(res.ok).toBe(true);
    expect(res.session_id).toBe("s-latest");
    expect(studio.log).toHaveLength(2);
    expect(studio.log[0]?.url).toContain("/api/sessions");
    expect((studio.log[0]?.init?.headers as Record<string, string>)["x-agx-desktop-token"]).toBe(
      "tk-studio",
    );
  });

  it("no resolvable session surfaces explicit errors (never silent)", async () => {
    const emptyStudio = studioWith([
      { match: "/api/sessions", respond: () => jsonResponse(200, { ok: true, sessions: [] }) },
    ]);
    const res = await dispatchCopilotChat(copilotRow({ session_id: "" }), emptyStudio);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no_active_session");

    const downStudio = studioWith([
      {
        match: "/api/sessions",
        respond: () => {
          throw new Error("ECONNREFUSED");
        },
      },
    ]);
    const res2 = await dispatchCopilotChat(copilotRow({ session_id: "" }), downStudio);
    expect(res2.ok).toBe(false);
    expect(res2.error).toBe("studio_unreachable");
  });

  it("posts a REAL user turn with the source prefix (no context_files placeholder)", async () => {
    const studio = studioWith([{ match: "/api/chat", respond: () => sseChatResponse([replyStream()]) }]);
    const res = await dispatchCopilotChat(copilotRow(), studio);
    expect(res.ok).toBe(true);
    expect(res.session_id).toBe("s-latest");

    const init = studio.log[0]?.init!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-agx-desktop-token"]).toBe("tk-studio");
    const body = JSON.parse(String(init.body));
    expect(body.session_id).toBe("s-latest");
    // Real user turn: the question itself with the plan-mandated source
    // annotation prefix — NOT the SP5 context_files placeholder mechanism.
    expect(body.user_input).toBe(
      "[来自页面 示例页](https://example.com/a)\n帮我总结这个页面",
    );
    expect(body.context_files).toBeUndefined();
    expect(body.keep_runtime_after_disconnect).toBe(true);
  });

  it("posts the bare question when no page source is present", async () => {
    const studio = studioWith([{ match: "/api/chat", respond: () => sseChatResponse([replyStream()]) }]);
    const res = await dispatchCopilotChat(
      copilotRow({ source_url: "", source_title: "" }),
      studio,
    );
    expect(res.ok).toBe(true);
    const body = JSON.parse(String(studio.log[0]?.init!.body));
    expect(body.user_input).toBe("帮我总结这个页面");
  });

  it("aggregates the assistant reply from multi-chunk SSE token frames", async () => {
    // Full stream deliberately split mid-frame across two transport chunks:
    // the drain must buffer half-frames, keep only meta tokens (agent_id
    // defaults to "meta"), strip the "⏳" idle placeholder and ignore
    // tool_call frames — mirroring the ChatPane liveText consumer.
    const stream = [
      'data: {"type":"token","data":{"text":"你好","agent_id":"meta"}}\n\n',
      'data: {"type":"tool_call","data":{"name":"web_search","tool_call_id":"t1"}}\n\n',
      'data: {"type":"token","data":{"text":"⏳"}}\n\n',
      'data: {"type":"token","data":{"text":"子代理悄悄话","agent_id":"sub-1"}}\n\n',
      'data: {"type":"token","data":{"text":"，世界"}}\n\n',
      'data: {"type":"done","data":{"reason":"end_turn"}}\n\n',
    ].join("");
    const mid = stream.indexOf("，世界");
    const studio = studioWith([
      {
        match: "/api/chat",
        respond: () => sseChatResponse([stream.slice(0, mid), stream.slice(mid)]),
      },
    ]);
    const res = await dispatchCopilotChat(copilotRow(), studio);
    expect(res.ok).toBe(true);
    expect(res.text).toBe("你好，世界");
  });

  it("surfaces in-stream SSE error frames (e.g. session_busy_elsewhere)", async () => {
    const studio = studioWith([
      {
        match: "/api/chat",
        respond: () =>
          sseChatResponse([
            'data: {"type":"error","data":{"error":"session_busy_elsewhere","text":"上一轮还在进行中"}}\n\n',
            'data: {"type":"done","data":{"reason":"session_busy_elsewhere"}}\n\n',
          ]),
      },
    ]);
    const res = await dispatchCopilotChat(copilotRow(), studio);
    expect(res.ok).toBe(false);
    expect(res.session_id).toBe("s-latest");
    expect(res.error).toBe("session_busy_elsewhere");
  });

  it("30s timeout maps to reply_timeout (the turn already reached the session)", async () => {
    vi.useFakeTimers();
    const studio = studioWith([
      {
        match: "/api/chat",
        // Reply stream stalls after the first chunk: the turn is accepted
        // but never finishes within the 30s reply window. The mock stream
        // errors on abort the way a real fetch body would.
        respond: (init) =>
          sseChatResponse(['data: {"type":"token","data":{"text":"部分","agent_id":"meta"}}\n\n'], {
            abortSignal: init?.signal ?? undefined,
          }),
      },
    ]);
    const pending = dispatchCopilotChat(copilotRow({ session_id: "s-live" }), studio);
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.session_id).toBe("s-live");
    expect(res.error).toBe("reply_timeout");
  });

  it("maps studio errors exactly like inject: 404 / 5xx / unreachable", async () => {
    const notFoundStudio = studioWith([{ match: "/api/chat", respond: () => jsonResponse(404, {}) }]);
    const notFound = await dispatchCopilotChat(copilotRow(), notFoundStudio);
    expect(notFound.ok).toBe(false);
    expect(notFound.error).toBe("session_not_found");
    expect(notFound.session_id).toBe("s-latest");

    const downChatStudio = studioWith([
      {
        match: "/api/chat",
        respond: () => {
          throw new Error("studio died");
        },
      },
    ]);
    const down = await dispatchCopilotChat(copilotRow(), downChatStudio);
    expect(down.ok).toBe(false);
    expect(down.error).toBe("studio_unreachable");

    const err500Studio = studioWith([{ match: "/api/chat", respond: () => jsonResponse(500, {}) }]);
    const err500 = await dispatchCopilotChat(copilotRow(), err500Studio);
    expect(err500.ok).toBe(false);
    expect(err500.error).toBe("studio_chat_500");
  });

  it("bridge wiring: copilot_chat row → copilot_reply with the aggregated text", async () => {
    const { channel, sent } = createMockNmChannel();
    const studio = studioWith([{ match: "/api/chat", respond: () => sseChatResponse([replyStream()]) }]);
    startNearBrowserBridge(() => null, {
      nmChannel: channel,
      copilotChatStudio: studio,
    });

    channel.deliverCopilotChat(copilotRow({ request_id: "req-9", session_id: "s-live" }));
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "copilot_reply")).toBe(true);
    });
    const reply = sent.find((m) => m.type === "copilot_reply")!;
    expect(reply.request_id).toBe("req-9");
    expect(reply.ok).toBe(true);
    expect(reply.session_id).toBe("s-live");
    expect(reply.text).toBe("你好，世界");
    // A panel chat must NOT touch the cached inject target.
    expect(sent.filter((m) => m.type === "active_session")).toHaveLength(0);
  });

  it("bridge wiring: failed dispatch still replies with ok:false + error", async () => {
    const { channel, sent } = createMockNmChannel();
    const studio = studioWith([
      { match: "/api/sessions", respond: () => jsonResponse(200, { ok: true, sessions: [] }) },
    ]);
    startNearBrowserBridge(() => null, {
      nmChannel: channel,
      copilotChatStudio: studio,
    });

    channel.deliverCopilotChat(copilotRow({ request_id: "req-x", session_id: "" }));
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "copilot_reply")).toBe(true);
    });
    const reply = sent.find((m) => m.type === "copilot_reply")!;
    expect(reply.request_id).toBe("req-x");
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("no_active_session");
  });

  it("bridge wiring: without a studio target every reply fails with copilot_not_configured", async () => {
    const { channel, sent } = createMockNmChannel();
    startNearBrowserBridge(() => null, {
      nmChannel: channel,
    });

    channel.deliverCopilotChat(copilotRow({ request_id: "req-0" }));
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "copilot_reply")).toBe(true);
    });
    const reply = sent.find((m) => m.type === "copilot_reply")!;
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("copilot_not_configured");
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function copilotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: "req-1",
    session_id: "s-latest",
    text: "帮我总结这个页面",
    source_url: "https://example.com/a",
    source_title: "示例页",
    ...overrides,
  };
}

/** The canonical happy-path reply stream: two meta tokens then done. */
function replyStream(): string {
  return [
    'data: {"type":"token","data":{"text":"你好","agent_id":"meta"}}\n\n',
    'data: {"type":"token","data":{"text":"，世界"}}\n\n',
    'data: {"type":"done","data":{"reason":"end_turn"}}\n\n',
  ].join("");
}

/**
 * SSE response double whose body yields the given transport chunks in order.
 * abortSignal errors the stream the way a real fetch body does when the
 * dispatch's 30s timer fires (timeout harness).
 */
function sseChatResponse(chunks: string[], options?: { abortSignal?: AbortSignal }) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (options?.abortSignal) {
        options.abortSignal.addEventListener("abort", () => {
          controller.error(new Error("aborted"));
        });
        return;
      }
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    async json() {
      return {};
    },
    body: stream,
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    body: null,
  };
}

type FetchOutcome = { match: string; respond: (init?: RequestInit) => unknown };

function studioWith(outcomes: FetchOutcome[]): InjectContextStudio & { log: FetchLog } {
  const log: FetchLog = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    log.push({ url: u, init });
    for (const outcome of outcomes) {
      if (u.includes(outcome.match)) return outcome.respond(init);
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
  return {
    url: () => "http://127.0.0.1:8930",
    token: () => "tk-studio",
    fetchFn,
    log,
  };
}

type FetchLog = Array<{ url: string; init?: RequestInit }>;

/**
 * NmChannel double: captures sendAct pushes and lets tests play the SW by
 * delivering copilot_chat rows (mirrors the inject_context flow of the SP5
 * mock channel).
 */
function createMockNmChannel() {
  const sent: Record<string, unknown>[] = [];
  let copilotChatHandler: ((row: Record<string, unknown>) => void) | null = null;
  const channel: NmChannel & { deliverCopilotChat(row: Record<string, unknown>): void } = {
    extensionOnline: () => true,
    sendAct: (message) => {
      sent.push(message);
      return true;
    },
    onActResult: () => {},
    onInjectContext: () => {},
    onCopilotChat: (handler) => {
      copilotChatHandler = handler;
    },
    deliverCopilotChat: (row) => {
      expect(copilotChatHandler).toBeTruthy();
      copilotChatHandler!(row);
    },
  };
  return { channel, sent };
}
