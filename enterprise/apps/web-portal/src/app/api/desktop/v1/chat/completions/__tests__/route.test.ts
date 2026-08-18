import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const prepareGatewayForward = vi.fn();
const upstreamFetch = vi.fn();

vi.mock("../../../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../../../lib/gateway-forward", () => ({
  prepareGatewayForward: (...args: unknown[]) => prepareGatewayForward(...args),
}));

describe("POST /api/desktop/v1/chat/completions", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    prepareGatewayForward.mockReset();
    upstreamFetch.mockReset();
    vi.stubGlobal("fetch", upstreamFetch);

    resolveDesktopIdentity.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
      deptId: "dept-1",
      email: "user@example.invalid",
    });
    prepareGatewayForward.mockResolvedValue({
      forwardBody: JSON.stringify({ model: "managed/model" }),
      providerHint: "managed",
    });
    upstreamFetch.mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });

  it("forwards the stable top-level turn and trace identifiers", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/desktop/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer agx-pat-test",
          "content-type": "application/json",
          "x-agenticx-turn-id": "turn_2026-08-18:01",
          "x-agenticx-trace-id": "trace_2026-08-18.01",
        },
        body: JSON.stringify({ model: "managed/model", messages: [] }),
      }),
    );

    expect(response.status).toBe(200);
    const [, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "x-agenticx-turn-id": "turn_2026-08-18:01",
      "x-agenticx-trace-id": "trace_2026-08-18.01",
    });
  });

  it("does not forward malformed task identifiers", async () => {
    const { POST } = await import("../route");
    await POST(
      new Request("http://localhost/api/desktop/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer agx-pat-test",
          "content-type": "application/json",
          "x-agenticx-turn-id": "turn id with spaces",
          "x-agenticx-trace-id": "trace/id",
        },
        body: JSON.stringify({ model: "managed/model", messages: [] }),
      }),
    );

    const [, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("x-agenticx-turn-id");
    expect(init.headers).not.toHaveProperty("x-agenticx-trace-id");
  });
});
