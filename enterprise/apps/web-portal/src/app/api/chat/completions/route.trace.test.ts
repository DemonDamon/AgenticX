import { afterEach, describe, expect, it, vi } from "vitest";
import { isTraceId } from "@agenticx/sdk-ts";

vi.mock("../../../../lib/session", () => ({
  ACCESS_COOKIE: "access",
  REFRESH_COOKIE: "refresh",
  getSessionAuthFromCookies: vi.fn(),
  isAuthCookieSecure: vi.fn(() => false),
}));

vi.mock("../../../../lib/chat-history", () => ({
  isChatSessionOwned: vi.fn(),
}));

vi.mock("../../../../lib/chat-history-http", () => ({
  toChatHistoryContext: vi.fn((session: unknown) => session),
}));

vi.mock("../../../../lib/admin-providers-reader", () => ({
  listAvailableModelsForUser: vi.fn(async () => [{ id: "openai/gpt-4o-mini" }]),
}));

vi.mock("../../../../lib/auth-runtime", () => ({
  refreshTokens: vi.fn(),
}));

vi.mock("../../../../lib/deep-research/orchestrator", () => ({
  runDeepResearchTurn: vi.fn(),
}));

vi.mock("../../../../lib/deep-research/artifact-store", () => ({
  defaultArtifactStore: {},
}));

vi.mock("../../../../lib/web-search/tool-loop", () => ({
  runWebSearchTurn: vi.fn(),
}));

vi.mock("../../../../lib/web-search/tenant-config", () => ({
  loadTenantWebSearchConfig: vi.fn(),
}));

import { getSessionAuthFromCookies } from "../../../../lib/session";
import { isChatSessionOwned } from "../../../../lib/chat-history";
import { POST } from "./route";

const session = {
  userId: "u1",
  tenantId: "t1",
  email: "u@example.com",
  deptId: "d1",
  sessionId: "auth-sess",
};

describe("POST /api/chat/completions trace propagation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function authOk() {
    vi.mocked(getSessionAuthFromCookies).mockResolvedValue({
      session,
      accessToken: "tok",
      refreshToken: "ref",
    } as never);
    vi.mocked(isChatSessionOwned).mockResolvedValue(true);
  }

  it("forwards a valid incoming trace id to the gateway", async () => {
    authOk();
    const tid = "01JABCDEFGHJKMNPQRSTVWXYZA";
    let captured: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        captured = init?.headers;
        return Promise.resolve(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );

    const res = await POST(
      new Request("http://localhost/api/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-session-id": "chat-1",
          "x-agenticx-trace-id": tid,
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-agenticx-trace-id")).toBe(tid);
    const headers = new Headers(captured);
    expect(headers.get("x-agenticx-trace-id")).toBe(tid);
    expect(headers.get("x-agenticx-trace-step")).toBe("1");
    expect(headers.get("x-agenticx-trace-stage")).toBe("chat.answer");
  });

  it("generates a valid ULID when incoming trace id is missing or invalid", async () => {
    authOk();
    let captured: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        captured = init?.headers;
        return Promise.resolve(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );

    const res = await POST(
      new Request("http://localhost/api/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-session-id": "chat-1",
          "x-agenticx-trace-id": "; DROP",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      }),
    );

    const responseTid = res.headers.get("x-agenticx-trace-id");
    expect(isTraceId(responseTid)).toBe(true);
    const headers = new Headers(captured);
    expect(headers.get("x-agenticx-trace-id")).toBe(responseTid);
  });

  it("includes trace_id on 503 when gateway fetch throws", async () => {
    authOk();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const res = await POST(
      new Request("http://localhost/api/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chat-session-id": "chat-1",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      }),
    );

    expect(res.status).toBe(503);
    const headerTid = res.headers.get("x-agenticx-trace-id");
    expect(isTraceId(headerTid)).toBe(true);
    const body = (await res.json()) as { error: { trace_id?: string } };
    expect(body.error.trace_id).toBe(headerTid);
  });
});
