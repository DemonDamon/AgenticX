import { describe, expect, it, vi } from "vitest";
import { GatewayMcpClient } from "../gateway-mcp-client";

const BASE = "http://gateway.test";
const HEADERS = {
  authorization: "Bearer tok",
  "x-tenant-id": "tenant-1",
  "x-user-id": "user-1",
  "Mcp-Session-Id": "should-not-send",
};

function client(fetchImpl: typeof fetch, timeoutMs?: number): GatewayMcpClient {
  return new GatewayMcpClient({
    gatewayBase: BASE,
    serverName: "diag-echo",
    headers: HEADERS,
    fetchImpl,
    timeoutMs,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readCall(fetchImpl: { mock: { calls: unknown[][] } }, index = 0) {
  const call = fetchImpl.mock.calls[index];
  const init = call?.[1] as RequestInit | undefined;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const body = JSON.parse(String(init?.body)) as {
    jsonrpc?: string;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  return { url: String(call?.[0]), headers, body, method: init?.method };
}

describe("GatewayMcpClient", () => {
  it("lists tools with JSON-RPC and does not initialize or send a session header", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [
            {
              name: "echo",
              description: "回显",
              inputSchema: { type: "object", properties: { message: { type: "string" } } },
            },
          ],
        },
      }),
    );
    const tools = await client(fetchImpl).listTools();
    expect(tools).toEqual([
      {
        name: "echo",
        description: "回显",
        inputSchema: { type: "object", properties: { message: { type: "string" } } },
      },
    ]);
    const sent = readCall(fetchImpl);
    expect(sent.url).toBe(`${BASE}/mcp/diag-echo/streamable-http`);
    expect(sent.method).toBe("POST");
    expect(sent.body).toMatchObject({ jsonrpc: "2.0", method: "tools/list" });
    expect(sent.body.method).not.toBe("initialize");
    expect(sent.headers.authorization).toBe("Bearer tok");
    expect(sent.headers["content-type"]).toBe("application/json");
    expect(sent.headers.accept).toBe("application/json");
    expect(sent.headers["Mcp-Session-Id"]).toBeUndefined();
    expect(sent.headers["mcp-session-id"]).toBeUndefined();
    expect(Object.keys(sent.headers).join(" ").toLowerCase()).not.toContain("session-id");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("concatenates text content and maps isError", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      if (body.method === "tools/call") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [
              { type: "text", text: "hello-" },
              { type: "image", data: "ignored" },
              { type: "text", text: "acp05" },
            ],
            isError: true,
          },
        });
      }
      return jsonResponse({ error: { message: "unexpected" } });
    });
    const result = await client(fetchImpl).callTool("echo", { message: "hello-acp05" });
    expect(result).toEqual({ ok: false, text: "hello-acp05" });
    const sent = readCall(fetchImpl);
    expect(sent.body.method).toBe("tools/call");
    expect(sent.body.params).toEqual({ name: "echo", arguments: { message: "hello-acp05" } });
  });

  it("returns a permission error on HTTP 403 and an HTTP error otherwise", async () => {
    const denied = vi.fn(async () => jsonResponse({ message: "mcp:capability_revoked" }, 403));
    await expect(client(denied).callTool("echo", {})).resolves.toEqual({
      ok: false,
      text: "无权使用该工具",
    });

    const failed = vi.fn(async () => new Response("nope", { status: 502 }));
    await expect(client(failed).callTool("echo", {})).resolves.toEqual({
      ok: false,
      text: "工具调用失败（HTTP 502）",
    });
  });

  it("clips tool text to 8000 characters", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: "x".repeat(8001) }] },
      }),
    );
    const result = await client(fetchImpl).callTool("echo", {});
    expect(result.ok).toBe(true);
    expect(result.text).toHaveLength(8000);
  });

  it("returns a timeout result instead of throwing", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const fail = () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (!signal) {
          fail();
          return;
        }
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      });
    });
    await expect(client(fetchImpl, 20).callTool("echo", {})).resolves.toEqual({
      ok: false,
      text: "工具调用超时",
    });
  });
});
