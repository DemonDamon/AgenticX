import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MA_STREAM_BACKOFF_MS,
  MaStreamRegistry,
  buildCreateSessionBody,
  maRequest,
  resolveMaEndpoint,
  type MaFetch,
} from "../electron/ma-session-client";

const TOKEN = "agx-pat-t"; // gitleaks:allow
const endpoint = { baseUrl: "http://127.0.0.1:8092", token: TOKEN };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function hangingBody(signal: AbortSignal | undefined): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => {
        try {
          controller.error(new DOMException("aborted", "AbortError"));
        } catch {
          // The stream is already closed or errored.
        }
      };
      if (!signal) return;
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveMaEndpoint", () => {
  it("requires an enabled agx-pat and a base url", () => {
    expect(resolveMaEndpoint({})).toBeNull();
    expect(resolveMaEndpoint({ enterprise: { enabled: true, token: "not-a-pat", base_url: "http://portal" } })).toBeNull(); // gitleaks:allow
    expect(resolveMaEndpoint({ enterprise: { enabled: true, token: TOKEN } })).toBeNull();
    expect(resolveMaEndpoint({
      enterprise: {
        enabled: true,
        token: TOKEN,
        base_url: "http://portal.example/",
        worker: { ma_base_url: "http://127.0.0.1:8092/" },
      },
    })).toEqual({ baseUrl: "http://127.0.0.1:8092", token: TOKEN });
    expect(resolveMaEndpoint({
      enterprise: { enabled: true, token: TOKEN, base_url: "http://portal.example/" },
    })).toEqual({ baseUrl: "http://portal.example", token: TOKEN });
  });
});

describe("maRequest", () => {
  it("maps errors without leaking the token", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("conflict")) return jsonResponse({ error: { code: "session_requires_action", message: "x" } }, 409);
      if (url.includes("boom")) return new Response("nope", { status: 500 });
      throw new Error("down");
    }) as unknown as MaFetch;

    const conflict = await maRequest(endpoint, "GET", "/sessions/conflict", undefined, fetchImpl);
    expect(conflict).toMatchObject({ ok: false, status: 409, code: "session_requires_action" });

    const http500 = await maRequest(endpoint, "GET", "/sessions/boom", undefined, fetchImpl);
    expect(http500).toMatchObject({ ok: false, status: 500, code: "http_500" });

    const network = await maRequest(endpoint, "GET", "/sessions/down", undefined, fetchImpl);
    expect(network).toMatchObject({ ok: false, status: 0, code: "network_error", message: "无法连接企业服务" });
    expect(JSON.stringify(conflict)).not.toContain(TOKEN);
    expect(JSON.stringify(http500)).not.toContain(TOKEN);
    expect(JSON.stringify(network)).not.toContain(TOKEN);

    const listed = vi.fn(async () => jsonResponse({ data: [], has_more: false, next_after_seq: 0 })) as unknown as MaFetch;
    await maRequest(endpoint, "GET", "/sessions/abc/events", { query: { types: ["a", "b"], limit: 10 } }, listed);
    const [url, init] = (listed as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const parsed = new URL(url);
    expect(parsed.searchParams.getAll("types")).toEqual(["a", "b"]);
  });
});

describe("buildCreateSessionBody", () => {
  it("create session body", () => {
    const agentId = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
    const bad = buildCreateSessionBody({ agentId: "abc" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad).toMatchObject({ status: 400, code: "invalid_request", message: "invalid agent id" });

    const title = "标".repeat(200);
    const built = buildCreateSessionBody({ agentId, title: `  ${title}额外  ` });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.body).toEqual({ agent_id: agentId, source: "desktop", title });
      expect(built.body).not.toHaveProperty("environment_id");
      expect(String(built.body.title)).toHaveLength(200);
    }

    const withEnv = buildCreateSessionBody({
      agentId,
      environmentId: "01JQMZ8K3N4P5Q6R7S8T9VWXY0",
      title: "报告助手",
    });
    expect(withEnv.ok).toBe(true);
    if (withEnv.ok) {
      expect(withEnv.body).toEqual({
        agent_id: agentId,
        source: "desktop",
        environment_id: "01JQMZ8K3N4P5Q6R7S8T9VWXY0",
        title: "报告助手",
      });
    }
    expect(buildCreateSessionBody({ agentId, environmentId: "bad" }).ok).toBe(false);
    expect(buildCreateSessionBody({ agentId, title: "   " }).ok).toBe(true);
    const blank = buildCreateSessionBody({ agentId, title: "   " });
    if (blank.ok) expect(blank.body).not.toHaveProperty("title");
  });
});

describe("MaStreamRegistry", () => {
  it("stream resumes with Last-Event-ID", async () => {
    const sleeps: number[] = [];
    const states: string[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
      calls += 1;
      if (calls === 1) {
        return sseResponse('id: 5\nevent: agent.message\ndata: {"seq":5}\n\nid: 6\nevent: agent.message\ndata: {"seq":6}\n\n');
      }
      return hangingBody(init?.signal);
    }) as unknown as MaFetch;
    const registry = new MaStreamRegistry({
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    registry.open("stream0001", endpoint, "sess", 0, {
      frame: () => undefined,
      state: (payload) => states.push(payload.state),
    }, 1);
    await vi.waitFor(() => {
      expect(states).toEqual(["open", "reconnecting", "open"]);
    });
    const secondCall = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[1] as [string, { headers?: Record<string, string> }];
    expect(secondCall[1]?.headers?.["Last-Event-ID"]).toBe("6");
    expect(sleeps).toEqual([MA_STREAM_BACKOFF_MS[0]]);
    registry.close("stream0001");
    await vi.waitFor(() => expect(states.at(-1)).toBe("closed"));
  });

  it("stops on 401/403/404", async () => {
    const states: string[] = [];
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: "unauthorized", message: "no" } }, 401)) as unknown as MaFetch;
    const registry = new MaStreamRegistry({
      fetchImpl,
      sleep: async () => undefined,
    });
    registry.open("stream0002", endpoint, "sess", 0, {
      frame: () => undefined,
      state: (payload) => states.push(payload.state),
    }, 1);
    await vi.waitFor(() => expect(states).toContain("error"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(states).not.toContain("reconnecting");
    expect(states).not.toContain("closed");
  });

  it("backoff grows and resets after frames", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      calls += 1;
      if (calls <= 5) throw new Error("offline");
      if (calls === 6) return sseResponse('id: 1\nevent: agent.message\ndata: {"a":1}\n\n');
      return hangingBody(init?.signal);
    }) as unknown as MaFetch;
    const registry = new MaStreamRegistry({
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    registry.open("stream0003", endpoint, "sess", 0, {
      frame: () => undefined,
      state: () => undefined,
    }, 1);
    await vi.waitFor(() => expect(sleeps.length).toBeGreaterThanOrEqual(6));
    expect(sleeps.slice(0, 6)).toEqual([1000, 2000, 5000, 10000, 10000, 1000]);
    registry.close("stream0003");
  });

  it("idle watchdog reconnects", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      calls += 1;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => {
            try {
              controller.error(new DOMException("aborted", "AbortError"));
            } catch {
              // already errored
            }
          };
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as MaFetch;
    const registry = new MaStreamRegistry({
      fetchImpl,
      sleep: async () => undefined,
      idleTimeoutMs: 50,
    });
    registry.open("stream0004", endpoint, "sess", 0, {
      frame: () => undefined,
      state: () => undefined,
    }, 1);
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    registry.close("stream0004");
  });

  it("close aborts and owner cleanup", async () => {
    const states = new Map<string, string[]>();
    const fetchImpl = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => hangingBody(init?.signal)) as unknown as MaFetch;
    const registry = new MaStreamRegistry({
      fetchImpl,
      sleep: async () => undefined,
    });
    const sinkFor = (streamId: string) => ({
      frame: () => undefined,
      state: (payload: { state: string }) => {
        const list = states.get(streamId) ?? [];
        list.push(payload.state);
        states.set(streamId, list);
      },
    });
    registry.open("owner1stream", endpoint, "sess-a", 0, sinkFor("owner1stream"), 1);
    registry.open("owner2stream", endpoint, "sess-b", 0, sinkFor("owner2stream"), 2);
    expect(registry.size()).toBe(2);
    registry.closeOwner(1);
    expect(registry.size()).toBe(1);
    await vi.waitFor(() => expect(states.get("owner1stream")).toContain("closed"));
    registry.close("owner2stream");
    expect(registry.size()).toBe(0);
    await vi.waitFor(() => expect(states.get("owner2stream")).toContain("closed"));
  });
});
