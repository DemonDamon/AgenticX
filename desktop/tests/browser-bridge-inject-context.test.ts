/**
 * SP5 unit tests — desktop-side inject_context dispatch.
 *
 * Covers the ONE new desktop entry (dispatchInjectContext in
 * electron/browser-bridge.ts):
 *   - session resolution: explicit id, else GET /api/sessions recency
 *     (re-sorted by updated_at — list_sessions sorts pinned-first), else
 *     explicit errors;
 *   - the annotated context block posted through the EXISTING context
 *     injection entry (POST /api/chat + context_files keyed by the plan §1.3
 *     format, kind-labeled placeholder user turn per the gateway precedent,
 *     keep_runtime_after_disconnect, SSE first-chunk-then-cancel drain);
 *   - error mapping (session_not_found / studio_chat_5xx / unreachable /
 *     no_active_session) — never a silent drop;
 *   - bridge wiring: NM inject_context row → dispatch →
 *     {type:"inject_context_result"} reply + {type:"active_session"} push on
 *     success, and the best-effort startup active_session probe.
 *
 * NOTE (SP5 plan §2 criterion 5): a full Studio app cannot boot inside a
 * test runner, so THIS file is the desktop-side authority for dispatch
 * semantics; scripts/e2e/verify-page-inject.mjs additionally drives the same
 * dispatch end-to-end through the real NM socket + a minimal mock studio.
 *
 * electron is mocked (vitest runs under plain node), mirroring
 * browser-bridge-extension-backend.test.ts.
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
  dispatchInjectContext,
  formatInjectSourceKey,
  startNearBrowserBridge,
  stopNearBrowserBridge,
  type InjectContextStudio,
  type NmChannel,
} from "../electron/browser-bridge";

describe("SP5 inject_context dispatch", () => {
  let tmpHome: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-bridge-sp5-test-"));
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
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    refreshAgxHomeCache();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("formatInjectSourceKey: plan §1.3 block format", () => {
    expect(formatInjectSourceKey("示例页", "https://example.com/a")).toBe(
      "[来自页面 示例页](https://example.com/a)",
    );
    expect(formatInjectSourceKey("", "https://example.com/a")).toBe(
      "[来自页面 (无标题)](https://example.com/a)",
    );
  });

  it("rejects early when no studio target is configured", async () => {
    const res = await dispatchInjectContext(baseRow(), undefined);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("inject_not_configured");
  });

  it("rejects invalid payloads before any studio call", async () => {
    const studio = studioWith([]);
    for (const bad of [
      baseRow({ kind: "weird" }),
      baseRow({ text: "   " }),
      baseRow({ url: "" }),
    ]) {
      const res = await dispatchInjectContext(bad, studio);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("invalid_inject_payload");
    }
    expect(studio.log).toHaveLength(0);
  });

  it("uses an explicit session_id verbatim without probing /api/sessions", async () => {
    const studio = studioWith([{ match: "/api/chat", respond: () => sseResponse() }]);
    const res = await dispatchInjectContext(baseRow({ session_id: "s-explicit" }), studio);
    expect(res.ok).toBe(true);
    expect(res.session_id).toBe("s-explicit");
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
      { match: "/api/chat", respond: () => sseResponse() },
    ]);
    const res = await dispatchInjectContext(baseRow({ session_id: "" }), studio);
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
    const res = await dispatchInjectContext(baseRow({ session_id: "" }), emptyStudio);
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
    const res2 = await dispatchInjectContext(baseRow({ session_id: "" }), downStudio);
    expect(res2.ok).toBe(false);
    expect(res2.error).toBe("studio_unreachable");
  });

  it("posts the annotated context block through the existing /api/chat entry", async () => {
    const studio = studioWith([{ match: "/api/chat", respond: () => sseResponse() }]);
    const longText = "A".repeat(20000);
    const res = await dispatchInjectContext(
      baseRow({
        kind: "page",
        text: longText,
        truncated: true,
        title: "长文页",
        url: "https://example.com/long",
      }),
      studio,
    );
    expect(res.ok).toBe(true);
    expect(res.session_id).toBe("s-latest");

    const init = studio.log[0]?.init!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-agx-desktop-token"]).toBe("tk-studio");
    const body = JSON.parse(String(init.body));
    expect(body.session_id).toBe("s-latest");
    // Plan §1.3 format as the context_files key — the 2026-03-08 mechanism
    // renders it as `--- [来自页面 <title>](<url>) ---\n<text>`.
    expect(body.context_files).toEqual({
      "[来自页面 长文页](https://example.com/long)": longText,
    });
    // Kind labeled in the placeholder user turn (gateway precedent) + truncation.
    expect(body.user_input).toContain("整页");
    expect(body.user_input).toContain("[来自页面 长文页](https://example.com/long)");
    expect(body.user_input).toContain("已裁剪");
    expect(body.keep_runtime_after_disconnect).toBe(true);
  });

  it("selection kind labels 划词; 404 → session_not_found; 5xx → studio_chat_500; unreachable → studio_unreachable", async () => {
    const okStudio = studioWith([{ match: "/api/chat", respond: () => sseResponse() }]);
    const ok = await dispatchInjectContext(baseRow(), okStudio);
    expect(ok.ok).toBe(true);
    expect(JSON.parse(String(okStudio.log[0]?.init!.body)).user_input).toContain("划词");

    const notFoundStudio = studioWith([{ match: "/api/chat", respond: () => jsonResponse(404, {}) }]);
    const notFound = await dispatchInjectContext(baseRow(), notFoundStudio);
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
    const down = await dispatchInjectContext(baseRow(), downChatStudio);
    expect(down.ok).toBe(false);
    expect(down.error).toBe("studio_unreachable");

    const err500Studio = studioWith([{ match: "/api/chat", respond: () => jsonResponse(500, {}) }]);
    const err500 = await dispatchInjectContext(baseRow(), err500Studio);
    expect(err500.ok).toBe(false);
    expect(err500.error).toBe("studio_chat_500");
  });

  it("bridge wiring: inject_context row → result reply + active_session push on success", async () => {
    const { channel, sent } = createMockNmChannel();
    const studio = studioWith([{ match: "/api/chat", respond: () => sseResponse() }]);
    startNearBrowserBridge(() => null, {
      nmChannel: channel,
      injectContextStudio: studio,
    });

    channel.deliverInjectContext(
      baseRow({ request_id: "req-9", session_id: "s-live" }),
    );
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "inject_context_result")).toBe(true);
    });
    const resultRow = sent.find((m) => m.type === "inject_context_result")!;
    expect(resultRow.request_id).toBe("req-9");
    expect(resultRow.ok).toBe(true);
    expect(resultRow.session_id).toBe("s-live");
    const activeRow = sent.find((m) => m.type === "active_session");
    expect(activeRow?.session_id).toBe("s-live");
  });

  it("bridge wiring: failed dispatch still replies, and pushes no active_session", async () => {
    const { channel, sent } = createMockNmChannel();
    const studio = studioWith([
      { match: "/api/sessions", respond: () => jsonResponse(200, { ok: true, sessions: [] }) },
    ]);
    startNearBrowserBridge(() => null, {
      nmChannel: channel,
      injectContextStudio: studio,
    });

    channel.deliverInjectContext(baseRow({ request_id: "req-x", session_id: "" }));
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "inject_context_result")).toBe(true);
    });
    expect(sent.filter((m) => m.type === "active_session")).toHaveLength(0);
    const resultRow = sent.find((m) => m.type === "inject_context_result")!;
    expect(resultRow.ok).toBe(false);
    expect(resultRow.error).toBe("no_active_session");
  });

  it("bridge wiring: best-effort startup probe pushes the latest active session", async () => {
    const { channel, sent } = createMockNmChannel();
    const studio = studioWith([
      {
        match: "/api/sessions",
        respond: () => jsonResponse(200, { ok: true, sessions: [{ session_id: "s-boot", updated_at: 9 }] }),
      },
    ]);
    startNearBrowserBridge(() => null, {
      nmChannel: channel,
      injectContextStudio: studio,
    });

    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "active_session")).toBe(true);
    });
    expect(sent.find((m) => m.type === "active_session")!.session_id).toBe("s-boot");
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: "req-1",
    session_id: "s-latest",
    url: "https://example.com/a",
    title: "示例页",
    text: "正文内容",
    kind: "selection",
    ...overrides,
  };
}

function sseResponse(status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0x64, 0x61, 0x74, 0x61])); // "data"
      // intentionally never closed: dispatch must cancel after first chunk
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
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

type FetchOutcome = { match: string; respond: () => unknown };

function studioWith(outcomes: FetchOutcome[]): InjectContextStudio & { log: FetchLog } {
  const log: FetchLog = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    log.push({ url: u, init });
    for (const outcome of outcomes) {
      if (u.includes(outcome.match)) return outcome.respond();
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
 * delivering inject_context rows (mirrors the act_result flow of the SP2
 * mock channel).
 */
function createMockNmChannel() {
  const sent: Record<string, unknown>[] = [];
  let injectContextHandler: ((row: Record<string, unknown>) => void) | null = null;
  const channel: NmChannel & { deliverInjectContext(row: Record<string, unknown>): void } = {
    extensionOnline: () => true,
    sendAct: (message) => {
      sent.push(message);
      return true;
    },
    onActResult: () => {},
    onInjectContext: (handler) => {
      injectContextHandler = handler;
    },
    deliverInjectContext: (row) => {
      expect(injectContextHandler).toBeTruthy();
      injectContextHandler!(row);
    },
  };
  return { channel, sent };
}
